/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Stack } from 'aws-cdk-lib';
import {
    PolicyStatement,
    PolicyDocument,
    Role,
    ServicePrincipal,
    ManagedPolicy,
    Effect,
    PrincipalWithConditions,
} from 'aws-cdk-lib/aws-iam';
import { CfnRuntime } from 'aws-cdk-lib/aws-bedrockagentcore';
// Note: BedrockAgentCore L2 constructs may not be available in all CDK versions
// Using L1 constructs (CfnResource) as fallback
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';

export interface PetFoodAgentProperties {
    readonly ecrRepositoryUri: string; // ECR repository URI from containers pipeline
    readonly securityGroups: ISecurityGroup[];
    readonly vpc: IVpc;
}

export class PetFoodAgentConstruct extends Construct {
    public readonly agentRuntime: CfnRuntime;

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
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')],
            inlinePolicies: {
                AgentRuntimePolicy: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
                            resources: [
                                `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${PARAMETER_STORE_PREFIX}/*`,
                            ],
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                            resources: ['*'],
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: ['*'],
                        }),
                    ],
                }),
            },
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
            },
            protocolConfiguration: 'HTTP',
        });

        this.agentRuntime.addOverride('Properties.NetworkConfiguration.NetworkModeConfig', {
            SecurityGroups: properties.securityGroups.map((sg) => sg.securityGroupId),
            Subnets: properties.vpc.privateSubnets.map((subnet) => subnet.subnetId),
        });

        this.createOutputs(PARAMETER_STORE_PREFIX);
        // Apply NAG suppressions

        NagSuppressions.addResourceSuppressions(
            agentRuntimeRole,
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

    private createOutputs(parameterStorePrefix: string): void {
        // Create SSM parameters for the agent runtime information
        Utilities.createSsmParameters(
            this,
            parameterStorePrefix,
            new Map(
                Object.entries({
                    [SSM_PARAMETER_NAMES.PETFOOD_AGENT_RUNTIME_ARN]: this.agentRuntime
                        .getAtt('AgentRuntimeArn')
                        .toString(),
                }),
            ),
        );

        new CfnOutput(this, 'AgentRuntimeArn', {
            value: this.agentRuntime.attrAgentRuntimeArn,
            description: 'Agent Runtime ARN',
        });
    }
}
