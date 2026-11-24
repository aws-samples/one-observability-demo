/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pre-provisioned IAM roles for the console wizards used in the One Observability Workshop.
 *
 * The hardened participant policy no longer grants `iam:CreateRole`, `iam:CreatePolicy`,
 * `iam:PutRolePolicy` or `iam:AttachRolePolicy`, so every console flow that auto-creates a role
 * (Synthetics "Create canary", Lambda "Create function", RUM "Create a new identity pool",
 * Managed Grafana "Service managed" permissions, CloudWatch Investigations default permissions)
 * fails with AccessDenied. This construct creates those roles up front, which is Option B in the
 * workshop's SECURITY_PASSROLE_HARDENING.md. Participants select the existing role in each wizard
 * and the participant policy only needs `iam:PassRole` on these exact names.
 *
 * None of these roles is writable by the participant, so passing them to a runnable service does
 * not reopen the privilege-escalation path that the hardening closed. Each role carries only what
 * its workshop module needs.
 *
 * CloudWatch Omni roles are provisioned separately by {@link OmniRoles}.
 *
 * Role and policy names are load bearing: the participant policy grants PassRole and
 * AttachRolePolicy by name, so renaming any of them breaks the matching module.
 *
 * @packageDocumentation
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
    FederatedPrincipal,
    ManagedPolicy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { CfnIdentityPool, CfnIdentityPoolRoleAttachment } from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/** Must stay in sync with the grants in the workshop participant policy (static/iam/iam_policy.json). */
export const PARTICIPANT_ROLE_NAMES = {
    /** Synthetics canaries. Under /service-role/, passed to lambda + synthetics. */
    CANARY: 'CloudWatchSyntheticsRole-workshop',
    /** Custom-widget and EMF Lambda functions. Under /service-role/, passed to lambda. */
    LAMBDA: 'ObservabilityWorkshopLambdaRole',
    /** RUM unauthenticated identity pool role. Matches the existing RUM-Monitor-* grant. */
    RUM_UNAUTH: 'RUM-Monitor-workshop-Unauth',
    /** Managed Grafana workspace role. Passable via AWSGrafanaAccountAdministrator (any role -> grafana). */
    GRAFANA: 'AmazonGrafanaServiceRole-workshop',
    /** CloudWatch Investigations group role. Passed to aiops. */
    INVESTIGATIONS: 'AIOpsRole-workshop',
} as const;

/** Customer managed policy the Investigations lab attaches to the dynamo-capacity-test role. */
export const DYNAMODB_WORKSHOP_POLICY_NAME = 'DynamoDBWorkshopAccess';

/** Identity pool the RUM lab selects with "Use an existing identity pool". */
export const RUM_IDENTITY_POOL_NAME = 'ObservabilityWorkshopRUM';

/**
 * Configuration properties for the ParticipantRoles construct.
 */
export interface ParticipantRolesProperties {
    /**
     * Create the RUM identity pool and its unauthenticated role. Defaults to true.
     */
    readonly createRumIdentityPool?: boolean;
}

/**
 * A CDK construct that pre-provisions the IAM roles workshop console wizards would otherwise create.
 */
export class ParticipantRoles extends Construct {
    /** Execution role for participant-created Synthetics canaries. */
    public readonly canaryRole: Role;

    /** Execution role for participant-created custom-widget and EMF Lambda functions. */
    public readonly lambdaRole: Role;

    /** Service role for the participant-created Managed Grafana workspace. */
    public readonly grafanaRole: Role;

    /** Role for the participant-created CloudWatch Investigations group. */
    public readonly investigationsRole: Role;

    /** Fixed-content policy the Investigations lab attaches to fix the dynamo-capacity-test function. */
    public readonly dynamoDbWorkshopPolicy: ManagedPolicy;

    /** Identity pool for the RUM app monitor, when enabled. */
    public readonly rumIdentityPool?: CfnIdentityPool;

    /** Unauthenticated role of the RUM identity pool, when enabled. */
    public readonly rumUnauthRole?: Role;

