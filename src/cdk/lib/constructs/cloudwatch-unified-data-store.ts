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
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup } from 'aws-cdk-lib/aws-events-targets';

/**
 * Configuration properties for the CloudWatchUnifiedDataStore construct.
 */
export interface CloudWatchUnifiedDataStoreProperties {
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
export class CloudWatchUnifiedDataStore extends Construct {
    /** Log group for GuardDuty findings (if enabled) */
    public readonly guardDutyLogGroup?: LogGroup;

    /**
     * Creates a new CloudWatchUnifiedDataStore construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties specifying which log sources to enable
     */
    constructor(scope: Construct, id: string, properties: CloudWatchUnifiedDataStoreProperties) {
        super(scope, id);

        const stackName = Stack.of(this).stackName;
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
                },
            });
        }

        // --- Services requiring EventBridge integration ---

        if (properties.ingestGuardDutyFindings) {
            // GuardDuty publishes findings to EventBridge automatically.
            // Route them to a CloudWatch Logs log group for Unified Data Store ingestion.
            this.guardDutyLogGroup = new LogGroup(this, 'GuardDutyFindingsLogGroup', {
                logGroupName: `/aws/events/guardduty-findings`,
                retention: retention,
                removalPolicy: RemovalPolicy.DESTROY,
            });

            new Rule(this, 'GuardDutyToCloudWatch', {
                description: 'Route GuardDuty findings to CloudWatch Logs for Unified Data Store',
                eventPattern: {
                    source: ['aws.guardduty'],
                    detailType: ['GuardDuty Finding'],
                } as EventPattern,
                targets: [new CloudWatchLogGroup(this.guardDutyLogGroup)],
            });
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
            new LogGroup(this, 'CloudFrontRealTimeLogGroup', {
                logGroupName: `/aws/cloudfront/realtime-logs`,
                retention: retention,
                removalPolicy: RemovalPolicy.DESTROY,
            });
        }
    }
}
