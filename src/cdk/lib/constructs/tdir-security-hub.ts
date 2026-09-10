/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * AWS Security Hub construct for the One Observability Workshop.
 *
 * This module provisions Security Hub with auto-enabled controls and
 * integrations with GuardDuty and Detective for centralized security
 * finding management and investigation.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnHub } from 'aws-cdk-lib/aws-securityhub';

/**
 * Configuration properties for the TdirSecurityHub construct.
 */
export interface TdirSecurityHubProperties {
    /** Enable auto-enable controls for new resources */
    autoEnableControls?: boolean;
    /** Enable the default standards (AWS Foundational Security Best Practices) */
    enableDefaultStandards?: boolean;
}

/**
 * A CDK construct that enables AWS Security Hub for centralized
 * security finding aggregation in the observability workshop.
 *
 * Security Hub automatically receives findings from:
 * - Amazon GuardDuty (threat detection)
 * - AWS Config (compliance)
 * - Amazon Inspector (vulnerability)
 *
 * These findings are correlated with Detective investigations and
 * can trigger automated remediation via EventBridge.
 */
export class TdirSecurityHub extends Construct {
    /** The Security Hub instance */
    public readonly hub: CfnHub;

    /**
     * Creates a new TdirSecurityHub construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for Security Hub
     */
    constructor(scope: Construct, id: string, properties?: TdirSecurityHubProperties) {
        super(scope, id);

        this.hub = new CfnHub(this, 'Hub', {
            autoEnableControls: properties?.autoEnableControls !== false,
            enableDefaultStandards: properties?.enableDefaultStandards !== false,
        });
    }
}
