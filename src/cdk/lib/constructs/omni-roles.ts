/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudWatch Omni IAM roles for the One Observability Workshop.
 *
 * Omni's console setup normally creates these roles on the participant's behalf, which needs
 * `iam:CreateRole` and `iam:AttachRolePolicy`. Both were removed from the participant policy during
 * PassRole hardening, so setup failed with an AccessDenied before a space was ever created.
 *
 * This construct pre-provisions them instead, which is Option B in the workshop's
 * SECURITY_PASSROLE_HARDENING.md. Participants still create the domain and space themselves in the
 * console and select these roles in the setup wizard, so the module keeps its original shape and the
 * participant policy only needs `iam:PassRole` on these ARNs.
 *
 * Role names are load bearing. The participant policy grants PassRole by name, with a prefix
 * wildcard under `service-role/` for the first two and an exact match at the root path for the
 * evaluation role, so renaming any of them breaks setup.
 *
 * @packageDocumentation
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnRole, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Replace a role's trust policy with an exact document.
 *
 * CDK always emits its own `sts:AssumeRole` statement from `assumedBy`, which would split the space
 * access role's four actions across two statements. Overriding keeps these byte-identical to the
 * roles Omni's console setup creates, so they can be diffed against a console-built account.
 */
function setTrustPolicy(role: Role, statement: Record<string, unknown>): void {
    (role.node.defaultChild as CfnRole).assumeRolePolicyDocument = {
        Version: '2012-10-17',
        Statement: [statement],
    };
}

/** Must stay in sync with the PassRole grants in the workshop participant policy. */
const SPACE_ACCESS_ROLE_NAME = 'CloudWatchOmniSpaceAccessRole-workshop';
const DATASET_INTEGRATION_ROLE_NAME = 'CloudWatchOmniDatasetIntegrationExecutionRole-workshop';
const ONLINE_EVALUATION_ROLE_NAME = 'WaggleOnlineEvaluationRole';

/** Attached to the space access role. The first is mandatory, the other two are chosen during setup. */
const SPACE_ACCESS_MANAGED_POLICIES = [
    'CloudWatchOmniSpaceAccessPolicy',
    'CloudWatchOmniAWSIntegrationPolicy',
    'CloudWatchOmniModelInferencePolicy',
];

/**
 * Configuration properties for the OmniRoles construct.
 */
export interface OmniRolesProperties {
    /**
     * Create the AgentCore online evaluation role. Required by the agent-observability modules that
     * enable an online evaluation. Defaults to true.
     */
    readonly createOnlineEvaluationRole?: boolean;
}

/**
 * A CDK construct that pre-provisions the IAM roles CloudWatch Omni setup would otherwise create.
 *
 * Creates nothing but roles: the domain and space are created by the participant in the console.
 */
export class OmniRoles extends Construct {
    /** Passed as the space's DataAccessRoleArn. Assumed by Omni to query telemetry. */
    public readonly spaceAccessRole: Role;

    /** Passed as the dataset integration's RoleArn. Assumed by CloudWatch Logs to forward telemetry. */
    public readonly datasetIntegrationRole: Role;

    /** Passed as the space's AgentCoreEvaluationRoleArn, when enabled. */
    public readonly onlineEvaluationRole?: Role;

