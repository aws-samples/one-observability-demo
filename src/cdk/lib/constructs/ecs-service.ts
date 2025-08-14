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
    FireLensLogDriver,
    FirelensLogRouterType,
    FirelensConfigFileType,
    LogDriver,
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
import { OpenSearchCollection } from './opensearch-collection';

export interface EcsServiceProperties extends MicroserviceProperties {
    cpu: number;
    memoryLimitMiB: number;
    instrumentation?: string;
    desiredTaskCount: number;
    cloudMapNamespace?: IPrivateDnsNamespace;
    openSearchCollection?:
        | OpenSearchCollection
        | {
              collectionArn: string;
              collectionEndpoint: string;
          };
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

        // Create CloudWatch log group
        const logGroup = new LogGroup(this, 'ecs-log-group', {
            logGroupName: properties.logGroupName || `/ecs/${properties.name}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
        });

        // Configure logging based on whether OpenSearch collection is provided
        let logging: LogDriver;
        if (properties.openSearchCollection) {
            // Use FireLens for dual routing to CloudWatch and OpenSearch
            logging = this.createFireLensLogDriver(properties, logGroup);
        } else {
            // Use standard CloudWatch logging
            logging = new AwsLogDriver({
                streamPrefix: 'logs',
                logGroup: logGroup,
            });
        }

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

        // Add execution role permissions
        const executionRoleActions = [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
        ];

        // Add OpenSearch permissions if collection is provided
        if (properties.openSearchCollection) {
            executionRoleActions.push(
                'es:ESHttpPost',
                'es:ESHttpPut',
                'aoss:APIAccessAll', // OpenSearch Serverless permissions
            );
        }

        taskDefinition.addToExecutionRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: executionRoleActions,
                resources: ['*'],
            }),
        );

        // Add FireLens log router container if OpenSearch collection is provided
        if (properties.openSearchCollection) {
            this.addFireLensLogRouter(taskDefinition, properties);
        }

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
                        reason: 'Allowing * for ECR pull and log access',
                    },
                ],
                true,
            );
        }

        if (taskDefinition.taskRole && properties.openSearchCollection) {
            NagSuppressions.addResourceSuppressions(
                taskDefinition.taskRole,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'OpenSearch Serverless requires broad permissions for log ingestion',
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

    private addOtelCollectorContainer(taskDefinition: TaskDefinition, logging: LogDriver) {
        taskDefinition.addContainer('aws-otel-collector', {
            image: ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.41.1'),
            memoryLimitMiB: 256,
            cpu: 256,
            command: ['--config', '/etc/ecs/ecs-xray.yaml'],
            logging,
        });
    }

    private createFireLensLogDriver(properties: EcsServiceProperties, logGroup: LogGroup): FireLensLogDriver {
        const collection = properties.openSearchCollection!;
        const openSearchEndpoint =
            'collection' in collection ? collection.collection.attrCollectionEndpoint : collection.collectionEndpoint;

        return new FireLensLogDriver({
            options: {
                // Route to multiple outputs
                Name: 'forward',
                Match: '*',
                'Forward.0.Name': 'cloudwatch_logs',
                'Forward.0.Match': '*',
                'Forward.0.log_group_name': logGroup.logGroupName,
                'Forward.0.log_stream_prefix': 'ecs/',
                'Forward.0.region': Stack.of(this).region,
                'Forward.1.Name': 'opensearch',
                'Forward.1.Match': '*',
                'Forward.1.Host': openSearchEndpoint.replace('https://', ''),
                'Forward.1.Port': '443',
                'Forward.1.Index': `${properties.name}-logs`,
                'Forward.1.Type': '_doc',
                'Forward.1.AWS_Region': Stack.of(this).region,
                'Forward.1.AWS_Auth': 'On',
                'Forward.1.tls': 'On',
                'Forward.1.tls.verify': 'Off',
            },
        });
    }

    private addFireLensLogRouter(taskDefinition: TaskDefinition, properties: EcsServiceProperties): void {
        // Add FireLens log router using the task definition method
        const logRouter = taskDefinition.addFirelensLogRouter('log-router', {
            image: ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable'),
            memoryLimitMiB: 256,
            cpu: 128,
            essential: true,
            logging: new AwsLogDriver({
                streamPrefix: 'firelens',
                logGroup: new LogGroup(this, 'firelens-log-group', {
                    logGroupName: `/ecs/firelens/${properties.name}`,
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_WEEK,
                }),
            }),
            firelensConfig: {
                type: FirelensLogRouterType.FLUENTBIT,
                options: {
                    enableECSLogMetadata: true,
                    configFileType: FirelensConfigFileType.FILE,
                    configFileValue: '/fluent-bit/etc/fluent-bit.conf',
                },
            },
        });

        // Add port mappings for the log router (required by ECS)
        logRouter.addPortMappings({
            containerPort: 24224,
            protocol: Protocol.TCP,
        });

        // Add task role permissions for OpenSearch access
        if (properties.openSearchCollection) {
            const collection = properties.openSearchCollection;
            const collectionArn = 'collection' in collection ? collection.collection.attrArn : collection.collectionArn;

            taskDefinition.taskRole.addToPrincipalPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['aoss:APIAccessAll', 'es:ESHttpPost', 'es:ESHttpPut'],
                    resources: [collectionArn],
                }),
            );
        }
    }

    private addXRayContainer(taskDefinition: TaskDefinition, logging: LogDriver) {
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
}
