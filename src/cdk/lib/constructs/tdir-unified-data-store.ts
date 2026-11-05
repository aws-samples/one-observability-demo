/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudWatch Unified Data Store construct for the One Observability Workshop.
 *
 * This module provisions telemetry rules using the AWS ObservabilityAdmin
 * CfnTelemetryRule resource to enable centralized log ingestion into
 * CloudWatch's Unified Data Store from multiple AWS service sources.
 *
 * For services not yet supported by TelemetryRule (GuardDuty, CloudFront),
 * this construct creates the necessary CloudWatch Logs log groups that
 * CloudWatch automatically categorizes as data sources.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnTelemetryRule } from 'aws-cdk-lib/aws-observabilityadmin';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Names, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup } from 'aws-cdk-lib/aws-events-targets';
import { NagSuppressions } from 'cdk-nag';

/**
 * Configuration properties for the TdirUnifiedDataStore construct.
 */
export interface TdirUnifiedDataStoreProperties {
    /** Enable WAF log ingestion via telemetry rule */
    ingestWafLogs?: boolean;
    /** Enable CloudTrail log ingestion via telemetry rule */
    ingestCloudTrailLogs?: boolean;
    /** Enable GuardDuty findings ingestion via EventBridge to CloudWatch Logs */
    ingestGuardDutyFindings?: boolean;
    /** Enable Bedrock AgentCore log ingestion via telemetry rule */
    ingestBedrockAgentCoreLogs?: boolean;
    /** Enable EKS log ingestion via telemetry rule */
    ingestEksLogs?: boolean;
    /** Enable CloudFront distribution log ingestion */
    ingestCloudFrontLogs?: boolean;
    /** Log retention period */
    logRetentionDays?: RetentionDays;
}

/**
 * A CDK construct that enables CloudWatch Unified Data Store ingestion
 * from multiple AWS service log sources.
 *
 * Uses two mechanisms:
 * 1. CfnTelemetryRule for services with native support (WAF, CloudTrail, EKS, Bedrock AgentCore)
 * 2. EventBridge rules routing to CloudWatch Logs for services without telemetry rule support (GuardDuty)
 * 3. CloudWatch Logs log groups for CloudFront (configured via CUSTOM_ENABLE_CLOUDFRONT_LOGS)
 */
export class TdirUnifiedDataStore extends Construct {
    /** Log group for GuardDuty findings (if enabled) */
    public readonly guardDutyLogGroup?: LogGroup;

