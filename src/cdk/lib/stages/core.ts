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

import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';
import { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { WorkshopNetwork } from '../constructs/network';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { WorkshopCloudTrail } from '../constructs/cloudtrail';
import { QueueResources, QueueResourcesProperties } from '../constructs/queue';
import { EventBusResources, EventBusResourcesProperties } from '../constructs/eventbus';
import { CfnDiscovery } from 'aws-cdk-lib/aws-applicationsignals';
import { CloudWatchTransactionSearch, CloudWatchTransactionSearchProperties } from '../constructs/cloudwatch';

/**
 * Configuration properties for the CoreStage.
 */
export interface CoreStageProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    /** Whether to create a new VPC (default: true) */
    createVpc?: boolean;
    /** CIDR range for the VPC if creating a new one */
    vpcCidr?: string;
    /** Existing VPC ID to use instead of creating new one */
    vpcId?: string;
    /** Whether to create a CloudTrail trail (default: true) */
    createCloudTrail?: boolean;
    /** Default Retention Period for logs */
    defaultRetentionDays?: RetentionDays;
    /** Queue Resources */
    queueProperties?: QueueResourcesProperties;
    /** EventBus Resources */
    eventBusProperties?: EventBusResourcesProperties;
    /** CloudWatch Resources */
    cloudWatchProperties?: CloudWatchTransactionSearchProperties;
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

        /** Add Queue resources */
        new QueueResources(this, 'QueueResources', properties.queueProperties);

        /** Add EventBus resources */
        new EventBusResources(this, 'EventBusResources', properties.eventBusProperties);

        /** Enable CloudWatch Application Signals Discovery */
        new CfnDiscovery(this, 'ApplicationSignals', {});

        /** CloudWatch Transaction Search setup **/
        new CloudWatchTransactionSearch(this, 'CloudWatchTransactionSearch', properties.cloudWatchProperties);

        if (!properties.createVpc || properties.createVpc) {
            // Create a new VPC with workshop networking configuration
            this.externalVpc = false;
            const vpc = new WorkshopNetwork(this, 'vpc', {
                name: 'Workshop',
                cidrRange: properties.vpcCidr || '10.0.0.0/16',
                logRetentionDays: properties.defaultRetentionDays || RetentionDays.ONE_WEEK,
                enableDnsQueryResolverLogs: true,
                enableFlowLogs: true,
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

        if (properties.createCloudTrail == true) {
            // Create CloudTrail trail
            new WorkshopCloudTrail(this, 'cloudtrail', {
                name: 'workshop-trail',
                includeS3DataEvents: true,
                logRetentionDays: properties.defaultRetentionDays || RetentionDays.ONE_WEEK,
            });
        }
    }
}
