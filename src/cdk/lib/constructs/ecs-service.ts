/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Effect, IRole, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Microservice, MicroserviceProperties } from './microservice';
import { ComputeType } from '../../bin/environment';
import {
    AwsLogDriver,
    ContainerDefinition,
    ContainerImage,
    Ec2TaskDefinition,
    FargateTaskDefinition,
    Protocol,
    TaskDefinition,
    Ec2Service,
    FargateService,
    BaseService,
} from 'aws-cdk-lib/aws-ecs';
import {
    ApplicationLoadBalancedEc2Service,
    ApplicationLoadBalancedFargateService,
    ApplicationLoadBalancedServiceBase,
} from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Port, Peer, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';

export interface EcsServiceProperties extends MicroserviceProperties {
    cpu: number;
    memoryLimitMiB: number;
    instrumentation?: string;
    desiredTaskCount: number;
    cloudMapNamespace?: IPrivateDnsNamespace;
}

export abstract class EcsService extends Microservice {
    public readonly taskDefinition: TaskDefinition;
    public readonly loadBalancedService?: ApplicationLoadBalancedServiceBase;
    public readonly service?: BaseService;
    public readonly container: ContainerDefinition;
    public readonly taskRole: IRole;

    constructor(scope: Construct, id: string, properties: EcsServiceProperties) {
        super(scope, id, properties);

        const result = this.configureECSService(properties);
        this.taskDefinition = result.taskDefinition;
        this.loadBalancedService = result.loadBalancedService;
        this.service = result.service;
        this.container = result.container;
        this.taskRole = result.taskRole;

        this.addPermissions(properties);
        this.createOutputs(properties);
    }

    configureEKSService(): void {
        throw new Error('Method not implemented.');
    }

