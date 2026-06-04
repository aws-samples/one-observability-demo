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
 * Configuration properties for the WorkshopGuardDuty construct.
 */
export interface WorkshopGuardDutyProperties {
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
 * - EKS audit log and runtime monitoring
 * - S3 data event monitoring
 * - Lambda network activity monitoring
 * - Runtime monitoring (EKS, ECS, EC2)
 */
export class WorkshopGuardDuty extends Construct {
    /** The GuardDuty detector */
    public readonly detector: CfnDetector;

    /**
     * Creates a new WorkshopGuardDuty construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for GuardDuty
     */
    constructor(scope: Construct, id: string, properties?: WorkshopGuardDutyProperties) {
        super(scope, id);

        const props = properties || {};

        this.detector = new CfnDetector(this, 'Detector', {
            enable: true,
            findingPublishingFrequency: props.findingPublishingFrequency || 'FIFTEEN_MINUTES',
            dataSources: {
                s3Logs: {
                    enable: props.enableS3Protection !== false,
                },
                kubernetes: {
                    auditLogs: {
                        enable: props.enableEksProtection !== false,
                    },
                },
            },
            features: [
                {
                    name: 'EKS_RUNTIME_MONITORING',
                    status: props.enableEksProtection !== false ? 'ENABLED' : 'DISABLED',
                    additionalConfiguration: [
                        {
                            name: 'EKS_ADDON_MANAGEMENT',
                            status: 'ENABLED',
                        },
                    ],
                },
                {
                    name: 'LAMBDA_NETWORK_LOGS',
                    status: props.enableLambdaProtection !== false ? 'ENABLED' : 'DISABLED',
                },
                {
                    name: 'RUNTIME_MONITORING',
                    status: props.enableRuntimeMonitoring !== false ? 'ENABLED' : 'DISABLED',
                    additionalConfiguration: [
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
