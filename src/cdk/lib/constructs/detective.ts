/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Amazon Detective construct for the One Observability Workshop.
 *
 * This module provisions an Amazon Detective behavior graph for security
 * investigation and visualization of findings from GuardDuty, CloudTrail,
 * and VPC Flow Logs.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnGraph } from 'aws-cdk-lib/aws-detective';
import { Stack } from 'aws-cdk-lib';

/**
 * A CDK construct that creates an Amazon Detective behavior graph
 * for security investigation in the observability workshop.
 *
 * Detective automatically ingests data from:
 * - AWS CloudTrail logs
 * - Amazon VPC Flow Logs
 * - Amazon GuardDuty findings
 * - Amazon EKS audit logs (when EKS is enabled)
 *
 * These data sources are enabled by default when the graph is created.
 */
export class WorkshopDetective extends Construct {
    /** The Detective behavior graph */
    public readonly graph: CfnGraph;

    /**
     * Creates a new WorkshopDetective construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     */
    constructor(scope: Construct, id: string) {
        super(scope, id);

        // Only the Name tag is set here. The stage's tags are applied recursively by
        // Utilities.TagConstruct and propagated onto this L1 resource by CDK.
        this.graph = new CfnGraph(this, 'BehaviorGraph', {
            autoEnableMembers: false,
            tags: [{ key: 'Name', value: `${Stack.of(this).stackName}-detective-graph` }],
        });
    }
}
