/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Core infrastructure stage and stack for the One Observability Workshop.
 *
 * This module defines the core infrastructure components including VPC setup,
 * networking configuration, and foundational resources needed for the workshop.
 *
 * @packageDocumentation
 */

import { Stack, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';
import { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { WorkshopNetwork } from '../constructs/network';

/**
 * Configuration properties for the CoreStage.
 */
export interface CoreStageProperties {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    /** Whether to create a new VPC (default: true) */
    createVpc?: boolean;
    /** CIDR range for the VPC if creating a new one */
    vpcCidr?: string;
    /** Existing VPC ID to use instead of creating new one */
    vpcId?: string;
}

/**
 * Core deployment stage containing the foundational infrastructure stack.
 *
 * This stage creates the core infrastructure needed for the One Observability
 * Workshop, including networking components and base resources.
 */
export class CoreStage extends Stage {
    /** The core infrastructure stack */
    public readonly coreStack: CoreStack;

    /**
     * Creates a new CoreStage.
     *
     * @param scope - The parent construct
     * @param id - The stage identifier
     * @param properties - Configuration properties for the stage
     */
    constructor(scope: Construct, id: string, properties: CoreStageProperties) {
        super(scope, id);

        this.coreStack = new CoreStack(this, `Stack`, properties);
        if (properties.tags) {
            Utilities.TagConstruct(this.coreStack, properties.tags);
        }
    }
}

/**
 * Core infrastructure stack containing VPC and networking resources.
 *
 * This stack sets up the foundational networking infrastructure for the workshop,
 * either by creating a new VPC or using an existing one.
 */
export class CoreStack extends Stack {
    /** The VPC instance used by the workshop */
    public readonly vpc: IVpc;
    /** Whether the VPC is externally managed (not created by this stack) */
    public readonly externalVpc: boolean;

    /**
     * Creates a new CoreStack.
     *
     * @param scope - The parent construct
     * @param id - The stack identifier
     * @param properties - Configuration properties for the stack
     * @throws Error when neither createVpc nor vpcId is properly specified
     */
    constructor(scope: Construct, id: string, properties: CoreStageProperties) {
        super(scope, id, properties);

        if (!properties.createVpc || properties.createVpc) {
            // Create a new VPC with workshop networking configuration
            this.externalVpc = false;
            const vpc = new WorkshopNetwork(this, 'vpc', {
                name: 'vpc',
                cidrRange: properties.vpcCidr || '10.0.0.0/16',
            });
            this.vpc = vpc.vpc;
        } else if (properties.vpcId) {
            // Use an existing VPC
            this.vpc = Vpc.fromLookup(this, 'vpc', {
                vpcId: properties.vpcId,
            });
            this.externalVpc = true;
        } else {
            throw new Error('Either createVpc or vpcId must be specified');
        }
    }
}
