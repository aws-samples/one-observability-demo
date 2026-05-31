/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pet Food AI Agent construct (Python on Bedrock AgentCore).
 *
 * Deploys an AI-powered pet food recommendation agent using Amazon Bedrock:
 *
 * - **Bedrock AgentCore Runtime** for managed agent hosting
 * - **Strands Agents SDK** for agent orchestration with tool use
 * - **IAM roles** with Bedrock model invocation and SSM parameter access
 *
 * The agent is invoked from the petsite-net frontend's "Waggle" chat interface
 * and can query the petfood-rs service for food recommendations.
 *
 * > **Note**: The container is built in the Containers stage but deployed via
 * > Bedrock AgentCore (not ECS/EKS), so `disableService: true` is set in the
 * > microservice placement configuration.
 *
 * @packageDocumentation
 */
import { CfnOutput, Stack, CustomResource, Duration } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal, Effect, PrincipalWithConditions, Policy, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { CfnRuntime } from 'aws-cdk-lib/aws-bedrockagentcore';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId, AwsSdkCall } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';

/** Properties for the Pet Food AI Agent construct. */
export interface PetFoodAgentProperties {
    /** ECR repository URI for the agent container image */
    readonly ecrRepositoryUri: string; // ECR repository URI from containers pipeline
    /** Security groups for the agent runtime */
    readonly securityGroups: ISecurityGroup[];
    /** VPC for network placement */
    readonly vpc: IVpc;
}

/**
 * Pet Food AI Agent construct (Python/Strands on Bedrock AgentCore).
 *
 * Creates a Bedrock AgentCore Runtime with IAM roles for model invocation,
 * SSM parameter access, and CloudWatch logging. The agent uses the Strands
 * Agents SDK for tool-use orchestration and is invoked from the petsite-net
 * frontend's "Waggle" chat interface.
 */
export class PetFoodAgentConstruct extends Construct {
    public readonly agentRuntime: CfnRuntime;
    public agentRuntimeVariantB!: CfnRuntime;