    /**
     * Creates a new TdirUnifiedDataStore construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties specifying which log sources to enable
     */
    constructor(scope: Construct, id: string, properties: TdirUnifiedDataStoreProperties) {
        super(scope, id);

        const stack = Stack.of(this);
        const stackName = stack.stackName;
        const retention = properties.logRetentionDays || RetentionDays.ONE_WEEK;

        // --- Services with native TelemetryRule support ---

        if (properties.ingestWafLogs) {
            new CfnTelemetryRule(this, 'WafLogRule', {
                ruleName: `${stackName}-waf-logs`,
                rule: {
                    resourceType: 'AWS::WAFv2::WebACL',
                    telemetryType: 'Logs',
                },
            });
        }

        if (properties.ingestCloudTrailLogs) {
            new CfnTelemetryRule(this, 'CloudTrailLogRule', {
                ruleName: `${stackName}-cloudtrail-logs`,
                rule: {
                    resourceType: 'AWS::CloudTrail',
                    telemetryType: 'Logs',
                    // Required for AWS::CloudTrail: ObservabilityAdmin rejects the rule with
                    // "CloudTrail parameters cannot be null" if no event selectors are given.
                    // Management events are the API-activity trail the TDIR scenarios read;
                    // data events for the workshop's own resources come from WorkshopCloudTrail.
                    destinationConfiguration: {
                        cloudtrailParameters: {
                            advancedEventSelectors: [
                                {
                                    name: 'Management events',
                                    fieldSelectors: [{ field: 'eventCategory', equalTo: ['Management'] }],
                                },
                            ],
                        },
                    },
                },
            });
        }

        if (properties.ingestBedrockAgentCoreLogs) {
            new CfnTelemetryRule(this, 'BedrockAgentCoreRuntimeRule', {
                ruleName: `${stackName}-bedrock-agentcore-runtime`,
                rule: {
                    resourceType: 'AWS::BedrockAgentCore::Runtime',
                    telemetryType: 'Logs',
                },
            });

            new CfnTelemetryRule(this, 'BedrockAgentCoreBrowserRule', {
                ruleName: `${stackName}-bedrock-agentcore-browser`,
                rule: {
                    resourceType: 'AWS::BedrockAgentCore::Browser',
                    telemetryType: 'Logs',
                },
            });

            new CfnTelemetryRule(this, 'BedrockAgentCoreCodeInterpreterRule', {
                ruleName: `${stackName}-bedrock-agentcore-code-interpreter`,
                rule: {
                    resourceType: 'AWS::BedrockAgentCore::CodeInterpreter',
                    telemetryType: 'Logs',
                },
            });
        }

        if (properties.ingestEksLogs) {
            new CfnTelemetryRule(this, 'EksLogRule', {
                ruleName: `${stackName}-eks-logs`,
                rule: {
                    resourceType: 'AWS::EKS::Cluster',
                    telemetryType: 'Logs',
                    // Required for AWS::EKS::Cluster: ObservabilityAdmin rejects the rule
                    // without explicit source types. Audit and authenticator logs are the
                    // two the TDIR investigation scenarios actually read.
                    telemetrySourceTypes: ['EKS_AUDIT_LOGS', 'EKS_AUTHENTICATOR_LOGS'],
                },
            });
        }

        // --- Services requiring EventBridge integration ---

        if (properties.ingestGuardDutyFindings) {
            // GuardDuty publishes findings to EventBridge automatically.
            // Route them to a CloudWatch Logs log group for Unified Data Store ingestion.
            // The name is explicit so operators and the Unified Data Store can find it, but
            // carries a uniqueId suffix so two stacks in one account do not collide.
            this.guardDutyLogGroup = new LogGroup(this, 'GuardDutyFindingsLogGroup', {
                logGroupName: '/aws/events/guardduty-findings-' + Names.uniqueId(this),
                retention: retention,
                removalPolicy: RemovalPolicy.DESTROY,
            });
            // Names.uniqueId resolves at synthesis, so CWL3 still sees a literal string.
            // Suppressed the same way waf.ts does for its aws-waf-logs- prefixed groups.
            NagSuppressions.addResourceSuppressions(this.guardDutyLogGroup, [
                {
                    id: 'Workshop-CWL3',
                    reason: 'Name is discoverable by design and suffixed with uniqueId to avoid collisions',
                },
            ]);

            const guardDutyRule = new Rule(this, 'GuardDutyToCloudWatch', {
                description: 'Route GuardDuty findings to CloudWatch Logs for Unified Data Store',
                eventPattern: {
                    source: ['aws.guardduty'],
                    detailType: ['GuardDuty Finding'],
                } as EventPattern,
                targets: [new CloudWatchLogGroup(this.guardDutyLogGroup)],
            });

            // Targeting a log group makes CDK synthesize an `EventsLogGroupPolicy<uniqueId>`
            // custom resource at stack scope, whose policy is on `*` and is not configurable.
            // It is a sibling of this construct, so it has to be suppressed by path.
            NagSuppressions.addResourceSuppressionsByPath(
                stack,
                `/${stack.stackName}/EventsLogGroupPolicy${Names.uniqueId(guardDutyRule)}`,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'CDK-generated EventBridge to CloudWatch Logs resource policy; scope is not configurable',
                    },
                ],
                true,
            );

            // That custom resource is backed by CDK's shared AwsCustomResource provider, a
            // stack-level singleton we neither create nor configure. Looked up rather than
            // referenced by path so this is a no-op if CDK ever renames or drops it.
            const customResourceProvider = stack.node.tryFindChild('AWS679f53fac002430cb0da5b7982bd2287');
            if (customResourceProvider) {
                NagSuppressions.addResourceSuppressions(
                    customResourceProvider,
                    [
                        {
                            id: 'AwsSolutions-IAM4',
                            reason: 'CDK-managed AwsCustomResource provider; its execution role is not configurable',
                        },
                        {
                            id: 'Workshop-Lambda1',
                            reason: 'CDK-managed AwsCustomResource provider; log group is created by CDK',
                        },
                        {
                            id: 'Workshop-CWL2',
                            reason: 'CDK-managed AwsCustomResource provider log group; retention is not configurable here',
                        },
                    ],
                    true,
                );
            }
        }

        // --- CloudFront logs ---
        // CloudFront standard/real-time logs can be delivered to CloudWatch Logs.
        // When CUSTOM_ENABLE_CLOUDFRONT_LOGS is true, the existing CloudFront log group
        // in the GlobalStack (us-east-1) handles this. CloudWatch automatically
        // categorizes these as the amazon_cloudfront data source.
        // No additional resources needed here if CUSTOM_ENABLE_CLOUDFRONT_LOGS is already set.
        if (properties.ingestCloudFrontLogs) {
            // Create a regional log group for CloudFront real-time logs delivery.
            // Note: CloudFront standard logs require a log group in us-east-1 which
            // is handled by the existing CUSTOM_ENABLE_CLOUDFRONT_LOGS flag in core.ts.
            // This log group is for real-time log configuration if needed in the deployment region.
            const cloudFrontLogGroup = new LogGroup(this, 'CloudFrontRealTimeLogGroup', {
                logGroupName: '/aws/cloudfront/realtime-logs-' + Names.uniqueId(this),
                retention: retention,
                removalPolicy: RemovalPolicy.DESTROY,
            });
            NagSuppressions.addResourceSuppressions(cloudFrontLogGroup, [
                {
                    id: 'Workshop-CWL3',
                    reason: 'Name must be predictable for CloudFront real-time log delivery configuration',
                },
            ]);
        }
    }
}