    constructor(scope: Construct, id: string, properties: ParticipantRolesProperties = {}) {
        super(scope, id);

        const stack = Stack.of(this);
        const account = stack.account;
        const region = stack.region;

        // Synthetics canary execution role. Permissions mirror the CloudWatchSyntheticsPolicy-* that the
        // "Create canary" wizard generates, widened from one canary to any canary in this account.
        this.canaryRole = new Role(this, 'CanaryRole', {
            roleName: PARTICIPANT_ROLE_NAMES.CANARY,
            path: '/service-role/',
            description: 'Execution role for Synthetics canaries created by workshop participants',
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies: {
                CloudWatchSyntheticsPolicy: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            sid: 'CanaryArtifacts',
                            actions: ['s3:PutObject', 's3:GetObject'],
                            resources: [`arn:aws:s3:::cw-syn-results-${account}-${region}/*`],
                        }),
                        new PolicyStatement({
                            sid: 'CanaryArtifactsBucket',
                            actions: ['s3:GetBucketLocation'],
                            resources: [`arn:aws:s3:::cw-syn-results-${account}-${region}`],
                        }),
                        new PolicyStatement({
                            sid: 'CanaryLogs',
                            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [`arn:aws:logs:${region}:${account}:log-group:/aws/lambda/cwsyn-*`],
                        }),
                        new PolicyStatement({
                            sid: 'CanaryListBucketsAndTrace',
                            actions: ['s3:ListAllMyBuckets', 'xray:PutTraceSegments'],
                            resources: ['*'],
                        }),
                        new PolicyStatement({
                            sid: 'CanaryMetrics',
                            actions: ['cloudwatch:PutMetricData'],
                            resources: ['*'],
                            conditions: { StringEquals: { 'cloudwatch:namespace': 'CloudWatchSynthetics' } },
                        }),
                    ],
                }),
            },
        });

        // One Lambda execution role shared by the custom-widget and EMF modules. Basic execution covers EMF
        // (metrics are extracted from the function's logs). The Logs Insights actions replace the
        // custom-widget "Update Permissions" step that used to edit the auto-created role's policy.
        this.lambdaRole = new Role(this, 'LambdaRole', {
            roleName: PARTICIPANT_ROLE_NAMES.LAMBDA,
            path: '/service-role/',
            description: 'Execution role for custom-widget and EMF Lambda functions created by workshop participants',
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
            inlinePolicies: {
                LogsInsightsQuery: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            sid: 'LogsInsightsQuery',
                            actions: [
                                'logs:StartQuery',
                                'logs:GetQueryResults',
                                'logs:StopQuery',
                                'logs:DescribeLogGroups',
                            ],
                            resources: ['*'],
                        }),
                    ],
                }),
            },
        });

        // Managed Grafana with "Customer managed" permissions. Covers the data sources the AMG modules use
        // (CloudWatch, Amazon Managed Service for Prometheus, X-Ray, OpenSearch) and SNS alert notifications.
        this.grafanaRole = new Role(this, 'GrafanaRole', {
            roleName: PARTICIPANT_ROLE_NAMES.GRAFANA,
            path: '/service-role/',
            description: 'Service role for the Amazon Managed Grafana workspace created by workshop participants',
            assumedBy: new ServicePrincipal('grafana.amazonaws.com', {
                conditions: {
                    StringEquals: { 'aws:SourceAccount': account },
                    StringLike: { 'aws:SourceArn': `arn:aws:grafana:${region}:${account}:/workspaces/*` },
                },
            }),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonGrafanaCloudWatchAccess'),
                ManagedPolicy.fromAwsManagedPolicyName('AmazonPrometheusQueryAccess'),
                ManagedPolicy.fromAwsManagedPolicyName('AWSXrayReadOnlyAccess'),
            ],
            inlinePolicies: {
                GrafanaOpenSearchAndSns: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            sid: 'OpenSearchRead',
                            actions: [
                                'es:ESHttpGet',
                                'es:ESHttpPost',
                                'es:DescribeElasticsearchDomains',
                                'es:ListDomainNames',
                            ],
                            resources: ['*'],
                        }),
                        new PolicyStatement({
                            sid: 'SnsAlertNotifications',
                            actions: ['sns:Publish'],
                            resources: [`arn:aws:sns:${region}:${account}:grafana*`],
                        }),
                    ],
                }),
            },
        });

        // CloudWatch Investigations group role, selected instead of the default auto-created role.
        this.investigationsRole = new Role(this, 'InvestigationsRole', {
            roleName: PARTICIPANT_ROLE_NAMES.INVESTIGATIONS,
            description: 'Role for the CloudWatch Investigations group created by workshop participants',
            assumedBy: new ServicePrincipal('aiops.amazonaws.com', {
                conditions: {
                    StringEquals: { 'aws:SourceAccount': account },
                    ArnLike: { 'aws:SourceArn': `arn:aws:aiops:${region}:${account}:investigation-group/*` },
                },
            }),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AIOpsAssistantPolicy')],
        });

        // The fix in the Investigations lab. Same document the lab used to paste as an inline policy; the
        // participant policy only allows attaching this exact ARN to the dynamo-capacity-test role.
        this.dynamoDbWorkshopPolicy = new ManagedPolicy(this, 'DynamoDbWorkshopPolicy', {
            managedPolicyName: DYNAMODB_WORKSHOP_POLICY_NAME,
            description: 'Fix for the CloudWatch Investigations lab, attached to the dynamo-capacity-test role',
            statements: [
                new PolicyStatement({
                    actions: ['dynamodb:ListTables', 'dynamodb:DescribeTable', 'dynamodb:ListTagsOfResource'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    actions: ['dynamodb:PutItem'],
                    resources: [
                        `arn:aws:dynamodb:${region}:${account}:table/Storage-StorageStack-DynamoDbddbPetadoption*`,
                    ],
                }),
            ],
        });

        if (properties.createRumIdentityPool !== false) {
            this.rumIdentityPool = new CfnIdentityPool(this, 'RumIdentityPool', {
                identityPoolName: RUM_IDENTITY_POOL_NAME,
                allowUnauthenticatedIdentities: true,
                allowClassicFlow: false,
            });

            // Same trust and permissions the RUM console sets on RUM-Monitor-*-Unauth, but scoped to any app
            // monitor in this account because the participant creates the app monitor after deployment.
            this.rumUnauthRole = new Role(this, 'RumUnauthRole', {
                roleName: PARTICIPANT_ROLE_NAMES.RUM_UNAUTH,
                description: 'Unauthenticated role of the workshop RUM identity pool',
                assumedBy: new FederatedPrincipal(
                    'cognito-identity.amazonaws.com',
                    {
                        StringEquals: { 'cognito-identity.amazonaws.com:aud': this.rumIdentityPool.ref },
                        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
                    },
                    'sts:AssumeRoleWithWebIdentity',
                ),
                inlinePolicies: {
                    RUMPutBatchMetrics: new PolicyDocument({
                        statements: [
                            new PolicyStatement({
                                actions: ['rum:PutRumEvents'],
                                resources: [`arn:aws:rum:${region}:${account}:appmonitor/*`],
                            }),
                        ],
                    }),
                },
            });

            new CfnIdentityPoolRoleAttachment(this, 'RumIdentityPoolRoles', {
                identityPoolId: this.rumIdentityPool.ref,
                roles: { unauthenticated: this.rumUnauthRole.roleArn },
            });
        }

        // Participants' canaries, functions, workspaces and investigation groups keep referencing these
        // roles, so they are retained on stack delete; workshop account teardown cleans up.
        for (const resource of [
            this.canaryRole,
            this.lambdaRole,
            this.grafanaRole,
            this.investigationsRole,
            this.dynamoDbWorkshopPolicy,
            this.rumUnauthRole,
        ]) {
            resource?.applyRemovalPolicy(RemovalPolicy.RETAIN);
        }

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS managed policies match what the console wizards attach for these services',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Resources (canaries, functions, workspaces, app monitors) do not exist until the participant creates them',
                },
                {
                    id: 'AwsSolutions-COG7',
                    reason: 'CloudWatch RUM requires unauthenticated identities to send browser telemetry',
                },
            ],
            true,
        );
    }
}
