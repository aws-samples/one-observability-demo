/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Amazon GuardDuty construct for the One Observability Workshop.
 *
 * This module provisions a GuardDuty detector with runtime monitoring,
 * EKS protection, S3 protection, and Lambda protection enabled.
 * GuardDuty findings feed into Detective and Security Hub for
 * investigation and automated response.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnDetector } from 'aws-cdk-lib/aws-guardduty';

/**
 * Configuration properties for the TdirGuardDuty construct.
 */
export interface TdirGuardDutyProperties {
    /** Enable EKS audit log monitoring */
    enableEksProtection?: boolean;
    /** Enable S3 data event monitoring */
    enableS3Protection?: boolean;
    /** Enable Lambda network activity monitoring */
    enableLambdaProtection?: boolean;
    /** Enable runtime monitoring for EKS, ECS, and EC2 */
    enableRuntimeMonitoring?: boolean;
    /** Finding publishing frequency: FIFTEEN_MINUTES, ONE_HOUR, or SIX_HOURS */
    findingPublishingFrequency?: string;
}

/**
 * A CDK construct that creates an Amazon GuardDuty detector with
 * comprehensive threat detection capabilities for the workshop.
 *
 * Enables:
 * - CloudTrail management and data event analysis
 * - VPC Flow Log analysis
 * - DNS query log analysis
 * - EKS audit log analysis
 * - S3 data event monitoring
 * - Lambda network activity monitoring
 * - Runtime monitoring (EKS, ECS, EC2)
 */
export class TdirGuardDuty extends Construct {
    /** The GuardDuty detector */
    public readonly detector: CfnDetector;

    /**
     * Creates a new TdirGuardDuty construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for GuardDuty
     */
    constructor(scope: Construct, id: string, properties?: TdirGuardDutyProperties) {
        super(scope, id);

        this.detector = new CfnDetector(this, 'Detector', {
            enable: true,
            findingPublishingFrequency: properties?.findingPublishingFrequency || 'FIFTEEN_MINUTES',
            dataSources: {
                s3Logs: {
                    enable: properties?.enableS3Protection !== false,
                },
                kubernetes: {
                    auditLogs: {
                        enable: properties?.enableEksProtection !== false,
                    },
                },
            },
            features: [
                {
                    name: 'LAMBDA_NETWORK_LOGS',
                    status: properties?.enableLambdaProtection === false ? 'DISABLED' : 'ENABLED',
                },
                // RUNTIME_MONITORING supersedes EKS_RUNTIME_MONITORING and covers EKS, ECS/Fargate
                // and EC2 through its own additionalConfiguration. GuardDuty rejects a request that
                // names both ("EKS_RUNTIME_MONITORING and RUNTIME_MONITORING cannot be provided in
                // the same request"), so EKS coverage is requested here rather than as its own
                // feature. EKS_ADDON_MANAGEMENT lets GuardDuty own the aws-guardduty-agent addon;
                // CUSTOM_ENABLE_GUARDDUTY_EKS_ADDON must stay false so the CDK addon in
                // lib/constructs/eks.ts does not race it.
                {
                    name: 'RUNTIME_MONITORING',
                    status: properties?.enableRuntimeMonitoring === false ? 'DISABLED' : 'ENABLED',
                    additionalConfiguration: [
                        {
                            name: 'EKS_ADDON_MANAGEMENT',
                            status: properties?.enableEksProtection === false ? 'DISABLED' : 'ENABLED',
                        },
                        {
                            name: 'ECS_FARGATE_AGENT_MANAGEMENT',
                            status: 'ENABLED',
                        },
                    ],
                },
            ],
        });
    }
}
