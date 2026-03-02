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
    ContainerDependencyCondition,
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
} from 'aws-cdk-lib/aws-ecs';
import {
    ApplicationLoadBalancedEc2Service,
    ApplicationLoadBalancedFargateService,
    ApplicationLoadBalancedServiceBase,
} from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy, Stack, Fn, Annotations } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Port, Peer, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { OpenSearchCollection } from './opensearch-collection';
import { OpenSearchPipeline } from './opensearch-pipeline';
import { CloudWatchAgentTraceMode } from '../../bin/constants';

/**
 * CloudWatch agent configuration interface
 * Defines the structure for CloudWatch agent configuration JSON
 */
interface CloudWatchAgentConfig {
    /** Trace collection configuration */
    traces: {
        traces_collected: {
            /** AWS Application Signals trace collection configuration */
            application_signals?: Record<string, unknown>;
            /** OpenTelemetry Protocol (OTLP) trace collection configuration */
            otlp?: Record<string, unknown>;
        };
    };
    /** Log and metrics collection configuration */
    logs: {
        metrics_collected: {
            /** AWS Application Signals metrics collection configuration */
            application_signals?: Record<string, unknown>;
        };
    };
}

export interface EcsServiceProperties extends MicroserviceProperties {
    cpu: number;
    memoryLimitMiB: number;
    desiredTaskCount: number;
    cloudMapNamespace?: IPrivateDnsNamespace;
    openSearchCollection?:
        | OpenSearchCollection
        | {
              collectionArn: string;
              collectionEndpoint: string;
          };
    /**
     * OpenSearch ingestion pipeline for log routing
     * When provided, logs will be sent to the pipeline instead of directly to OpenSearch
     * Mutually exclusive with openSearchCollection
     */
    openSearchPipeline?:
        | OpenSearchPipeline
        | {
              pipelineEndpoint: string;
              pipelineArn?: string;
              pipelineRoleArn?: string;
          };
    additionalEnvironment?: { [key: string]: string };
    /**
     * Enable CloudWatch agent sidecar for application signals and OTLP traces
     * When enabled, adds a CloudWatch agent container that listens on port 4317
     */
    enableCloudWatchAgent?: boolean;
    /**
     * CloudWatch agent trace collection mode
     * @default CloudWatchAgentTraceMode.APPLICATION_SIGNALS
     */
    cloudWatchAgentTraceMode?: CloudWatchAgentTraceMode;
}

export abstract class EcsService extends Microservice {
    public readonly taskDefinition: TaskDefinition;
    public readonly loadBalancedService?: ApplicationLoadBalancedServiceBase;
    public readonly service?: BaseService;
    public readonly container: ContainerDefinition;
    public readonly taskRole: IRole;

