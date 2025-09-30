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
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { QueueResourcesProperties } from '../constructs/queue';
import { EventBusResourcesProperties } from '../constructs/eventbus';
import { CloudWatchTransactionSearchProperties } from '../constructs/cloudwatch';
/**
 * Configuration properties for the CoreStage.
 */
export interface CoreStageProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: {
        [key: string]: string;
    };
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
export declare class CoreStage extends Stage {
    /** The core infrastructure stack */
    readonly coreStack: CoreStack;
    /**
     * Creates a new CoreStage.
     *
     * @param scope - The parent construct
     * @param id - The stage identifier
     * @param properties - Configuration properties for the stage
     */
    constructor(scope: Construct, id: string, properties: CoreStageProperties);
}
/**
 * Core infrastructure stack containing VPC and networking resources.
 *
 * This stack sets up the foundational networking infrastructure for the workshop,
 * either by creating a new VPC or using an existing one.
 */
export declare class CoreStack extends Stack {
    /** The VPC instance used by the workshop */
    readonly vpc: IVpc;
    /** Whether the VPC is externally managed (not created by this stack) */
    readonly externalVpc: boolean;
    /**
     * Creates a new CoreStack.
     *
     * @param scope - The parent construct
     * @param id - The stack identifier
     * @param properties - Configuration properties for the stack
     * @throws Error when neither createVpc nor vpcId is properly specified
     */
    constructor(scope: Construct, id: string, properties: CoreStageProperties);
}
