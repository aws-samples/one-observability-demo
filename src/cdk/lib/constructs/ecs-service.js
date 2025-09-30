"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsService = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const microservice_1 = require("./microservice");
const environment_1 = require("../../bin/environment");
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_ecs_patterns_1 = require("aws-cdk-lib/aws-ecs-patterns");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
class EcsService extends microservice_1.Microservice {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        // Validate mutual exclusivity of openSearchCollection and openSearchPipeline
        if (properties.openSearchCollection && properties.openSearchPipeline) {
            throw new Error('openSearchCollection and openSearchPipeline are mutually exclusive. Please specify only one.');
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
    configureEKSService() {
        throw new Error('Method not implemented.');
    }
    configureECSService(properties) {
        let loadBalancedService;
        let service;
        // Create CloudWatch log group
        const logGroup = new aws_logs_1.LogGroup(this, 'ecs-log-group', {
            logGroupName: properties.logGroupName || `/ecs/${properties.name}`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            retention: properties.logRetentionDays || aws_logs_1.RetentionDays.ONE_WEEK,
        });
        // Configure logging based on whether OpenSearch collection or pipeline is provided
        const logging = properties.openSearchCollection || properties.openSearchPipeline
            ? // Use FireLens for routing to OpenSearch collection or pipeline
                this.createFireLensLogDriver(properties)
            : // Use standard CloudWatch logging
                new aws_ecs_1.AwsLogDriver({
                    streamPrefix: 'logs',
                    logGroup: logGroup,
                });
        const taskRole = new aws_iam_1.Role(this, `taskRole`, {
            assumedBy: new aws_iam_1.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        const taskDefinition = properties.computeType == environment_1.ComputeType.Fargate
            ? new aws_ecs_1.FargateTaskDefinition(this, 'taskDefinition', {
                cpu: properties.cpu, // TODO: Some math is needed here so the value includes Container + Sidecars
                taskRole: taskRole,
                memoryLimitMiB: properties.memoryLimitMiB,
            })
            : new aws_ecs_1.Ec2TaskDefinition(this, 'taskDefinition', {
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
            executionRoleActions.push('aoss:WriteDocument', 'aoss:CreateIndex', 'aoss:DescribeIndex', 'aoss:UpdateIndex', 'es:ESHttpPost', 'es:ESHttpPut');
        }
        // Note: Pipeline permissions are handled in the task role, not execution role
        taskDefinition.addToExecutionRolePolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: executionRoleActions,
            resources: ['*'],
        }));
        const image = aws_ecs_1.ContainerImage.fromRegistry(properties.repositoryURI);
        // Merge default environment variables with additional ones
        const defaultEnvironment = {
            // clear text, not for sensitive data
            AWS_REGION: aws_cdk_lib_1.Stack.of(this).region,
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
            protocol: aws_ecs_1.Protocol.TCP,
        });
        // Add FireLens log router container if OpenSearch collection or pipeline is provided
        if (properties.openSearchCollection || properties.openSearchPipeline) {
            this.addFireLensLogRouter(taskDefinition, properties);
        }
        // Add CloudWatch agent sidecar if explicitly enabled
        if (properties.enableCloudWatchAgent) {
            this.addCloudWatchAgentSidecar(taskDefinition, properties);
        }
        if (!properties.disableService) {
            if (properties.createLoadBalancer === false) {
                // Create service without load balancer
                service =
                    properties.computeType == environment_1.ComputeType.Fargate
                        ? new aws_ecs_1.FargateService(this, 'ecs-service-fargate-no-lb', {
                            cluster: properties.ecsCluster,
                            taskDefinition: taskDefinition,
                            desiredCount: properties.desiredTaskCount,
                            serviceName: properties.name,
                            securityGroups: properties.securityGroup ? [properties.securityGroup] : undefined,
                            assignPublicIp: false,
                            enableExecuteCommand: true,
                            cloudMapOptions: properties.cloudMapNamespace
                                ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                                : undefined,
                        })
                        : new aws_ecs_1.Ec2Service(this, 'ecs-service-ec2-no-lb', {
                            cluster: properties.ecsCluster,
                            taskDefinition: taskDefinition,
                            desiredCount: properties.desiredTaskCount,
                            serviceName: properties.name,
                            enableExecuteCommand: true,
                            cloudMapOptions: properties.cloudMapNamespace
                                ? { name: properties.name, cloudMapNamespace: properties.cloudMapNamespace }
                                : undefined,
                        });
            }
            else {
                if (properties.computeType == environment_1.ComputeType.Fargate) {
                    loadBalancedService = new aws_ecs_patterns_1.ApplicationLoadBalancedFargateService(this, 'ecs-service-fargate', {
                        cluster: properties.ecsCluster,
                        taskDefinition: taskDefinition,
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
                        properties.securityGroup.addIngressRule(loadBalancedService.loadBalancer.connections.securityGroups[0], aws_ec2_1.Port.tcp(properties.containerPort || 80), 'Allow load balancer to reach ECS tasks');
                    }
                    // Allow traffic from specified subnet type to load balancer
                    if (properties.vpc && loadBalancedService) {
                        const subnets = properties.subnetType === aws_ec2_1.SubnetType.PUBLIC
                            ? properties.vpc.publicSubnets
                            : properties.vpc.privateSubnets;
                        for (const [index, subnet] of subnets.entries()) {
                            loadBalancedService.loadBalancer.connections.allowFrom(aws_ec2_1.Peer.ipv4(subnet.ipv4CidrBlock), aws_ec2_1.Port.tcp(properties.listenerPort || 80), `Allow traffic from ${properties.subnetType || 'private'} subnet ${index + 1}`);
                        }
                    }
                }
                else {
                    loadBalancedService = new aws_ecs_patterns_1.ApplicationLoadBalancedEc2Service(this, 'ecs-service-ec2', {
                        cluster: properties.ecsCluster,
                        taskDefinition: taskDefinition,
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
                        properties.securityGroup.addIngressRule(loadBalancedService.loadBalancer.connections.securityGroups[0], aws_ec2_1.Port.tcp(properties.containerPort || 80), 'Allow load balancer to reach ECS tasks');
                    }
                    // Allow traffic from specified subnet type to load balancer
                    if (properties.vpc && loadBalancedService) {
                        const subnets = properties.subnetType === aws_ec2_1.SubnetType.PUBLIC
                            ? properties.vpc.publicSubnets
                            : properties.vpc.privateSubnets;
                        for (const [index, subnet] of subnets.entries()) {
                            loadBalancedService.loadBalancer.connections.allowFrom(aws_ec2_1.Peer.ipv4(subnet.ipv4CidrBlock), aws_ec2_1.Port.tcp(properties.listenerPort || 80), `Allow traffic from ${properties.subnetType || 'private'} subnet ${index + 1}`);
                        }
                    }
                }
            }
        }
        cdk_nag_1.NagSuppressions.addResourceSuppressions(taskDefinition, [
            {
                id: 'AwsSolutions-ECS2',
                reason: 'AWS_REGION is required by OTEL. TODO: Replace with proper environment variables ',
            },
        ]);
        if (taskDefinition.executionRole) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(taskDefinition.executionRole, [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Allowing * for ECR pull and log access',
                },
            ], true);
        }
        if (taskDefinition.taskRole && properties.openSearchCollection) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(taskDefinition.taskRole, [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'OpenSearch Serverless requires broad permissions for log ingestion',
                },
            ], true);
        }
        if (taskDefinition.taskRole && properties.openSearchPipeline) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(taskDefinition.taskRole, [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'OpenSearch Ingestion Service requires permissions for pipeline access',
                },
            ], true);
        }
        if (loadBalancedService) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(loadBalancedService.loadBalancer, [
                {
                    id: 'AwsSolutions-ELB2',
                    reason: 'Disabled access logs for now',
                },
            ]);
        }
        return { taskDefinition, loadBalancedService, service, container, taskRole };
    }
    createFireLensLogDriver(properties) {
        if (properties.openSearchPipeline) {
            // Configure for OpenSearch Ingestion Pipeline using HTTP output
            const pipeline = properties.openSearchPipeline;
            const pipelineEndpoint = 'pipelineEndpoint' in pipeline
                ? pipeline.pipelineEndpoint
                : pipeline.pipeline.attrIngestEndpointUrls[0];
            // Extract host from pipeline endpoint
            // Pipeline endpoints from OSI are typically just hostnames without https://
            const hostAndPath = aws_cdk_lib_1.Fn.split('/', pipelineEndpoint);
            const host = aws_cdk_lib_1.Fn.select(0, hostAndPath);
            const httpOptions = {
                Name: 'http',
                Match: '*',
                Host: host,
                Port: '443',
                uri: '/log/ingest',
                format: 'json',
                aws_auth: 'true',
                aws_region: aws_cdk_lib_1.Stack.of(this).region,
                aws_service: 'osis',
                tls: 'on',
                'tls.verify': 'off',
                Retry_Limit: '3',
                Log_Level: 'trace',
            };
            // Don't use aws_role_arn - let the ECS task role handle authentication directly
            return new aws_ecs_1.FireLensLogDriver({
                options: httpOptions,
            });
        }
        else if (properties.openSearchCollection) {
            // Configure for direct OpenSearch Collection
            const collection = properties.openSearchCollection;
            const openSearchEndpoint = 'collection' in collection
                ? collection.collection.attrCollectionEndpoint
                : collection.collectionEndpoint;
            // Use CloudFormation functions to strip https:// prefix at deployment time
            const openSearchHostWithoutProtocol = aws_cdk_lib_1.Fn.select(1, aws_cdk_lib_1.Fn.split('https://', openSearchEndpoint));
            return new aws_ecs_1.FireLensLogDriver({
                options: {
                    Name: 'opensearch',
                    Host: openSearchHostWithoutProtocol,
                    Port: '443',
                    aws_auth: 'On',
                    AWS_Region: aws_cdk_lib_1.Stack.of(this).region,
                    AWS_Service_Name: 'aoss',
                    Index: `${properties.name}-logs`,
                    tls: 'On',
                    Suppress_Type_Name: 'On',
                    Trace_Error: 'On',
                    Trace_Output: 'On',
                },
            });
        }
        else {
            throw new Error('Either openSearchCollection or openSearchPipeline must be provided for FireLens logging');
        }
    }
    addFireLensLogRouter(taskDefinition, properties) {
        // Add FireLens log router using the task definition method
        taskDefinition.addFirelensLogRouter('log-router', {
            image: aws_ecs_1.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable'),
            memoryLimitMiB: 512,
            cpu: 256,
            essential: true,
            logging: new aws_ecs_1.AwsLogDriver({
                streamPrefix: 'firelens',
                logGroup: new aws_logs_1.LogGroup(this, 'firelens-log-group', {
                    logGroupName: `/ecs/firelens/${properties.name}`,
                    removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
                    retention: aws_logs_1.RetentionDays.ONE_WEEK,
                }),
            }),
            firelensConfig: {
                type: aws_ecs_1.FirelensLogRouterType.FLUENTBIT,
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
            taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam_1.PolicyStatement({
                effect: aws_iam_1.Effect.ALLOW,
                actions: [
                    'aoss:WriteDocument',
                    'aoss:CreateIndex',
                    'aoss:DescribeIndex',
                    'es:ESHttpPost',
                    'es:ESHttpPut',
                ],
                resources: [collectionArn],
            }));
        }
        else if (properties.openSearchPipeline) {
            // For OpenSearch Ingestion Service pipeline, use HTTP calls with AWS SigV4 auth
            // The ECS task role will authenticate directly with the pipeline endpoint
            const pipeline = properties.openSearchPipeline;
            const pipelineArn = 'pipelineEndpoint' in pipeline
                ? `arn:aws:osis:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:pipeline/*`
                : pipeline.pipeline.attrPipelineArn;
            // Add permissions for pipeline ingestion via HTTP
            taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam_1.PolicyStatement({
                effect: aws_iam_1.Effect.ALLOW,
                actions: ['osis:Ingest'],
                resources: [pipelineArn],
            }));
            // Add permissions for AWS SigV4 signing for HTTP requests to the pipeline
            taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam_1.PolicyStatement({
                effect: aws_iam_1.Effect.ALLOW,
                actions: [
                    'sts:GetCallerIdentity', // Required for SigV4 signing
                ],
                resources: ['*'],
            }));
        }
    }
    addCloudWatchAgentSidecar(taskDefinition, properties) {
        // CloudWatch agent configuration for application signals
        const cloudWatchConfig = {
            traces: {
                traces_collected: {
                    otlp: {}
                },
            },
        };
        // Add CloudWatch agent container
        const cloudWatchContainer = taskDefinition.addContainer('cloudwatch-agent', {
            image: aws_ecs_1.ContainerImage.fromRegistry('public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest'),
            memoryLimitMiB: 256,
            cpu: 128,
            essential: false,
            logging: new aws_ecs_1.AwsLogDriver({
                streamPrefix: 'cloudwatch-agent',
                logGroup: new aws_logs_1.LogGroup(this, 'cloudwatch-agent-log-group', {
                    logGroupName: `/ecs/cloudwatch-agent/${properties.name}`,
                    removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
                    retention: aws_logs_1.RetentionDays.ONE_WEEK,
                }),
            }),
            environment: {
                CW_CONFIG_CONTENT: JSON.stringify(cloudWatchConfig),
                AWS_REGION: aws_cdk_lib_1.Stack.of(this).region,
            },
        });
        // Add necessary permissions for CloudWatch agent
        taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
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
        }));
    }
}
exports.EcsService = EcsService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlY3Mtc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7O0VBR0U7QUFDRixpREFBNkY7QUFDN0YsaURBQXNFO0FBQ3RFLHVEQUFvRDtBQUNwRCxpREFhNkI7QUFDN0IsbUVBSXNDO0FBRXRDLG1EQUErRDtBQUMvRCw2Q0FBdUQ7QUFDdkQscUNBQTBDO0FBQzFDLGlEQUE2RDtBQW9DN0QsTUFBc0IsVUFBVyxTQUFRLDJCQUFZO0lBT2pELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsVUFBZ0M7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFN0IsNkVBQTZFO1FBQzdFLElBQUksVUFBVSxDQUFDLG9CQUFvQixJQUFJLFVBQVUsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQ25FLE1BQU0sSUFBSSxLQUFLLENBQ1gsOEZBQThGLENBQ2pHLENBQUM7UUFDTixDQUFDO1FBRUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3BELElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQztRQUM1QyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsTUFBTSxDQUFDLG1CQUFtQixDQUFDO1FBQ3RELElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQztRQUM5QixJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUM7UUFDbEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDO1FBRWhDLElBQUksQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDaEMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNuQyxDQUFDO0lBRUQsbUJBQW1CO1FBQ2YsTUFBTSxJQUFJLEtBQUssQ0FB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WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbmltcG9ydCB7IEVmZmVjdCwgSVJvbGUsIFBvbGljeVN0YXRlbWVudCwgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgTWljcm9zZXJ2aWNlLCBNaWNyb3NlcnZpY2VQcm9wZXJ0aWVzIH0gZnJvbSAnLi9taWNyb3NlcnZpY2UnO1xuaW1wb3J0IHsgQ29tcHV0ZVR5cGUgfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuaW1wb3J0IHtcbiAgICBBd3NMb2dEcml2ZXIsXG4gICAgQ29udGFpbmVyRGVmaW5pdGlvbixcbiAgICBDb250YWluZXJJbWFnZSxcbiAgICBFYzJUYXNrRGVmaW5pdGlvbixcbiAgICBGYXJnYXRlVGFza0RlZmluaXRpb24sXG4gICAgUHJvdG9jb2wsXG4gICAgVGFza0RlZmluaXRpb24sXG4gICAgRWMyU2VydmljZSxcbiAgICBGYXJnYXRlU2VydmljZSxcbiAgICBCYXNlU2VydmljZSxcbiAgICBGaXJlTGVuc0xvZ0RyaXZlcixcbiAgICBGaXJlbGVuc0xvZ1JvdXRlclR5cGUsXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0IHtcbiAgICBBcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEVjMlNlcnZpY2UsXG4gICAgQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRGYXJnYXRlU2VydmljZSxcbiAgICBBcHBsaWNhdGlvbkxvYWRCYWxhbmNlZFNlcnZpY2VCYXNlLFxufSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTG9nR3JvdXAsIFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBSZW1vdmFsUG9saWN5LCBTdGFjaywgRm4gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IFBvcnQsIFBlZXIsIFN1Ym5ldFR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IElQcml2YXRlRG5zTmFtZXNwYWNlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlcnZpY2VkaXNjb3ZlcnknO1xuaW1wb3J0IHsgT3BlblNlYXJjaENvbGxlY3Rpb24gfSBmcm9tICcuL29wZW5zZWFyY2gtY29sbGVjdGlvbic7XG5pbXBvcnQgeyBPcGVuU2VhcmNoUGlwZWxpbmUgfSBmcm9tICcuL29wZW5zZWFyY2gtcGlwZWxpbmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVjc1NlcnZpY2VQcm9wZXJ0aWVzIGV4dGVuZHMgTWljcm9zZXJ2aWNlUHJvcGVydGllcyB7XG4gICAgY3B1OiBudW1iZXI7XG4gICAgbWVtb3J5TGltaXRNaUI6IG51bWJlcjtcbiAgICBkZXNpcmVkVGFza0NvdW50OiBudW1iZXI7XG4gICAgY2xvdWRNYXBOYW1lc3BhY2U/OiBJUHJpdmF0ZURuc05hbWVzcGFjZTtcbiAgICBvcGVuU2VhcmNoQ29sbGVjdGlvbj86XG4gICAgICAgIHwgT3BlblNlYXJjaENvbGxlY3Rpb25cbiAgICAgICAgfCB7XG4gICAgICAgICAgICAgIGNvbGxlY3Rpb25Bcm46IHN0cmluZztcbiAgICAgICAgICAgICAgY29sbGVjdGlvbkVuZHBvaW50OiBzdHJpbmc7XG4gICAgICAgICAgfTtcbiAgICAvKipcbiAgICAgKiBPcGVuU2VhcmNoIGluZ2VzdGlvbiBwaXBlbGluZSBmb3IgbG9nIHJvdXRpbmdcbiAgICAgKiBXaGVuIHByb3ZpZGVkLCBsb2dzIHdpbGwgYmUgc2VudCB0byB0aGUgcGlwZWxpbmUgaW5zdGVhZCBvZiBkaXJlY3RseSB0byBPcGVuU2VhcmNoXG4gICAgICogTXV0dWFsbHkgZXhjbHVzaXZlIHdpdGggb3BlblNlYXJjaENvbGxlY3Rpb25cbiAgICAgKi9cbiAgICBvcGVuU2VhcmNoUGlwZWxpbmU/OlxuICAgICAgICB8IE9wZW5TZWFyY2hQaXBlbGluZVxuICAgICAgICB8IHtcbiAgICAgICAgICAgICAgcGlwZWxpbmVFbmRwb2ludDogc3RyaW5nO1xuICAgICAgICAgICAgICBwaXBlbGluZUFybj86IHN0cmluZztcbiAgICAgICAgICAgICAgcGlwZWxpbmVSb2xlQXJuPzogc3RyaW5nO1xuICAgICAgICAgIH07XG4gICAgYWRkaXRpb25hbEVudmlyb25tZW50PzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgICAvKipcbiAgICAgKiBFbmFibGUgQ2xvdWRXYXRjaCBhZ2VudCBzaWRlY2FyIGZvciBhcHBsaWNhdGlvbiBzaWduYWxzIGFuZCBPVExQIHRyYWNlc1xuICAgICAqIFdoZW4gZW5hYmxlZCwgYWRkcyBhIENsb3VkV2F0Y2ggYWdlbnQgY29udGFpbmVyIHRoYXQgbGlzdGVucyBvbiBwb3J0IDQzMTdcbiAgICAgKi9cbiAgICBlbmFibGVDbG91ZFdhdGNoQWdlbnQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgRWNzU2VydmljZSBleHRlbmRzIE1pY3Jvc2VydmljZSB7XG4gICAgcHVibGljIHJlYWRvbmx5IHRhc2tEZWZpbml0aW9uOiBUYXNrRGVmaW5pdGlvbjtcbiAgICBwdWJsaWMgcmVhZG9ubHkgbG9hZEJhbGFuY2VkU2VydmljZT86IEFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkU2VydmljZUJhc2U7XG4gICAgcHVibGljIHJlYWRvbmx5IHNlcnZpY2U/OiBCYXNlU2VydmljZTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyOiBDb250YWluZXJEZWZpbml0aW9uO1xuICAgIHB1YmxpYyByZWFkb25seSB0YXNrUm9sZTogSVJvbGU7XG5cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBFY3NTZXJ2aWNlUHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQsIHByb3BlcnRpZXMpO1xuXG4gICAgICAgIC8vIFZhbGlkYXRlIG11dHVhbCBleGNsdXNpdml0eSBvZiBvcGVuU2VhcmNoQ29sbGVjdGlvbiBhbmQgb3BlblNlYXJjaFBpcGVsaW5lXG4gICAgICAgIGlmIChwcm9wZXJ0aWVzLm9wZW5TZWFyY2hDb2xsZWN0aW9uICYmIHByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgJ29wZW5TZWFyY2hDb2xsZWN0aW9uIGFuZCBvcGVuU2VhcmNoUGlwZWxpbmUgYXJlIG11dHVhbGx5IGV4Y2x1c2l2ZS4gUGxlYXNlIHNwZWNpZnkgb25seSBvbmUuJyxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLmNvbmZpZ3VyZUVDU1NlcnZpY2UocHJvcGVydGllcyk7XG4gICAgICAgIHRoaXMudGFza0RlZmluaXRpb24gPSByZXN1bHQudGFza0RlZmluaXRpb247XG4gICAgICAgIHRoaXMubG9hZEJhbGFuY2VkU2VydmljZSA9IHJlc3VsdC5sb2FkQmFsYW5jZWRTZXJ2aWNlO1xuICAgICAgICB0aGlzLnNlcnZpY2UgPSByZXN1bHQuc2VydmljZTtcbiAgICAgICAgdGhpcy5jb250YWluZXIgPSByZXN1bHQuY29udGFpbmVyO1xuICAgICAgICB0aGlzLnRhc2tSb2xlID0gcmVzdWx0LnRhc2tSb2xlO1xuXG4gICAgICAgIHRoaXMuYWRkUGVybWlzc2lvbnMocHJvcGVydGllcyk7XG4gICAgICAgIHRoaXMuY3JlYXRlT3V0cHV0cyhwcm9wZXJ0aWVzKTtcbiAgICB9XG5cbiAgICBjb25maWd1cmVFS1NTZXJ2aWNlKCk6IHZvaWQge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01ldGhvZCBub3QgaW1wbGVtZW50ZWQuJyk7XG4gICAgfVxuXG4gICAgY29uZmlndXJlRUNTU2VydmljZShwcm9wZXJ0aWVzOiBFY3NTZXJ2aWNlUHJvcGVydGllcykge1xuICAgICAgICBsZXQgbG9hZEJhbGFuY2VkU2VydmljZTogQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRTZXJ2aWNlQmFzZSB8IHVuZGVmaW5lZDtcbiAgICAgICAgbGV0IHNlcnZpY2U6IEJhc2VTZXJ2aWNlIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIGxvZyBncm91cFxuICAgICAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBMb2dHcm91cCh0aGlzLCAnZWNzLWxvZy1ncm91cCcsIHtcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogcHJvcGVydGllcy5sb2dHcm91cE5hbWUgfHwgYC9lY3MvJHtwcm9wZXJ0aWVzLm5hbWV9YCxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIHJldGVudGlvbjogcHJvcGVydGllcy5sb2dSZXRlbnRpb25EYXlzIHx8IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENvbmZpZ3VyZSBsb2dnaW5nIGJhc2VkIG9uIHdoZXRoZXIgT3BlblNlYXJjaCBjb2xsZWN0aW9uIG9yIHBpcGVsaW5lIGlzIHByb3ZpZGVkXG4gICAgICAgIGNvbnN0IGxvZ2dpbmcgPVxuICAgICAgICAgICAgcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvbiB8fCBwcm9wZXJ0aWVzLm9wZW5TZWFyY2hQaXBlbGluZVxuICAgICAgICAgICAgICAgID8gLy8gVXNlIEZpcmVMZW5zIGZvciByb3V0aW5nIHRvIE9wZW5TZWFyY2ggY29sbGVjdGlvbiBvciBwaXBlbGluZVxuICAgICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVGaXJlTGVuc0xvZ0RyaXZlcihwcm9wZXJ0aWVzKVxuICAgICAgICAgICAgICAgIDogLy8gVXNlIHN0YW5kYXJkIENsb3VkV2F0Y2ggbG9nZ2luZ1xuICAgICAgICAgICAgICAgICAgbmV3IEF3c0xvZ0RyaXZlcih7XG4gICAgICAgICAgICAgICAgICAgICAgc3RyZWFtUHJlZml4OiAnbG9ncycsXG4gICAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXA6IGxvZ0dyb3VwLFxuICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgdGFza1JvbGUgPSBuZXcgUm9sZSh0aGlzLCBgdGFza1JvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB0YXNrRGVmaW5pdGlvbiA9XG4gICAgICAgICAgICBwcm9wZXJ0aWVzLmNvbXB1dGVUeXBlID09IENvbXB1dGVUeXBlLkZhcmdhdGVcbiAgICAgICAgICAgICAgICA/IG5ldyBGYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ3Rhc2tEZWZpbml0aW9uJywge1xuICAgICAgICAgICAgICAgICAgICAgIGNwdTogcHJvcGVydGllcy5jcHUsIC8vIFRPRE86IFNvbWUgbWF0aCBpcyBuZWVkZWQgaGVyZSBzbyB0aGUgdmFsdWUgaW5jbHVkZXMgQ29udGFpbmVyICsgU2lkZWNhcnNcbiAgICAgICAgICAgICAgICAgICAgICB0YXNrUm9sZTogdGFza1JvbGUsXG4gICAgICAgICAgICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IHByb3BlcnRpZXMubWVtb3J5TGltaXRNaUIsXG4gICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIDogbmV3IEVjMlRhc2tEZWZpbml0aW9uKHRoaXMsICd0YXNrRGVmaW5pdGlvbicsIHtcbiAgICAgICAgICAgICAgICAgICAgICB0YXNrUm9sZTogdGFza1JvbGUsXG4gICAgICAgICAgICAgICAgICAgICAgZW5hYmxlRmF1bHRJbmplY3Rpb246IHRydWUsXG4gICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgZXhlY3V0aW9uIHJvbGUgcGVybWlzc2lvbnNcbiAgICAgICAgY29uc3QgZXhlY3V0aW9uUm9sZUFjdGlvbnMgPSBbXG4gICAgICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAgICAgJ2VjcjpCYXRjaEdldEltYWdlJyxcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICBdO1xuXG4gICAgICAgIC8vIEFkZCBPcGVuU2VhcmNoIHBlcm1pc3Npb25zIG9ubHkgaWYgY29sbGVjdGlvbiBpcyBwcm92aWRlZCBBTkQgcGlwZWxpbmUgaXMgbm90IHVzZWRcbiAgICAgICAgLy8gV2hlbiB1c2luZyBwaXBlbGluZSwgdGhlIHBpcGVsaW5lIGhhbmRsZXMgT3BlblNlYXJjaCBhY2Nlc3MsIG5vdCB0aGUgRUNTIHRhc2tcbiAgICAgICAgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb24gJiYgIXByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lKSB7XG4gICAgICAgICAgICBleGVjdXRpb25Sb2xlQWN0aW9ucy5wdXNoKFxuICAgICAgICAgICAgICAgICdhb3NzOldyaXRlRG9jdW1lbnQnLFxuICAgICAgICAgICAgICAgICdhb3NzOkNyZWF0ZUluZGV4JyxcbiAgICAgICAgICAgICAgICAnYW9zczpEZXNjcmliZUluZGV4JyxcbiAgICAgICAgICAgICAgICAnYW9zczpVcGRhdGVJbmRleCcsXG4gICAgICAgICAgICAgICAgJ2VzOkVTSHR0cFBvc3QnLFxuICAgICAgICAgICAgICAgICdlczpFU0h0dHBQdXQnLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE5vdGU6IFBpcGVsaW5lIHBlcm1pc3Npb25zIGFyZSBoYW5kbGVkIGluIHRoZSB0YXNrIHJvbGUsIG5vdCBleGVjdXRpb24gcm9sZVxuXG4gICAgICAgIHRhc2tEZWZpbml0aW9uLmFkZFRvRXhlY3V0aW9uUm9sZVBvbGljeShcbiAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IGV4ZWN1dGlvblJvbGVBY3Rpb25zLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBpbWFnZSA9IENvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeShwcm9wZXJ0aWVzLnJlcG9zaXRvcnlVUkkpO1xuXG4gICAgICAgIC8vIE1lcmdlIGRlZmF1bHQgZW52aXJvbm1lbnQgdmFyaWFibGVzIHdpdGggYWRkaXRpb25hbCBvbmVzXG4gICAgICAgIGNvbnN0IGRlZmF1bHRFbnZpcm9ubWVudCA9IHtcbiAgICAgICAgICAgIC8vIGNsZWFyIHRleHQsIG5vdCBmb3Igc2Vuc2l0aXZlIGRhdGFcbiAgICAgICAgICAgIEFXU19SRUdJT046IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBlbnZpcm9ubWVudCA9IHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRFbnZpcm9ubWVudCxcbiAgICAgICAgICAgIC4uLnByb3BlcnRpZXMuYWRkaXRpb25hbEVudmlyb25tZW50LFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignY29udGFpbmVyJywge1xuICAgICAgICAgICAgaW1hZ2U6IGltYWdlLFxuICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcbiAgICAgICAgICAgIGNwdTogMjU2LFxuICAgICAgICAgICAgbG9nZ2luZyxcbiAgICAgICAgICAgIGVudmlyb25tZW50LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb250YWluZXIuYWRkUG9ydE1hcHBpbmdzKHtcbiAgICAgICAgICAgIGNvbnRhaW5lclBvcnQ6IHByb3BlcnRpZXMuY29udGFpbmVyUG9ydCB8fCA4MCxcbiAgICAgICAgICAgIHByb3RvY29sOiBQcm90b2NvbC5UQ1AsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBGaXJlTGVucyBsb2cgcm91dGVyIGNvbnRhaW5lciBpZiBPcGVuU2VhcmNoIGNvbGxlY3Rpb24gb3IgcGlwZWxpbmUgaXMgcHJvdmlkZWRcbiAgICAgICAgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb24gfHwgcHJvcGVydGllcy5vcGVuU2VhcmNoUGlwZWxpbmUpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkRmlyZUxlbnNMb2dSb3V0ZXIodGFza0RlZmluaXRpb24sIHByb3BlcnRpZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIENsb3VkV2F0Y2ggYWdlbnQgc2lkZWNhciBpZiBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICAgICAgaWYgKHByb3BlcnRpZXMuZW5hYmxlQ2xvdWRXYXRjaEFnZW50KSB7XG4gICAgICAgICAgICB0aGlzLmFkZENsb3VkV2F0Y2hBZ2VudFNpZGVjYXIodGFza0RlZmluaXRpb24sIHByb3BlcnRpZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzLmRpc2FibGVTZXJ2aWNlKSB7XG4gICAgICAgICAgICBpZiAocHJvcGVydGllcy5jcmVhdGVMb2FkQmFsYW5jZXIgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHNlcnZpY2Ugd2l0aG91dCBsb2FkIGJhbGFuY2VyXG4gICAgICAgICAgICAgICAgc2VydmljZSA9XG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXMuY29tcHV0ZVR5cGUgPT0gQ29tcHV0ZVR5cGUuRmFyZ2F0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgPyBuZXcgRmFyZ2F0ZVNlcnZpY2UodGhpcywgJ2Vjcy1zZXJ2aWNlLWZhcmdhdGUtbm8tbGInLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHVzdGVyOiBwcm9wZXJ0aWVzLmVjc0NsdXN0ZXIhLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFza0RlZmluaXRpb246IHRhc2tEZWZpbml0aW9uIGFzIEZhcmdhdGVUYXNrRGVmaW5pdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRDb3VudDogcHJvcGVydGllcy5kZXNpcmVkVGFza0NvdW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VydmljZU5hbWU6IHByb3BlcnRpZXMubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlY3VyaXR5R3JvdXBzOiBwcm9wZXJ0aWVzLnNlY3VyaXR5R3JvdXAgPyBbcHJvcGVydGllcy5zZWN1cml0eUdyb3VwXSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzc2lnblB1YmxpY0lwOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xvdWRNYXBPcHRpb25zOiBwcm9wZXJ0aWVzLmNsb3VkTWFwTmFtZXNwYWNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyB7IG5hbWU6IHByb3BlcnRpZXMubmFtZSwgY2xvdWRNYXBOYW1lc3BhY2U6IHByb3BlcnRpZXMuY2xvdWRNYXBOYW1lc3BhY2UgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgOiBuZXcgRWMyU2VydmljZSh0aGlzLCAnZWNzLXNlcnZpY2UtZWMyLW5vLWxiJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2x1c3RlcjogcHJvcGVydGllcy5lY3NDbHVzdGVyISxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2tEZWZpbml0aW9uOiB0YXNrRGVmaW5pdGlvbiBhcyBFYzJUYXNrRGVmaW5pdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRDb3VudDogcHJvcGVydGllcy5kZXNpcmVkVGFza0NvdW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VydmljZU5hbWU6IHByb3BlcnRpZXMubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xvdWRNYXBPcHRpb25zOiBwcm9wZXJ0aWVzLmNsb3VkTWFwTmFtZXNwYWNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyB7IG5hbWU6IHByb3BlcnRpZXMubmFtZSwgY2xvdWRNYXBOYW1lc3BhY2U6IHByb3BlcnRpZXMuY2xvdWRNYXBOYW1lc3BhY2UgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMuY29tcHV0ZVR5cGUgPT0gQ29tcHV0ZVR5cGUuRmFyZ2F0ZSkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkQmFsYW5jZWRTZXJ2aWNlID0gbmV3IEFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UodGhpcywgJ2Vjcy1zZXJ2aWNlLWZhcmdhdGUnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbHVzdGVyOiBwcm9wZXJ0aWVzLmVjc0NsdXN0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGFza0RlZmluaXRpb24gYXMgRmFyZ2F0ZVRhc2tEZWZpbml0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRDb3VudDogcHJvcGVydGllcy5kZXNpcmVkVGFza0NvdW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgbGlzdGVuZXJQb3J0OiBwcm9wZXJ0aWVzLmxpc3RlbmVyUG9ydCB8fCA4MCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3VyaXR5R3JvdXBzOiBwcm9wZXJ0aWVzLnNlY3VyaXR5R3JvdXAgPyBbcHJvcGVydGllcy5zZWN1cml0eUdyb3VwXSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5MaXN0ZW5lcjogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlTmFtZTogcHJvcGVydGllcy5uYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9hZEJhbGFuY2VyTmFtZTogYExCLSR7cHJvcGVydGllcy5uYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVFeGVjdXRlQ29tbWFuZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb3VkTWFwT3B0aW9uczogcHJvcGVydGllcy5jbG91ZE1hcE5hbWVzcGFjZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8geyBuYW1lOiBwcm9wZXJ0aWVzLm5hbWUsIGNsb3VkTWFwTmFtZXNwYWNlOiBwcm9wZXJ0aWVzLmNsb3VkTWFwTmFtZXNwYWNlIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMuaGVhbHRoQ2hlY2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UudGFyZ2V0R3JvdXAuY29uZmlndXJlSGVhbHRoQ2hlY2soe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHByb3BlcnRpZXMuaGVhbHRoQ2hlY2ssXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIEFsbG93IGxvYWQgYmFsYW5jZXIgdG8gY29tbXVuaWNhdGUgd2l0aCBFQ1MgdGFza3NcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllcy5zZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLnNlY3VyaXR5R3JvdXBzWzBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFBvcnQudGNwKHByb3BlcnRpZXMuY29udGFpbmVyUG9ydCB8fCA4MCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ0FsbG93IGxvYWQgYmFsYW5jZXIgdG8gcmVhY2ggRUNTIHRhc2tzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBBbGxvdyB0cmFmZmljIGZyb20gc3BlY2lmaWVkIHN1Ym5ldCB0eXBlIHRvIGxvYWQgYmFsYW5jZXJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMudnBjICYmIGxvYWRCYWxhbmNlZFNlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN1Ym5ldHMgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXMuc3VibmV0VHlwZSA9PT0gU3VibmV0VHlwZS5QVUJMSUNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBwcm9wZXJ0aWVzLnZwYy5wdWJsaWNTdWJuZXRzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogcHJvcGVydGllcy52cGMucHJpdmF0ZVN1Ym5ldHM7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtpbmRleCwgc3VibmV0XSBvZiBzdWJuZXRzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLmFsbG93RnJvbShcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUGVlci5pcHY0KHN1Ym5ldC5pcHY0Q2lkckJsb2NrKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUG9ydC50Y3AocHJvcGVydGllcy5saXN0ZW5lclBvcnQgfHwgODApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgQWxsb3cgdHJhZmZpYyBmcm9tICR7cHJvcGVydGllcy5zdWJuZXRUeXBlIHx8ICdwcml2YXRlJ30gc3VibmV0ICR7aW5kZXggKyAxfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UgPSBuZXcgQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRFYzJTZXJ2aWNlKHRoaXMsICdlY3Mtc2VydmljZS1lYzInLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbHVzdGVyOiBwcm9wZXJ0aWVzLmVjc0NsdXN0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGFza0RlZmluaXRpb24gYXMgRmFyZ2F0ZVRhc2tEZWZpbml0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRDb3VudDogcHJvcGVydGllcy5kZXNpcmVkVGFza0NvdW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgbGlzdGVuZXJQb3J0OiBwcm9wZXJ0aWVzLmxpc3RlbmVyUG9ydCB8fCA4MCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5MaXN0ZW5lcjogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlTmFtZTogcHJvcGVydGllcy5uYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9hZEJhbGFuY2VyTmFtZTogYExCLSR7cHJvcGVydGllcy5uYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVFeGVjdXRlQ29tbWFuZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb3VkTWFwT3B0aW9uczogcHJvcGVydGllcy5jbG91ZE1hcE5hbWVzcGFjZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8geyBuYW1lOiBwcm9wZXJ0aWVzLm5hbWUsIGNsb3VkTWFwTmFtZXNwYWNlOiBwcm9wZXJ0aWVzLmNsb3VkTWFwTmFtZXNwYWNlIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMuaGVhbHRoQ2hlY2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UudGFyZ2V0R3JvdXAuY29uZmlndXJlSGVhbHRoQ2hlY2soe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHByb3BlcnRpZXMuaGVhbHRoQ2hlY2ssXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIEFsbG93IGxvYWQgYmFsYW5jZXIgdG8gY29tbXVuaWNhdGUgd2l0aCBFQ1MgdGFza3NcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllcy5zZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLnNlY3VyaXR5R3JvdXBzWzBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFBvcnQudGNwKHByb3BlcnRpZXMuY29udGFpbmVyUG9ydCB8fCA4MCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ0FsbG93IGxvYWQgYmFsYW5jZXIgdG8gcmVhY2ggRUNTIHRhc2tzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBBbGxvdyB0cmFmZmljIGZyb20gc3BlY2lmaWVkIHN1Ym5ldCB0eXBlIHRvIGxvYWQgYmFsYW5jZXJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BlcnRpZXMudnBjICYmIGxvYWRCYWxhbmNlZFNlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN1Ym5ldHMgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXMuc3VibmV0VHlwZSA9PT0gU3VibmV0VHlwZS5QVUJMSUNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBwcm9wZXJ0aWVzLnZwYy5wdWJsaWNTdWJuZXRzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogcHJvcGVydGllcy52cGMucHJpdmF0ZVN1Ym5ldHM7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtpbmRleCwgc3VibmV0XSBvZiBzdWJuZXRzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvYWRCYWxhbmNlZFNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLmFsbG93RnJvbShcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUGVlci5pcHY0KHN1Ym5ldC5pcHY0Q2lkckJsb2NrKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUG9ydC50Y3AocHJvcGVydGllcy5saXN0ZW5lclBvcnQgfHwgODApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgQWxsb3cgdHJhZmZpYyBmcm9tICR7cHJvcGVydGllcy5zdWJuZXRUeXBlIHx8ICdwcml2YXRlJ30gc3VibmV0ICR7aW5kZXggKyAxfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0YXNrRGVmaW5pdGlvbiwgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUVDUzInLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ0FXU19SRUdJT04gaXMgcmVxdWlyZWQgYnkgT1RFTC4gVE9ETzogUmVwbGFjZSB3aXRoIHByb3BlciBlbnZpcm9ubWVudCB2YXJpYWJsZXMgJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIF0pO1xuXG4gICAgICAgIGlmICh0YXNrRGVmaW5pdGlvbi5leGVjdXRpb25Sb2xlKSB7XG4gICAgICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICAgICAgdGFza0RlZmluaXRpb24uZXhlY3V0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnQWxsb3dpbmcgKiBmb3IgRUNSIHB1bGwgYW5kIGxvZyBhY2Nlc3MnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGFza0RlZmluaXRpb24udGFza1JvbGUgJiYgcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvbikge1xuICAgICAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgICAgIHRhc2tEZWZpbml0aW9uLnRhc2tSb2xlLFxuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWFzb246ICdPcGVuU2VhcmNoIFNlcnZlcmxlc3MgcmVxdWlyZXMgYnJvYWQgcGVybWlzc2lvbnMgZm9yIGxvZyBpbmdlc3Rpb24nLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGFza0RlZmluaXRpb24udGFza1JvbGUgJiYgcHJvcGVydGllcy5vcGVuU2VhcmNoUGlwZWxpbmUpIHtcbiAgICAgICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgICAgICB0YXNrRGVmaW5pdGlvbi50YXNrUm9sZSxcbiAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnT3BlblNlYXJjaCBJbmdlc3Rpb24gU2VydmljZSByZXF1aXJlcyBwZXJtaXNzaW9ucyBmb3IgcGlwZWxpbmUgYWNjZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHRydWUsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGxvYWRCYWxhbmNlZFNlcnZpY2UpIHtcbiAgICAgICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhsb2FkQmFsYW5jZWRTZXJ2aWNlLmxvYWRCYWxhbmNlciwgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUxCMicsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0Rpc2FibGVkIGFjY2VzcyBsb2dzIGZvciBub3cnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IHRhc2tEZWZpbml0aW9uLCBsb2FkQmFsYW5jZWRTZXJ2aWNlLCBzZXJ2aWNlLCBjb250YWluZXIsIHRhc2tSb2xlIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVGaXJlTGVuc0xvZ0RyaXZlcihwcm9wZXJ0aWVzOiBFY3NTZXJ2aWNlUHJvcGVydGllcyk6IEZpcmVMZW5zTG9nRHJpdmVyIHtcbiAgICAgICAgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lKSB7XG4gICAgICAgICAgICAvLyBDb25maWd1cmUgZm9yIE9wZW5TZWFyY2ggSW5nZXN0aW9uIFBpcGVsaW5lIHVzaW5nIEhUVFAgb3V0cHV0XG4gICAgICAgICAgICBjb25zdCBwaXBlbGluZSA9IHByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lO1xuICAgICAgICAgICAgY29uc3QgcGlwZWxpbmVFbmRwb2ludCA9XG4gICAgICAgICAgICAgICAgJ3BpcGVsaW5lRW5kcG9pbnQnIGluIHBpcGVsaW5lXG4gICAgICAgICAgICAgICAgICAgID8gcGlwZWxpbmUucGlwZWxpbmVFbmRwb2ludFxuICAgICAgICAgICAgICAgICAgICA6IChwaXBlbGluZSBhcyBPcGVuU2VhcmNoUGlwZWxpbmUpLnBpcGVsaW5lLmF0dHJJbmdlc3RFbmRwb2ludFVybHNbMF07XG5cbiAgICAgICAgICAgIC8vIEV4dHJhY3QgaG9zdCBmcm9tIHBpcGVsaW5lIGVuZHBvaW50XG4gICAgICAgICAgICAvLyBQaXBlbGluZSBlbmRwb2ludHMgZnJvbSBPU0kgYXJlIHR5cGljYWxseSBqdXN0IGhvc3RuYW1lcyB3aXRob3V0IGh0dHBzOi8vXG4gICAgICAgICAgICBjb25zdCBob3N0QW5kUGF0aCA9IEZuLnNwbGl0KCcvJywgcGlwZWxpbmVFbmRwb2ludCk7XG4gICAgICAgICAgICBjb25zdCBob3N0ID0gRm4uc2VsZWN0KDAsIGhvc3RBbmRQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IGh0dHBPcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9ID0ge1xuICAgICAgICAgICAgICAgIE5hbWU6ICdodHRwJyxcbiAgICAgICAgICAgICAgICBNYXRjaDogJyonLFxuICAgICAgICAgICAgICAgIEhvc3Q6IGhvc3QsXG4gICAgICAgICAgICAgICAgUG9ydDogJzQ0MycsXG4gICAgICAgICAgICAgICAgdXJpOiAnL2xvZy9pbmdlc3QnLFxuICAgICAgICAgICAgICAgIGZvcm1hdDogJ2pzb24nLFxuICAgICAgICAgICAgICAgIGF3c19hdXRoOiAndHJ1ZScsXG4gICAgICAgICAgICAgICAgYXdzX3JlZ2lvbjogU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgICAgICAgIGF3c19zZXJ2aWNlOiAnb3NpcycsXG4gICAgICAgICAgICAgICAgdGxzOiAnb24nLFxuICAgICAgICAgICAgICAgICd0bHMudmVyaWZ5JzogJ29mZicsXG4gICAgICAgICAgICAgICAgUmV0cnlfTGltaXQ6ICczJyxcbiAgICAgICAgICAgICAgICBMb2dfTGV2ZWw6ICd0cmFjZScsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBEb24ndCB1c2UgYXdzX3JvbGVfYXJuIC0gbGV0IHRoZSBFQ1MgdGFzayByb2xlIGhhbmRsZSBhdXRoZW50aWNhdGlvbiBkaXJlY3RseVxuXG4gICAgICAgICAgICByZXR1cm4gbmV3IEZpcmVMZW5zTG9nRHJpdmVyKHtcbiAgICAgICAgICAgICAgICBvcHRpb25zOiBodHRwT3B0aW9ucyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb24pIHtcbiAgICAgICAgICAgIC8vIENvbmZpZ3VyZSBmb3IgZGlyZWN0IE9wZW5TZWFyY2ggQ29sbGVjdGlvblxuICAgICAgICAgICAgY29uc3QgY29sbGVjdGlvbiA9IHByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb247XG4gICAgICAgICAgICBjb25zdCBvcGVuU2VhcmNoRW5kcG9pbnQgPVxuICAgICAgICAgICAgICAgICdjb2xsZWN0aW9uJyBpbiBjb2xsZWN0aW9uXG4gICAgICAgICAgICAgICAgICAgID8gY29sbGVjdGlvbi5jb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnRcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xsZWN0aW9uLmNvbGxlY3Rpb25FbmRwb2ludDtcblxuICAgICAgICAgICAgLy8gVXNlIENsb3VkRm9ybWF0aW9uIGZ1bmN0aW9ucyB0byBzdHJpcCBodHRwczovLyBwcmVmaXggYXQgZGVwbG95bWVudCB0aW1lXG4gICAgICAgICAgICBjb25zdCBvcGVuU2VhcmNoSG9zdFdpdGhvdXRQcm90b2NvbCA9IEZuLnNlbGVjdCgxLCBGbi5zcGxpdCgnaHR0cHM6Ly8nLCBvcGVuU2VhcmNoRW5kcG9pbnQpKTtcblxuICAgICAgICAgICAgcmV0dXJuIG5ldyBGaXJlTGVuc0xvZ0RyaXZlcih7XG4gICAgICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICBOYW1lOiAnb3BlbnNlYXJjaCcsXG4gICAgICAgICAgICAgICAgICAgIEhvc3Q6IG9wZW5TZWFyY2hIb3N0V2l0aG91dFByb3RvY29sLFxuICAgICAgICAgICAgICAgICAgICBQb3J0OiAnNDQzJyxcbiAgICAgICAgICAgICAgICAgICAgYXdzX2F1dGg6ICdPbicsXG4gICAgICAgICAgICAgICAgICAgIEFXU19SZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICAgICAgICAgICAgQVdTX1NlcnZpY2VfTmFtZTogJ2Fvc3MnLFxuICAgICAgICAgICAgICAgICAgICBJbmRleDogYCR7cHJvcGVydGllcy5uYW1lfS1sb2dzYCxcbiAgICAgICAgICAgICAgICAgICAgdGxzOiAnT24nLFxuICAgICAgICAgICAgICAgICAgICBTdXBwcmVzc19UeXBlX05hbWU6ICdPbicsXG4gICAgICAgICAgICAgICAgICAgIFRyYWNlX0Vycm9yOiAnT24nLFxuICAgICAgICAgICAgICAgICAgICBUcmFjZV9PdXRwdXQ6ICdPbicsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFaXRoZXIgb3BlblNlYXJjaENvbGxlY3Rpb24gb3Igb3BlblNlYXJjaFBpcGVsaW5lIG11c3QgYmUgcHJvdmlkZWQgZm9yIEZpcmVMZW5zIGxvZ2dpbmcnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYWRkRmlyZUxlbnNMb2dSb3V0ZXIodGFza0RlZmluaXRpb246IFRhc2tEZWZpbml0aW9uLCBwcm9wZXJ0aWVzOiBFY3NTZXJ2aWNlUHJvcGVydGllcyk6IHZvaWQge1xuICAgICAgICAvLyBBZGQgRmlyZUxlbnMgbG9nIHJvdXRlciB1c2luZyB0aGUgdGFzayBkZWZpbml0aW9uIG1ldGhvZFxuICAgICAgICB0YXNrRGVmaW5pdGlvbi5hZGRGaXJlbGVuc0xvZ1JvdXRlcignbG9nLXJvdXRlcicsIHtcbiAgICAgICAgICAgIGltYWdlOiBDb250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoJ3B1YmxpYy5lY3IuYXdzL2F3cy1vYnNlcnZhYmlsaXR5L2F3cy1mb3ItZmx1ZW50LWJpdDpzdGFibGUnKSxcbiAgICAgICAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICAgICAgICBjcHU6IDI1NixcbiAgICAgICAgICAgIGVzc2VudGlhbDogdHJ1ZSxcbiAgICAgICAgICAgIGxvZ2dpbmc6IG5ldyBBd3NMb2dEcml2ZXIoe1xuICAgICAgICAgICAgICAgIHN0cmVhbVByZWZpeDogJ2ZpcmVsZW5zJyxcbiAgICAgICAgICAgICAgICBsb2dHcm91cDogbmV3IExvZ0dyb3VwKHRoaXMsICdmaXJlbGVucy1sb2ctZ3JvdXAnLCB7XG4gICAgICAgICAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvZmlyZWxlbnMvJHtwcm9wZXJ0aWVzLm5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgICAgICAgICByZXRlbnRpb246IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIGZpcmVsZW5zQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogRmlyZWxlbnNMb2dSb3V0ZXJUeXBlLkZMVUVOVEJJVCxcbiAgICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZUVDU0xvZ01ldGFkYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgdGFzayByb2xlIHBlcm1pc3Npb25zIGJhc2VkIG9uIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb24gJiYgIXByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lKSB7XG4gICAgICAgICAgICAvLyBBZGQgcGVybWlzc2lvbnMgZm9yIGRpcmVjdCBPcGVuU2VhcmNoIGFjY2VzcyBvbmx5IHdoZW4gbm90IHVzaW5nIHBpcGVsaW5lXG4gICAgICAgICAgICBjb25zdCBjb2xsZWN0aW9uID0gcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvbjtcbiAgICAgICAgICAgIGNvbnN0IGNvbGxlY3Rpb25Bcm4gPSAnY29sbGVjdGlvbicgaW4gY29sbGVjdGlvbiA/IGNvbGxlY3Rpb24uY29sbGVjdGlvbi5hdHRyQXJuIDogY29sbGVjdGlvbi5jb2xsZWN0aW9uQXJuO1xuXG4gICAgICAgICAgICB0YXNrRGVmaW5pdGlvbi50YXNrUm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgICAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhb3NzOldyaXRlRG9jdW1lbnQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlSW5kZXgnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVJbmRleCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXM6RVNIdHRwUG9zdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXM6RVNIdHRwUHV0JyxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbY29sbGVjdGlvbkFybl0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3BlcnRpZXMub3BlblNlYXJjaFBpcGVsaW5lKSB7XG4gICAgICAgICAgICAvLyBGb3IgT3BlblNlYXJjaCBJbmdlc3Rpb24gU2VydmljZSBwaXBlbGluZSwgdXNlIEhUVFAgY2FsbHMgd2l0aCBBV1MgU2lnVjQgYXV0aFxuICAgICAgICAgICAgLy8gVGhlIEVDUyB0YXNrIHJvbGUgd2lsbCBhdXRoZW50aWNhdGUgZGlyZWN0bHkgd2l0aCB0aGUgcGlwZWxpbmUgZW5kcG9pbnRcbiAgICAgICAgICAgIGNvbnN0IHBpcGVsaW5lID0gcHJvcGVydGllcy5vcGVuU2VhcmNoUGlwZWxpbmU7XG4gICAgICAgICAgICBjb25zdCBwaXBlbGluZUFybiA9XG4gICAgICAgICAgICAgICAgJ3BpcGVsaW5lRW5kcG9pbnQnIGluIHBpcGVsaW5lXG4gICAgICAgICAgICAgICAgICAgID8gYGFybjphd3M6b3Npczoke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtTdGFjay5vZih0aGlzKS5hY2NvdW50fTpwaXBlbGluZS8qYFxuICAgICAgICAgICAgICAgICAgICA6IChwaXBlbGluZSBhcyBPcGVuU2VhcmNoUGlwZWxpbmUpLnBpcGVsaW5lLmF0dHJQaXBlbGluZUFybjtcblxuICAgICAgICAgICAgLy8gQWRkIHBlcm1pc3Npb25zIGZvciBwaXBlbGluZSBpbmdlc3Rpb24gdmlhIEhUVFBcbiAgICAgICAgICAgIHRhc2tEZWZpbml0aW9uLnRhc2tSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogWydvc2lzOkluZ2VzdCddLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtwaXBlbGluZUFybl0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBBZGQgcGVybWlzc2lvbnMgZm9yIEFXUyBTaWdWNCBzaWduaW5nIGZvciBIVFRQIHJlcXVlc3RzIHRvIHRoZSBwaXBlbGluZVxuICAgICAgICAgICAgdGFza0RlZmluaXRpb24udGFza1JvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RzOkdldENhbGxlcklkZW50aXR5JywgLy8gUmVxdWlyZWQgZm9yIFNpZ1Y0IHNpZ25pbmdcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFkZENsb3VkV2F0Y2hBZ2VudFNpZGVjYXIodGFza0RlZmluaXRpb246IFRhc2tEZWZpbml0aW9uLCBwcm9wZXJ0aWVzOiBFY3NTZXJ2aWNlUHJvcGVydGllcyk6IHZvaWQge1xuICAgICAgICAvLyBDbG91ZFdhdGNoIGFnZW50IGNvbmZpZ3VyYXRpb24gZm9yIGFwcGxpY2F0aW9uIHNpZ25hbHNcbiAgICAgICAgY29uc3QgY2xvdWRXYXRjaENvbmZpZyA9IHtcbiAgICAgICAgICAgIHRyYWNlczoge1xuICAgICAgICAgICAgICAgIHRyYWNlc19jb2xsZWN0ZWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgb3RscDoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBBZGQgQ2xvdWRXYXRjaCBhZ2VudCBjb250YWluZXJcbiAgICAgICAgY29uc3QgY2xvdWRXYXRjaENvbnRhaW5lciA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignY2xvdWR3YXRjaC1hZ2VudCcsIHtcbiAgICAgICAgICAgIGltYWdlOiBDb250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoJ3B1YmxpYy5lY3IuYXdzL2Nsb3Vkd2F0Y2gtYWdlbnQvY2xvdWR3YXRjaC1hZ2VudDpsYXRlc3QnKSxcbiAgICAgICAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXG4gICAgICAgICAgICBjcHU6IDEyOCxcbiAgICAgICAgICAgIGVzc2VudGlhbDogZmFsc2UsXG4gICAgICAgICAgICBsb2dnaW5nOiBuZXcgQXdzTG9nRHJpdmVyKHtcbiAgICAgICAgICAgICAgICBzdHJlYW1QcmVmaXg6ICdjbG91ZHdhdGNoLWFnZW50JyxcbiAgICAgICAgICAgICAgICBsb2dHcm91cDogbmV3IExvZ0dyb3VwKHRoaXMsICdjbG91ZHdhdGNoLWFnZW50LWxvZy1ncm91cCcsIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2Vjcy9jbG91ZHdhdGNoLWFnZW50LyR7cHJvcGVydGllcy5uYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgICAgICAgICAgcmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIENXX0NPTkZJR19DT05URU5UOiBKU09OLnN0cmluZ2lmeShjbG91ZFdhdGNoQ29uZmlnKSxcbiAgICAgICAgICAgICAgICBBV1NfUkVHSU9OOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgbmVjZXNzYXJ5IHBlcm1pc3Npb25zIGZvciBDbG91ZFdhdGNoIGFnZW50XG4gICAgICAgIHRhc2tEZWZpbml0aW9uLnRhc2tSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgJ2VjMjpEZXNjcmliZVZvbHVtZXMnLFxuICAgICAgICAgICAgICAgICAgICAnZWMyOkRlc2NyaWJlVGFncycsXG4gICAgICAgICAgICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICAgICAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dHcm91cHMnLFxuICAgICAgICAgICAgICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxufVxuIl19