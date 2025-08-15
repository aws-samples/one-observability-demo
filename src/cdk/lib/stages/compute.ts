/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';
import { WorkshopNetwork } from '../constructs/network';
import { QueueResources } from '../constructs/queue';
import { WorkshopEcs } from '../constructs/ecs';
import { WorkshopEks } from '../constructs/eks';

export interface ComputeProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    ecsEc2Capacity?: number;
    ecsEc2InstanceType?: string;
    eksEc2Capacity?: number;
    eksEc2InstanceType?: string;
}

export class ComputeStage extends Stage {
    public stack: ComputeStack;
    constructor(scope: Construct, id: string, properties: ComputeProperties) {
        super(scope, id, properties);

        this.stack = new ComputeStack(this, 'ComputeStack', properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}

/**
 * Stack for compute resources including ECS cluster and auto scaling group
 */
export class ComputeStack extends Stack {
    /** ECS construct */
    public ecs: WorkshopEcs;
    /** EKS construct */
    public eks: WorkshopEks;

    /**
     * Creates a new ComputeStack
     * @param scope - The parent construct
     * @param id - The construct id
     * @param properties - Stack properties including EC2 configuration
     */
    constructor(scope: Construct, id: string, properties?: ComputeProperties) {
        super(scope, id, properties);

        const vpc = WorkshopNetwork.importVpcFromExports(this, 'WorkshopVpc');
        const { topic } = QueueResources.importFromExports(this, 'ImportedQueueResources');

        this.ecs = new WorkshopEcs(this, 'PetsiteECS', {
            vpc,
            topic,
            ecsEc2Capacity: properties?.ecsEc2Capacity,
            ecsEc2InstanceType: properties?.ecsEc2InstanceType,
        });

        this.eks = new WorkshopEks(this, 'PetsiteEKS', {
            vpc,
            eksEc2Capacity: properties?.eksEc2Capacity,
            eksEc2InstanceType: properties?.eksEc2InstanceType,
        });
    }
}