    constructor(scope: Construct, id: string, properties: PetFoodAgentProperties) {
        super(scope, id);

        // Create IAM role for Agent Runtime
        const agentRuntimeRole = new Role(this, 'AgentRuntimeRole', {
            assumedBy: new PrincipalWithConditions(new ServicePrincipal('bedrock-agentcore.amazonaws.com'), {
                StringEquals: {
                    'aws:SourceAccount': Stack.of(this).account,
                },
                ArnLike: {
                    'aws:SourceArn': `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:*`,
                },
            }),
        });

        const petFoodAgentPolicy = new Policy(this, 'PetFoodAgentPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
                    resources: [
                        `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${PARAMETER_STORE_PREFIX}/*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                    resources: [
                        `arn:aws:bedrock:*::foundation-model/*`,
                        `arn:aws:bedrock:*:${Stack.of(this).account}:*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:CreateLogGroup', 'logs:DescribeLogStreams'],
                    resources: [
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:DescribeLogGroups'],
                    resources: [`arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:*`],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans:*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
                    resources: [`arn:aws:ecr:${Stack.of(this).region}:${Stack.of(this).account}:repository/*`],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ecr:GetAuthorizationToken'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'xray:PutTraceSegments',
                        'xray:PutTelemetryRecords',
                        'xray:GetSamplingRules',
                        'xray:GetSamplingTargets',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['cloudwatch:PutMetricData'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'cloudwatch:namespace': 'bedrock-agentcore',
                        },
                    },
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetWorkloadAccessToken',
                        'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
                        'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
                    ],
                    resources: [
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:workload-identity-directory/default`,
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:workload-identity-directory/default/workload-identity/agentName-*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetConfigurationBundle',
                        'bedrock-agentcore:GetConfigurationBundleVersion',
                    ],
                    resources: [
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:configuration-bundle/*`,
                    ],
                }),
            ],
            roles: [agentRuntimeRole],
        });

        this.agentRuntime = new CfnRuntime(this, 'PetFoodAgent', {
            agentRuntimeArtifact: {
                containerConfiguration: {
                    containerUri: `${properties.ecrRepositoryUri}:latest`,
                },
            },
            agentRuntimeName: 'PetFoodAgent',
            networkConfiguration: {
                networkMode: 'VPC',
            },
            roleArn: agentRuntimeRole.roleArn,
            description: 'Petfood Agent based on AgentCore',
            environmentVariables: {
                OTEL_PYTHON_EXCLUDED_URLS: '/ping',
                PARAMETER_STORE_PREFIX: PARAMETER_STORE_PREFIX,
                AWS_REGION: Stack.of(this).region,
                SEARCH_API_URL_PARAMETER_NAME: SSM_PARAMETER_NAMES.SEARCH_API_URL,
                PETFOOD_API_URL_PARAMETER_NAME: SSM_PARAMETER_NAMES.FOOD_API_URL,
                STRANDS_OTEL_ENABLE_TRACING: 'true',
                OTEL_TRACES_SAMPLER: 'always_on',
            },
            protocolConfiguration: 'HTTP',
        });

        this.agentRuntime.addOverride('Properties.NetworkConfiguration.NetworkModeConfig', {
            SecurityGroups: properties.securityGroups.map((sg) => sg.securityGroupId),
            Subnets: properties.vpc.privateSubnets.map((subnet) => subnet.subnetId),
        });

        this.createVariantB(properties);
        this.createOnlineEvaluations();
        this.createOutputs(PARAMETER_STORE_PREFIX);
        // Apply NAG suppressions

        NagSuppressions.addResourceSuppressions(
            [agentRuntimeRole, petFoodAgentPolicy],
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the Agent Runtime role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the Agent Runtime role',
                },
            ],
            true,
        );

        // Tag the construct
        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': 'petfoodagent-strands-py',
            'app:computeType': 'bedrock-agentcore',
            'app:hostType': 'managed',
        });
    }

    private createVariantB(properties: PetFoodAgentProperties): void {
        const variantBRole = new Role(this, 'VariantBRole', {
            assumedBy: new PrincipalWithConditions(new ServicePrincipal('bedrock-agentcore.amazonaws.com'), {
                StringEquals: {
                    'aws:SourceAccount': Stack.of(this).account,
                },
                ArnLike: {
                    'aws:SourceArn': `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:*`,
                },
            }),
        });

        const variantBPolicy = new Policy(this, 'VariantBPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
                    resources: [
                        `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${PARAMETER_STORE_PREFIX}/*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                    resources: [
                        `arn:aws:bedrock:*::foundation-model/*`,
                        `arn:aws:bedrock:*:${Stack.of(this).account}:*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:CreateLogGroup', 'logs:DescribeLogGroups', 'logs:DescribeLogStreams'],
                    resources: [
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans:*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:GetAuthorizationToken'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['cloudwatch:PutMetricData'],
                    resources: ['*'],
                    conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetWorkloadAccessToken',
                        'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
                        'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
                    ],
                    resources: [
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:workload-identity-directory/default`,
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:workload-identity-directory/default/workload-identity/agentName-*`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetConfigurationBundle',
                        'bedrock-agentcore:GetConfigurationBundleVersion',
                    ],
                    resources: [
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:configuration-bundle/*`,
                    ],
                }),
            ],
            roles: [variantBRole],
        });

        this.agentRuntimeVariantB = new CfnRuntime(this, 'PetFoodAgentVariantB', {
            agentRuntimeArtifact: {
                containerConfiguration: {
                    containerUri: `${properties.ecrRepositoryUri}:latest`,
                },
            },
            agentRuntimeName: 'PetFoodAgentVariantB',
            networkConfiguration: {
                networkMode: 'VPC',
            },
            roleArn: variantBRole.roleArn,
            description: 'Petfood Agent Variant B (Haiku) for A/B testing',
            environmentVariables: {
                OTEL_PYTHON_EXCLUDED_URLS: '/ping',
                PARAMETER_STORE_PREFIX: PARAMETER_STORE_PREFIX,
                AWS_REGION: Stack.of(this).region,
                SEARCH_API_URL_PARAMETER_NAME: SSM_PARAMETER_NAMES.SEARCH_API_URL,
                PETFOOD_API_URL_PARAMETER_NAME: SSM_PARAMETER_NAMES.FOOD_API_URL,
                MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
                STRANDS_OTEL_ENABLE_TRACING: 'true',
                OTEL_TRACES_SAMPLER: 'always_on',
            },
            protocolConfiguration: 'HTTP',
        });

        this.agentRuntimeVariantB.addOverride('Properties.NetworkConfiguration.NetworkModeConfig', {
            SecurityGroups: properties.securityGroups.map((sg) => sg.securityGroupId),
            Subnets: properties.vpc.privateSubnets.map((subnet) => subnet.subnetId),
        });

        NagSuppressions.addResourceSuppressions(
            [variantBRole, variantBPolicy],
            [
                { id: 'AwsSolutions-IAM4', reason: 'Managed Policies are acceptable for the Agent Runtime role' },
                { id: 'AwsSolutions-IAM5', reason: 'Permissions are acceptable for the Agent Runtime role' },
            ],
            true,
        );
    }

    private createOnlineEvaluations(): void {
        const evaluationRole = new Role(this, 'EvaluationExecutionRole', {
            assumedBy: new PrincipalWithConditions(new ServicePrincipal('bedrock-agentcore.amazonaws.com'), {
                StringEquals: {
                    'aws:SourceAccount': Stack.of(this).account,
                    'aws:ResourceAccount': Stack.of(this).account,
                },
                ArnLike: {
                    'aws:SourceArn': [
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:evaluator/*`,
                        `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:online-evaluation-config/*`,
                    ],
                },
            }),
        });

        evaluationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['logs:DescribeLogGroups', 'logs:GetQueryResults', 'logs:StartQuery', 'logs:GetLogEvents', 'logs:FilterLogEvents'],
                resources: ['*'],
            }),
        );
        evaluationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: [
                    `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/evaluations/*`,
                ],
            }),
        );
        evaluationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['logs:DescribeIndexPolicies', 'logs:PutIndexPolicy'],
                resources: [
                    `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans`,
                    `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans:*`,
                ],
            }),
        );
        evaluationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                resources: [
                    `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/*`,
                    `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:inference-profile/*`,
                ],
            }),
        );
        evaluationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['lambda:GetFunction', 'lambda:InvokeFunction'],
                resources: [
                    `arn:aws:lambda:${Stack.of(this).region}:${Stack.of(this).account}:function:petfood-tool-evaluator`,
                ],
            }),
        );

        NagSuppressions.addResourceSuppressions(
            evaluationRole,
            [
                { id: 'AwsSolutions-IAM4', reason: 'Evaluation role needs broad log access' },
                { id: 'AwsSolutions-IAM5', reason: 'Evaluation role needs wildcard for log groups discovery' },
            ],
            true,
        );

        // Ensure aws/spans log group has the index policy needed for evaluation session discovery
        new AwsCustomResource(this, 'SpansIndexPolicy', {
            onCreate: {
                service: 'CloudWatchLogs',
                action: 'putIndexPolicy',
                parameters: {
                    logGroupIdentifier: 'aws/spans',
                    policyDocument: JSON.stringify({
                        Fields: ['resource.attributes.service.name', 'attributes.session.id'],
                    }),
                },
                physicalResourceId: PhysicalResourceId.of('aws-spans-index-policy'),
            },
            onUpdate: {
                service: 'CloudWatchLogs',
                action: 'putIndexPolicy',
                parameters: {
                    logGroupIdentifier: 'aws/spans',
                    policyDocument: JSON.stringify({
                        Fields: ['resource.attributes.service.name', 'attributes.session.id'],
                    }),
                },
                physicalResourceId: PhysicalResourceId.of('aws-spans-index-policy'),
            },
            policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                    actions: ['logs:PutIndexPolicy', 'logs:DescribeIndexPolicies'],
                    resources: [
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans`,
                        `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:aws/spans:*`,
                    ],
                }),
            ]),
        });

        // Store evaluation role ARN as output for console-based setup
        new CfnOutput(this, 'EvaluationRoleArn', {
            value: evaluationRole.roleArn,
            description: 'IAM role ARN for AgentCore Online Evaluations (use in console to create eval configs)',
        });
    }

    private createOutputs(parameterStorePrefix: string): void {
        // Create SSM parameters for the agent runtime information
        Utilities.createSsmParameters(
            this,
            parameterStorePrefix,
            new Map(
                Object.entries({
                    [SSM_PARAMETER_NAMES.PETFOOD_AGENT_RUNTIME_ARN_NAME]: this.agentRuntime.attrAgentRuntimeArn,
                    [SSM_PARAMETER_NAMES.PETFOOD_AGENT_VARIANT_B_RUNTIME_ARN_NAME]: this.agentRuntimeVariantB.attrAgentRuntimeArn,
                }),
            ),
        );

        new CfnOutput(this, 'AgentRuntimeArn', {
            value: this.agentRuntime.attrAgentRuntimeArn,
            description: 'ARN of the Bedrock Agent Runtime for pet food recommendations (Variant A - Sonnet)',
        });

        new CfnOutput(this, 'AgentRuntimeVariantBArn', {
            value: this.agentRuntimeVariantB.attrAgentRuntimeArn,
            description: 'ARN of the Bedrock Agent Runtime for pet food recommendations (Variant B - Haiku)',
        });
    }
}
