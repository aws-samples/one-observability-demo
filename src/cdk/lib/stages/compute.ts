/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Compute stage for the One Observability Workshop.
 *
 * Deploys container orchestration platforms in the Backend Wave of the CDK pipeline:
 *
 * - **Amazon ECS** cluster with Fargate and EC2 capacity providers, enhanced Container Insights
 * - **Amazon EKS** cluster with managed node groups, CloudWatch Observability addon, and ALB controller
 * - **OpenSearch Serverless** collection, ingestion pipeline, and application (optional)
 * - **SQS Queue** resources for async messaging
 *
 * The ECS and EKS clusters are configured with comprehensive observability:
 * Container Insights v2 (enhanced), CloudWatch agent for Application Signals,
 * and Network Flow Monitor for VPC traffic analysis.
 *
 * > **Note**: Lambda functions and microservices are deployed in the Microservices stage,
 * > not in this stage. This stage only provisions the compute infrastructure.
 *
 * @packageDocumentation
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
import { ENABLE_OPENSEARCH } from '../../bin/environment';

/** Properties for the Compute stage. */
export interface ComputeProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    /** Number of EC2 instances for ECS capacity provider */
    ecsEc2Capacity?: number;
    /** EC2 instance type for ECS capacity provider */
    ecsEc2InstanceType?: string;
    /** Number of EC2 instances for EKS node group */
    eksEc2Capacity?: number;
    /** EC2 instance type for EKS node group */
    eksEc2InstanceType?: string;
    /** OpenSearch Serverless collection configuration */
    opensearchCollectionProperties?: OpenSearchCollectionProperties;
    /** OpenSearch Application configuration (collection is injected automatically) */
    opensearchApplicationProperties?: Omit<OpenSearchApplicationProperties, 'collection'>;
}

/**
 * CDK Pipeline stage that deploys ECS, EKS, and OpenSearch compute infrastructure.
 */
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
    public openSearchPipeline: OpenSearchPipeline | undefined;

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

        let openSearchCollection: OpenSearchCollection | undefined;
        let openSearchPipeline: OpenSearchPipeline | undefined;

        /** Add OpenSearch components only if enabled */
        if (ENABLE_OPENSEARCH) {
            /** Add OpenSearch Collection resource */
            openSearchCollection = new OpenSearchCollection(
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
            openSearchPipeline = new OpenSearchPipeline(this, 'LogsIngestionPipeline', {
                pipelineName: 'petsite-logs-pipeline',
                openSearchCollection: openSearchCollection,
                indexTemplate: 'pet-collection-logs',
            });
        }

        this.openSearchPipeline = openSearchPipeline;

        this.ecs = new WorkshopEcs(this, 'PetsiteECS', {
            vpc,
            topic,
            openSearchPipeline: openSearchPipeline,
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
