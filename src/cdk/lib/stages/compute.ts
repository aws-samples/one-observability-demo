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
import { OpenSearchCollection, OpenSearchCollectionProperties } from '../constructs/opensearch-collection';
import { OpenSearchPipeline } from '../constructs/opensearch-pipeline';
import { OpenSearchApplication, OpenSearchApplicationProperties } from '../constructs/opensearch-application';

export interface ComputeProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    ecsEc2Capacity?: number;
    ecsEc2InstanceType?: string;
    eksEc2Capacity?: number;
    eksEc2InstanceType?: string;
    opensearchCollectionProperties?: OpenSearchCollectionProperties;
    opensearchApplicationProperties?: Omit<OpenSearchApplicationProperties, 'collection'>;
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
    /** OpenSearch ingestion pipeline */
    public openSearchPipeline: OpenSearchPipeline;

    /**
     * Creates a new ComputeStack
     * @param scope - The parent construct
     * @param id - The construct id
     * @param properties - Stack properties including EC2 configuration
     */
    constructor(scope: Construct, id: string, properties: ComputeProperties) {
        super(scope, id, properties);

        const vpc = WorkshopNetwork.importVpcFromExports(this, 'WorkshopVpc');
        const { topic } = QueueResources.importFromExports(this, 'ImportedQueueResources');

        /** Add OpenSearch Collection resource */
        const openSearchCollection = new OpenSearchCollection(
            this,
            'OpenSearchCollection',
            properties.opensearchCollectionProperties,
        );

        /** Add OpenSearch Application resource */
        new OpenSearchApplication(this, 'OpenSearchUiApplication', {
            collection: openSearchCollection,
            ...properties.opensearchApplicationProperties,
        });

        // Create OpenSearch ingestion pipeline
        this.openSearchPipeline = new OpenSearchPipeline(this, 'LogsIngestionPipeline', {
            pipelineName: 'petsite-logs-pipeline',
            openSearchCollection: openSearchCollection,
            indexTemplate: 'pet-collection-logs',
        });

        this.ecs = new WorkshopEcs(this, 'PetsiteECS', {
            vpc,
            topic,
            openSearchPipeline: this.openSearchPipeline,
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