    configureECSService(properties: EcsServiceProperties) {
        let loadBalancedService: ApplicationLoadBalancedServiceBase | undefined;
        let service: BaseService | undefined;

        const logging = new AwsLogDriver({
            streamPrefix: 'logs',
            logGroup: new LogGroup(this, 'ecs-log-group', {
                logGroupName: properties.logGroupName || `/ecs/${properties.name}`,
                removalPolicy: RemovalPolicy.DESTROY,
                retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
            }),
        });

        const taskRole = new Role(this, `taskRole`, {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
        });

        const taskDefinition =
            properties.computeType == ComputeType.Fargate
                ? new FargateTaskDefinition(this, 'taskDefinition', {
                      cpu: properties.cpu, // TODO: Some math is needed here so the value includes Container + Sidecars
                      taskRole: taskRole,
                      memoryLimitMiB: properties.memoryLimitMiB,
                  })
                : new Ec2TaskDefinition(this, 'taskDefinition', {
                      taskRole: taskRole,
                      enableFaultInjection: true,
                  });

        taskDefinition.addToExecutionRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'ecr:GetAuthorizationToken',
                    'ecr:BatchCheckLayerAvailability',
                    'ecr:GetDownloadUrlForLayer',
                    'ecr:BatchGetImage',
                    'logs:CreateLogStream',
                    'logs:PutLogEvents',
                ],
                resources: ['*'],
            }),
        );

        const image = ContainerImage.fromRegistry(properties.repositoryURI);

        const container = taskDefinition.addContainer('container', {
            image: image,
            memoryLimitMiB: 512,
            cpu: 256,
            logging,
            environment: {
                // clear text, not for sensitive data
                AWS_REGION: Stack.of(this).region,
            },
        });

        container.addPortMappings({
            containerPort: properties.port || 80,
            protocol: Protocol.TCP,
        });

        // sidecar for instrumentation collecting
        switch (properties.instrumentation) {
            // we don't add any sidecar if instrumentation is none
            case 'none': {
                break;
            }

            // This collector would be used for both traces collected using
            // open telemetry or X-Ray
            case 'otel': {
                this.addOtelCollectorContainer(taskDefinition, logging);
                break;
            }

            // Default X-Ray traces collector
            case 'xray': {
                this.addXRayContainer(taskDefinition, logging);
                break;
            }

            // Default X-Ray traces collector
            // enabled by default
            default: {
                this.addXRayContainer(taskDefinition, logging);
                break;
            }
        }

        if (!properties.disableService) {
            if (properties.createLoadBalancer === false) {
                // Create service without load balancer
                service =
                    properties.computeType == ComputeType.Fargate
                        ? new FargateService(this, 'ecs-service-fargate-no-lb', {
                              cluster: properties.ecsCluster!,
                              taskDefinition: taskDefinition as FargateTaskDefinition,
                              desiredCount: properties.desiredTaskCount,
                              serviceName: properties.name,
                              securityGroups: properties.securityGroup ? [properties.securityGroup] : undefined,
                              assignPublicIp: false,
                              cloudMapOptions: properties.cloudMapNamespace
                                  ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                                  : undefined,
                          })
                        : new Ec2Service(this, 'ecs-service-ec2-no-lb', {
                              cluster: properties.ecsCluster!,
                              taskDefinition: taskDefinition as Ec2TaskDefinition,
                              desiredCount: properties.desiredTaskCount,
                              serviceName: properties.name,
                              cloudMapOptions: properties.cloudMapNamespace
                                  ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                                  : undefined,
                          });
            } else {
                if (properties.computeType == ComputeType.Fargate) {
                    loadBalancedService = new ApplicationLoadBalancedFargateService(this, 'ecs-service-fargate', {
                        cluster: properties.ecsCluster,
                        taskDefinition: taskDefinition as FargateTaskDefinition,
                        publicLoadBalancer: false,
                        desiredCount: properties.desiredTaskCount,
                        listenerPort: properties.port || 80,
                        securityGroups: properties.securityGroup ? [properties.securityGroup] : undefined,
                        openListener: false,
                        assignPublicIp: false,
                        serviceName: properties.name,
                        loadBalancerName: `LB-${properties.name}`,
                    });

                    if (properties.healthCheck) {
                        loadBalancedService.targetGroup.configureHealthCheck({
                            path: properties.healthCheck,
                        });
                    }

                    // Allow load balancer to communicate with ECS tasks
                    if (properties.securityGroup) {
                        properties.securityGroup.addIngressRule(
                            loadBalancedService.loadBalancer.connections.securityGroups[0],
                            Port.tcp(properties.port || 80),
                            'Allow load balancer to reach ECS tasks',
                        );
                    }

                    // Allow traffic from specified subnet type to load balancer
                    if (properties.vpc && loadBalancedService) {
                        const subnets =
                            properties.subnetType === SubnetType.PUBLIC
                                ? properties.vpc.publicSubnets
                                : properties.vpc.privateSubnets;
                        for (const [index, subnet] of subnets.entries()) {
                            loadBalancedService.loadBalancer.connections.allowFrom(
                                Peer.ipv4(subnet.ipv4CidrBlock),
                                Port.tcp(properties.port || 80),
                                `Allow traffic from ${properties.subnetType || 'private'} subnet ${index + 1}`,
                            );
                        }
                    }
                } else {
                    loadBalancedService = new ApplicationLoadBalancedEc2Service(this, 'ecs-service-ec2', {
                        cluster: properties.ecsCluster,
                        taskDefinition: taskDefinition as FargateTaskDefinition,
                        publicLoadBalancer: false,
                        desiredCount: properties.desiredTaskCount,
                        listenerPort: properties.port || 80,
                        openListener: false,
                        serviceName: properties.name,
                        loadBalancerName: `LB-${properties.name}`,
                    });

                    if (properties.healthCheck) {
                        loadBalancedService.targetGroup.configureHealthCheck({
                            path: properties.healthCheck,
                        });
                    }

                    // Allow load balancer to communicate with ECS tasks
                    if (properties.securityGroup) {
                        properties.securityGroup.addIngressRule(
                            loadBalancedService.loadBalancer.connections.securityGroups[0],
                            Port.tcp(properties.port || 80),
                            'Allow load balancer to reach ECS tasks',
                        );
                    }

                    // Allow traffic from specified subnet type to load balancer
                    if (properties.vpc && loadBalancedService) {
                        const subnets =
                            properties.subnetType === SubnetType.PUBLIC
                                ? properties.vpc.publicSubnets
                                : properties.vpc.privateSubnets;
                        for (const [index, subnet] of subnets.entries()) {
                            loadBalancedService.loadBalancer.connections.allowFrom(
                                Peer.ipv4(subnet.ipv4CidrBlock),
                                Port.tcp(properties.port || 80),
                                `Allow traffic from ${properties.subnetType || 'private'} subnet ${index + 1}`,
                            );
                        }
                    }
                }
            }
        }

        NagSuppressions.addResourceSuppressions(taskDefinition, [
            {
                id: 'AwsSolutions-ECS2',
                reason: 'AWS_REGION is required by OTEL. TODO: Replace with proper environment variables ',
            },
        ]);

        if (taskDefinition.executionRole) {
            NagSuppressions.addResourceSuppressions(
                taskDefinition.executionRole,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'Allowing * for ECR pull',
                    },
                ],
                true,
            );
        }

        if (loadBalancedService) {
            NagSuppressions.addResourceSuppressions(loadBalancedService.loadBalancer, [
                {
                    id: 'AwsSolutions-ELB2',
                    reason: 'Disabled access logs for now',
                },
            ]);
        }

        return { taskDefinition, loadBalancedService, service, container, taskRole };
    }

    private addXRayContainer(taskDefinition: TaskDefinition, logging: AwsLogDriver) {
        taskDefinition
            .addContainer('xraydaemon', {
                image: ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:3.3.4'),
                memoryLimitMiB: 256,
                cpu: 256,
                logging,
            })
            .addPortMappings({
                containerPort: 2000,
                protocol: Protocol.UDP,
            });
    }

    private addOtelCollectorContainer(taskDefinition: TaskDefinition, logging: AwsLogDriver) {
        taskDefinition.addContainer('aws-otel-collector', {
            image: ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.41.1'),
            memoryLimitMiB: 256,
            cpu: 256,
            command: ['--config', '/etc/ecs/ecs-xray.yaml'],
            logging,
        });
    }
}