    constructor(scope: Construct, id: string, properties: OmniRolesProperties = {}) {
        super(scope, id);

        const stack = Stack.of(this);
        const account = stack.account;

        // Trust policies below follow the Omni cross-service confused deputy prevention guidance.
        this.spaceAccessRole = new Role(this, 'SpaceAccessRole', {
            roleName: SPACE_ACCESS_ROLE_NAME,
            path: '/service-role/',
            description: 'Assumed by CloudWatch Omni to manage the space, query telemetry, and configure integrations',
            assumedBy: new ServicePrincipal('cloudwatch.amazonaws.com', {
                conditions: { StringEquals: { 'aws:SourceAccount': account } },
            }),
            managedPolicies: SPACE_ACCESS_MANAGED_POLICIES.map((name) => ManagedPolicy.fromAwsManagedPolicyName(name)),
        });

        setTrustPolicy(this.spaceAccessRole, {
            Effect: 'Allow',
            Principal: { Service: 'cloudwatch.amazonaws.com' },
            Action: ['sts:AssumeRole', 'sts:TagSession', 'sts:SetSourceIdentity', 'sts:SetContext'],
            Condition: { StringEquals: { 'aws:SourceAccount': account } },
        });

        // The calling service here is CloudWatch Logs rather than Omni, so the trust also pins
        // aws:SourceArn to a dataset integration in this account.
        this.datasetIntegrationRole = new Role(this, 'DatasetIntegrationRole', {
            roleName: DATASET_INTEGRATION_ROLE_NAME,
            path: '/service-role/',
            description: 'Assumed by CloudWatch Logs to forward telemetry into the CloudWatch dataset for Omni',
            assumedBy: new ServicePrincipal('logs.amazonaws.com', {
                conditions: {
                    StringEquals: { 'aws:SourceAccount': account },
                    ArnLike: { 'aws:SourceArn': `arn:aws:observabilityadmin:*:${account}:dataset-integration/*` },
                },
            }),
            inlinePolicies: {
                OmniDatasetIntegrationPolicy: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            sid: 'IntegrateLogGroupsWithDataset',
                            actions: ['logs:IntegrateWithDataset'],
                            resources: [`arn:aws:logs:*:${account}:log-group:*`],
                        }),
                        new PolicyStatement({
                            sid: 'PutRecordsToDataset',
                            actions: ['cloudwatch:PutRecords'],
                            resources: [`arn:aws:cloudwatch:*:${account}:dataset/*`],
                        }),
                    ],
                }),
            },
        });

        setTrustPolicy(this.datasetIntegrationRole, {
            Sid: 'CloudWatchLogsAssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'logs.amazonaws.com' },
            Action: 'sts:AssumeRole',
            Condition: {
                StringEquals: { 'aws:SourceAccount': account },
                ArnLike: { 'aws:SourceArn': `arn:aws:observabilityadmin:*:${account}:dataset-integration/*` },
            },
        });

        if (properties.createOnlineEvaluationRole !== false) {
            this.onlineEvaluationRole = new Role(this, 'OnlineEvaluationRole', {
                roleName: ONLINE_EVALUATION_ROLE_NAME,
                description: 'Assumed by Amazon Bedrock AgentCore to run Waggle online evaluations',
                assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com', {
                    conditions: {
                        StringEquals: {
                            'aws:SourceAccount': account,
                            'aws:ResourceAccount': account,
                        },
                        ArnLike: {
                            'aws:SourceArn': [
                                `arn:aws:bedrock-agentcore:*:${account}:evaluator/*`,
                                `arn:aws:bedrock-agentcore:*:${account}:online-evaluation-config/*`,
                            ],
                        },
                    },
                }),
                inlinePolicies: {
                    OnlineEvaluation: new PolicyDocument({
                        statements: [
                            new PolicyStatement({
                                sid: 'CloudWatchLogReadStatement',
                                actions: ['logs:DescribeLogGroups', 'logs:GetQueryResults', 'logs:StartQuery'],
                                resources: ['*'],
                            }),
                            new PolicyStatement({
                                sid: 'CloudWatchLogWriteStatement',
                                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                                resources: [`arn:aws:logs:*:${account}:log-group:/aws/bedrock-agentcore/evaluations/*`],
                            }),
                            // Sampling filters spans by service name through a field index on aws/spans.
                            new PolicyStatement({
                                sid: 'CloudWatchIndexPolicyStatement',
                                actions: ['logs:DescribeIndexPolicies', 'logs:PutIndexPolicy'],
                                resources: [
                                    `arn:aws:logs:*:${account}:log-group:aws/spans`,
                                    `arn:aws:logs:*:${account}:log-group:aws/spans:*`,
                                ],
                            }),
                            new PolicyStatement({
                                sid: 'BedrockInvokeStatement',
                                actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                                resources: [
                                    'arn:aws:bedrock:*::foundation-model/*',
                                    `arn:aws:bedrock:*:${account}:inference-profile/*`,
                                ],
                            }),
                        ],
                    }),
                },
            });

            setTrustPolicy(this.onlineEvaluationRole, {
                Sid: 'TrustPolicyStatement',
                Effect: 'Allow',
                Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
                Action: 'sts:AssumeRole',
                Condition: {
                    StringEquals: {
                        'aws:SourceAccount': account,
                        'aws:ResourceAccount': account,
                    },
                    ArnLike: {
                        'aws:SourceArn': [
                            `arn:aws:bedrock-agentcore:*:${account}:evaluator/*`,
                            `arn:aws:bedrock-agentcore:*:${account}:online-evaluation-config/*`,
                        ],
                    },
                },
            });
        }

        // A space keeps the DataAccessRoleArn it was created with, so removing a role out from under
        // a live space breaks it. Retained on stack delete; workshop account teardown cleans up.
        for (const role of [this.spaceAccessRole, this.datasetIntegrationRole, this.onlineEvaluationRole]) {
            role?.applyRemovalPolicy(RemovalPolicy.RETAIN);
        }

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'CloudWatch Omni requires its AWS managed policies on the space access role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Resources do not exist until the participant creates the space, and the AWS managed Omni policies carry their own wildcards',
                },
            ],
            true,
        );
    }
}
