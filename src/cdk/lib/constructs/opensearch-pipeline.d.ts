import { CfnPipeline } from 'aws-cdk-lib/aws-osis';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { OpenSearchCollection } from './opensearch-collection';
/**
 * Properties for configuring OpenSearchPipeline construct
 * @interface OpenSearchPipelineProperties
 */
export interface OpenSearchPipelineProperties {
    /**
     * Name of the OpenSearch Ingestion pipeline
     * @default 'pet-logs-pipeline'
     */
    pipelineName?: string;
    /**
     * OpenSearch collection to send logs to
     */
    openSearchCollection: OpenSearchCollection | {
        collectionArn: string;
        collectionEndpoint: string;
    };
    /**
     * Log buffer configuration
     * @default { flushInterval: 60, batchSize: 1000 }
     */
    bufferOptions?: {
        flushInterval?: number;
        batchSize?: number;
    };
    /**
     * Index template for log organization
     * @default 'logs-{yyyy.MM.dd}'
     */
    indexTemplate?: string;
    /**
     * Minimum and maximum pipeline capacity units
     * @default { min: 1, max: 4 }
     */
    capacityLimits?: {
        min?: number;
        max?: number;
    };
}
/**
 * AWS CDK Construct that creates OpenSearch Ingestion pipeline for log processing
 * @class OpenSearchPipeline
 * @extends Construct
 */
export declare class OpenSearchPipeline extends Construct {
    /**
     * The OpenSearch Ingestion pipeline for processing logs
     * @public
     */
    readonly pipeline: CfnPipeline;
    /**
     * The IAM role for the pipeline
     * @public
     */
    readonly pipelineRole: Role;
    /**
     * The pipeline endpoint URL
     * @public
     */
    readonly pipelineEndpoint: string;
    /**
     * Creates a new OpenSearchPipeline construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties: OpenSearchPipelineProperties);
    /**
     * Generates the pipeline configuration YAML for OpenSearch Ingestion
     * Configures HTTP source, JSON parser processor, and OpenSearch Serverless sink
     * @private
     */
    private generatePipelineConfiguration;
    /**
     * Creates CloudFormation exports for the pipeline
     * @private
     */
    private createExports;
    /**
     * Imports pipeline information from CloudFormation exports
     */
    static importFromExports(): {
        pipelineArn: string;
        pipelineEndpoint: string;
        pipelineRoleArn: string;
    };
    /**
     * Creates SSM parameter outputs for the pipeline
     * @private
     */
    private createOutputs;
}
