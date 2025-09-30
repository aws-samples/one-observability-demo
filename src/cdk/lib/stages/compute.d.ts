import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { WorkshopEcs } from '../constructs/ecs';
import { WorkshopEks } from '../constructs/eks';
import { OpenSearchCollectionProperties } from '../constructs/opensearch-collection';
import { OpenSearchPipeline } from '../constructs/opensearch-pipeline';
import { OpenSearchApplicationProperties } from '../constructs/opensearch-application';
export interface ComputeProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: {
        [key: string]: string;
    };
    ecsEc2Capacity?: number;
    ecsEc2InstanceType?: string;
    eksEc2Capacity?: number;
    eksEc2InstanceType?: string;
    opensearchCollectionProperties?: OpenSearchCollectionProperties;
    opensearchApplicationProperties?: Omit<OpenSearchApplicationProperties, 'collection'>;
}
export declare class ComputeStage extends Stage {
    stack: ComputeStack;
    constructor(scope: Construct, id: string, properties: ComputeProperties);
}
/**
 * Stack for compute resources including ECS cluster and auto scaling group
 */
export declare class ComputeStack extends Stack {
    /** ECS construct */
    ecs: WorkshopEcs;
    /** EKS construct */
    eks: WorkshopEks;
    /** OpenSearch ingestion pipeline */
    openSearchPipeline: OpenSearchPipeline;
    /**
     * Creates a new ComputeStack
     * @param scope - The parent construct
     * @param id - The construct id
     * @param properties - Stack properties including EC2 configuration
     */
    constructor(scope: Construct, id: string, properties: ComputeProperties);
}