    constructor(scope: Construct, id: string, properties: EcsServiceProperties) {
        super(scope, id, properties);

        // Validate mutual exclusivity of openSearchCollection and openSearchPipeline
        if (properties.openSearchCollection && properties.openSearchPipeline) {
            throw new Error(
                'openSearchCollection and openSearchPipeline are mutually exclusive. Please specify only one.',
            );
        }

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
            removalPolicy: RemovalPolicy.DESTROY,
            retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
        });

        // Configure logging based on whether OpenSearch collection or pipeline is provided
        const logging =
            properties.openSearchCollection || properties.openSearchPipeline
                ? // Use FireLens for routing to OpenSearch collection or pipeline
                  this.createFireLensLogDriver(properties)
                : // Use standard CloudWatch logging
                  new AwsLogDriver({
                      streamPrefix: 'logs',
                      logGroup: logGroup,
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

        // Add execution role permissions
        const executionRoleActions = [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
        ];

        // Add OpenSearch permissions only if collection is provided AND pipeline is not used
        // When using pipeline, the pipeline handles OpenSearch access, not the ECS task
        if (properties.openSearchCollection && !properties.openSearchPipeline) {
            executionRoleActions.push(
                'aoss:WriteDocument',
                'aoss:CreateIndex',
                'aoss:DescribeIndex',
                'aoss:UpdateIndex',
                'es:ESHttpPost',
                'es:ESHttpPut',
            );
        }

        // Note: Pipeline permissions are handled in the task role, not execution role

        taskDefinition.addToExecutionRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: executionRoleActions,
                resources: ['*'],
            }),
        );

        const image = ContainerImage.fromRegistry(properties.repositoryURI);

        // Merge default environment variables with additional ones
        const defaultEnvironment = {
            // clear text, not for sensitive data
            AWS_REGION: Stack.of(this).region,
        };

        const environment = {
            ...defaultEnvironment,
            ...properties.additionalEnvironment,
        };

        const container = taskDefinition.addContainer('container', {
            image: image,
            memoryLimitMiB: 512,
            cpu: 256,
            logging,
            environment,
        });

        container.addPortMappings({
            containerPort: properties.containerPort || 80,
            protocol: Protocol.TCP,
        });

        // Add FireLens log router container if OpenSearch collection or pipeline is provided
        if (properties.openSearchCollection || properties.openSearchPipeline) {
            this.addFireLensLogRouter(taskDefinition, properties);
        }

        // Add CloudWatch agent sidecar if explicitly enabled
        if (properties.enableCloudWatchAgent) {
            // Add ADOT init container based on service language
            this.addAdotInitContainer(taskDefinition, container, properties.name);

            // Add CloudWatch agent sidecar with specified trace mode
            const traceMode = properties.cloudWatchAgentTraceMode || CloudWatchAgentTraceMode.APPLICATION_SIGNALS;
            const cwAgentContainer = this.addCloudWatchAgentSidecar(taskDefinition, traceMode);

            // Add container dependency so main container waits for CloudWatch agent to start
            container.addContainerDependencies({
                container: cwAgentContainer,
                condition: ContainerDependencyCondition.START,
            });
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
                              enableExecuteCommand: true,
                              cloudMapOptions: properties.cloudMapNamespace
                                  ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                                  : undefined,
                          })
                        : new Ec2Service(this, 'ecs-service-ec2-no-lb', {
                              cluster: properties.ecsCluster!,
                              taskDefinition: taskDefinition as Ec2TaskDefinition,
                              desiredCount: properties.desiredTaskCount,
                              serviceName: properties.name,
                              enableExecuteCommand: true,
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
                        listenerPort: properties.listenerPort || 80,
                        securityGroups: properties.securityGroup ? [properties.securityGroup] : undefined,
                        openListener: false,
                        assignPublicIp: false,
                        serviceName: properties.name,
                        loadBalancerName: `LB-${properties.name}`,
                        enableExecuteCommand: true,
                        cloudMapOptions: properties.cloudMapNamespace
                            ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                            : undefined,
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
                            Port.tcp(properties.containerPort || 80),
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
                                Port.tcp(properties.listenerPort || 80),
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
                        listenerPort: properties.listenerPort || 80,
                        openListener: false,
                        serviceName: properties.name,
                        loadBalancerName: `LB-${properties.name}`,
                        enableExecuteCommand: true,
                        cloudMapOptions: properties.cloudMapNamespace
                            ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                            : undefined,
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
                            Port.tcp(properties.containerPort || 80),
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
                                Port.tcp(properties.listenerPort || 80),
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
            {
                id: 'AwsSolutions-ECS7',
                reason: 'False positive, Open Telemetry is used for logging on all tasks',
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

        if (taskDefinition.taskRole && properties.openSearchPipeline) {
            NagSuppressions.addResourceSuppressions(
                taskDefinition.taskRole,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'OpenSearch Ingestion Service requires permissions for pipeline access',
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

    private createFireLensLogDriver(properties: EcsServiceProperties): FireLensLogDriver {
        if (properties.openSearchPipeline) {
            // Configure for OpenSearch Ingestion Pipeline using HTTP output
            const pipeline = properties.openSearchPipeline;
            const pipelineEndpoint =
                'pipelineEndpoint' in pipeline
                    ? pipeline.pipelineEndpoint
                    : (pipeline as OpenSearchPipeline).pipeline.attrIngestEndpointUrls[0];

            // Extract host from pipeline endpoint
            // Pipeline endpoints from OSI are typically just hostnames without https://
            const hostAndPath = Fn.split('/', pipelineEndpoint);
            const host = Fn.select(0, hostAndPath);
            const httpOptions: { [key: string]: string } = {
                Name: 'http',
                Match: '*',
                Host: host,
                Port: '443',
                uri: '/log/ingest',
                format: 'json',
                aws_auth: 'true',
                aws_region: Stack.of(this).region,
                aws_service: 'osis',
                tls: 'on',
                'tls.verify': 'off',
                Retry_Limit: '3',
                Log_Level: 'trace',
            };

            // Don't use aws_role_arn - let the ECS task role handle authentication directly

            return new FireLensLogDriver({
                options: httpOptions,
            });
        } else if (properties.openSearchCollection) {
            // Configure for direct OpenSearch Collection
            const collection = properties.openSearchCollection;
            const openSearchEndpoint =
                'collection' in collection
                    ? collection.collection.attrCollectionEndpoint
                    : collection.collectionEndpoint;

            // Use CloudFormation functions to strip https:// prefix at deployment time
            const openSearchHostWithoutProtocol = Fn.select(1, Fn.split('https://', openSearchEndpoint));

            return new FireLensLogDriver({
                options: {
                    Name: 'opensearch',
                    Host: openSearchHostWithoutProtocol,
                    Port: '443',
                    aws_auth: 'On',
                    AWS_Region: Stack.of(this).region,
                    AWS_Service_Name: 'aoss',
                    Index: `${properties.name}-logs`,
                    tls: 'On',
                    Suppress_Type_Name: 'On',
                    Trace_Error: 'On',
                    Trace_Output: 'On',
                },
            });
        } else {
            throw new Error('Either openSearchCollection or openSearchPipeline must be provided for FireLens logging');
        }
    }

    private addFireLensLogRouter(taskDefinition: TaskDefinition, properties: EcsServiceProperties): void {
        // Add FireLens log router using the task definition method
        taskDefinition.addFirelensLogRouter('log-router', {
            image: ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable'),
            memoryLimitMiB: 512,
            cpu: 256,
            essential: true,
            logging: new AwsLogDriver({
                streamPrefix: 'firelens',
                logGroup: new LogGroup(this, 'firelens-log-group', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_WEEK,
                }),
            }),
            firelensConfig: {
                type: FirelensLogRouterType.FLUENTBIT,
                options: {
                    enableECSLogMetadata: true,
                },
            },
        });

        // Add task role permissions based on configuration
        if (properties.openSearchCollection && !properties.openSearchPipeline) {
            // Add permissions for direct OpenSearch access only when not using pipeline
            const collection = properties.openSearchCollection;
            const collectionArn = 'collection' in collection ? collection.collection.attrArn : collection.collectionArn;

            taskDefinition.taskRole.addToPrincipalPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'aoss:WriteDocument',
                        'aoss:CreateIndex',
                        'aoss:DescribeIndex',
                        'es:ESHttpPost',
                        'es:ESHttpPut',
                    ],
                    resources: [collectionArn],
                }),
            );
        } else if (properties.openSearchPipeline) {
            // For OpenSearch Ingestion Service pipeline, use HTTP calls with AWS SigV4 auth
            // The ECS task role will authenticate directly with the pipeline endpoint
            const pipeline = properties.openSearchPipeline;
            const pipelineArn =
                'pipelineEndpoint' in pipeline
                    ? `arn:aws:osis:${Stack.of(this).region}:${Stack.of(this).account}:pipeline/*`
                    : (pipeline as OpenSearchPipeline).pipeline.attrPipelineArn;

            // Add permissions for pipeline ingestion via HTTP
            taskDefinition.taskRole.addToPrincipalPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['osis:Ingest'],
                    resources: [pipelineArn],
                }),
            );

            // Add permissions for AWS SigV4 signing for HTTP requests to the pipeline
            taskDefinition.taskRole.addToPrincipalPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'sts:GetCallerIdentity', // Required for SigV4 signing
                    ],
                    resources: ['*'],
                }),
            );
        }
    }

    private addAdotInitContainer(
        taskDefinition: TaskDefinition,
        mainContainer: ContainerDefinition,
        serviceName: string,
    ): void {
        // Language to ADOT image version mapping
        const languageConfig: { [key: string]: { image: string; volumeName: string; volumePath: string } } = {
            java: {
                image: 'public.ecr.aws/aws-observability/adot-autoinstrumentation-java:v2.11.5',
                volumeName: 'opentelemetry-auto-instrumentation-java',
                volumePath: '/otel-auto-instrumentation-java',
            },
            nodejs: {
                image: 'public.ecr.aws/aws-observability/adot-autoinstrumentation-node:v0.8.0',
                volumeName: 'opentelemetry-auto-instrumentation-node',
                volumePath: '/otel-auto-instrumentation-nodejs',
            },
            python: {
                image: 'public.ecr.aws/aws-observability/adot-autoinstrumentation-python:v0.12.2',
                volumeName: 'opentelemetry-auto-instrumentation-python',
                volumePath: '/otel-auto-instrumentation-python',
            },
            dotnet: {
                image: 'public.ecr.aws/aws-observability/adot-autoinstrumentation-dotnet:v1.9.1',
                volumeName: 'opentelemetry-auto-instrumentation-dotnet',
                volumePath: '/otel-auto-instrumentation-dotnet',
            },
        };

        // Detect language from service name
        let language: string | undefined;
        if (serviceName.includes('-java')) {
            language = 'java';
        } else if (serviceName.includes('-node') || serviceName.includes('-js')) {
            language = 'nodejs';
        } else if (serviceName.includes('-py')) {
            language = 'python';
        } else if (serviceName.includes('-net')) {
            language = 'dotnet';
        }

        // If language is not supported, add warning annotation and return
        if (!language) {
            Annotations.of(this).addWarning(
                `Unsupported language for auto-instrumentation in service: ${serviceName}. Supported languages: java, nodejs, python, dotnet`,
            );
            return;
        }

        const config = languageConfig[language];

        // Add volume for auto-instrumentation
        taskDefinition.addVolume({
            name: config.volumeName,
        });

        // Add ADOT auto-instrumentation init container
        const initContainer = taskDefinition.addContainer('init', {
            image: ContainerImage.fromRegistry(config.image),
            essential: false,
            command: [
                'sh',
                '-c',
                `cp -a /autoinstrumentation/. ${config.volumePath} && chmod -R 755 ${config.volumePath} && chown -R 1000:1000 ${config.volumePath}`,
            ],
        });

        // Mount the volume in init container
        initContainer.addMountPoints({
            sourceVolume: config.volumeName,
            containerPath: config.volumePath,
            readOnly: false,
        });

        // Mount the volume in main container
        mainContainer.addMountPoints({
            sourceVolume: config.volumeName,
            containerPath: config.volumePath,
            readOnly: false,
        });

        // Add container dependency
        mainContainer.addContainerDependencies({
            container: initContainer,
            condition: ContainerDependencyCondition.SUCCESS,
        });
    }

    /**
     * Build CloudWatch agent configuration based on the specified trace mode
     * @param traceMode The trace collection mode to configure
     * @returns CloudWatch agent configuration object
     */
    private buildCloudWatchConfig(traceMode: CloudWatchAgentTraceMode): CloudWatchAgentConfig {
        const config: CloudWatchAgentConfig = {
            traces: {
                traces_collected: {},
            },
            logs: {
                metrics_collected: {},
            },
        };

        switch (traceMode) {
            case CloudWatchAgentTraceMode.APPLICATION_SIGNALS: {
                // AWS Application Signals configuration - provides automatic service maps and metrics
                config.traces.traces_collected.application_signals = {};
                config.logs.metrics_collected.application_signals = {};
                break;
            }

            case CloudWatchAgentTraceMode.OTLP: {
                // OpenTelemetry Protocol configuration - for services using OTEL that don't support Application Signals
                config.traces.traces_collected.otlp = {};
                // Note: OTLP mode doesn't include Application Signals metrics collection
                break;
            }

            default: {
                // Default to Application Signals for backward compatibility
                config.traces.traces_collected.application_signals = {};
                config.logs.metrics_collected.application_signals = {};
            }
        }

        return config;
    }

    /**
     * Add CloudWatch agent sidecar container to the task definition
     * @param taskDefinition The ECS task definition to add the sidecar to
     * @param traceMode The trace collection mode (defaults to 'application_signals' for backward compatibility)
     * @returns The CloudWatch agent container
     */
    private addCloudWatchAgentSidecar(
        taskDefinition: TaskDefinition,
        traceMode: CloudWatchAgentTraceMode = CloudWatchAgentTraceMode.APPLICATION_SIGNALS,
    ): ContainerDefinition {
        // Build CloudWatch agent configuration based on trace mode
        const cloudWatchConfig = this.buildCloudWatchConfig(traceMode);

        // Add CloudWatch agent container
        const cwAgentContainer = taskDefinition.addContainer('cloudwatch-agent', {
            image: ContainerImage.fromRegistry('public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest'),
            memoryLimitMiB: 256,
            cpu: 128,
            essential: true,
            logging: new AwsLogDriver({
                streamPrefix: 'cloudwatch-agent',
                logGroup: new LogGroup(this, 'cloudwatch-agent-log-group', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_WEEK,
                }),
            }),
            environment: {
                CW_CONFIG_CONTENT: JSON.stringify(cloudWatchConfig),
                AWS_REGION: Stack.of(this).region,
            },
        });

        // Add necessary permissions for CloudWatch agent
        taskDefinition.taskRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'cloudwatch:PutMetricData',
                    'ec2:DescribeVolumes',
                    'ec2:DescribeTags',
                    'logs:PutLogEvents',
                    'logs:CreateLogGroup',
                    'logs:CreateLogStream',
                    'logs:DescribeLogStreams',
                    'logs:DescribeLogGroups',
                    'xray:PutTraceSegments',
                    'xray:PutTelemetryRecords',
                ],
                resources: ['*'],
            }),
        );

        return cwAgentContainer;
    }
}
