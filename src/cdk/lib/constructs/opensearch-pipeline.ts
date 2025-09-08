/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnPipeline } from 'aws-cdk-lib/aws-osis';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import {
    OPENSEARCH_PIPELINE_ARN_EXPORT_NAME,
    OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME,
    OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME,
} from '../../bin/constants';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
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
    openSearchCollection:
        | OpenSearchCollection
        | {
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
export class OpenSearchPipeline extends Construct {
    /**
     * The OpenSearch Ingestion pipeline for processing logs
     * @public
     */
    public readonly pipeline: CfnPipeline;

    /**
     * The IAM role for the pipeline
     * @public
     */
    public readonly pipelineRole: Role;

    /**
     * The pipeline endpoint URL
     * @public
     */
    public readonly pipelineEndpoint: string;

    /**
     * Creates a new OpenSearchPipeline construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties: OpenSearchPipelineProperties) {
        super(scope, id);

        // Validate required properties
        if (!properties.openSearchCollection) {
            throw new Error('OpenSearch collection is required for the pipeline');
        }

        // Set default values
        const pipelineName = properties.pipelineName || 'pet-logs-pipeline';
        const bufferOptions = {
            flushInterval: properties.bufferOptions?.flushInterval || 60,
            batchSize: properties.bufferOptions?.batchSize || 1000,
        };
        const indexTemplate = properties.indexTemplate || `${pipelineName}-logs`;
        const capacityLimits = {
            min: properties.capacityLimits?.min || 1,
            max: properties.capacityLimits?.max || 4,
        };

        // Extract collection information
        const collectionEndpoint =
            'collectionEndpoint' in properties.openSearchCollection
                ? properties.openSearchCollection.collectionEndpoint
                : properties.openSearchCollection.collection.attrCollectionEndpoint;

        const collectionArn =
            'collectionArn' in properties.openSearchCollection
                ? properties.openSearchCollection.collectionArn
                : properties.openSearchCollection.collection.attrArn;

        // Create IAM role for the pipeline
        this.pipelineRole = new Role(this, 'PipelineRole', {
            assumedBy: new ServicePrincipal('osis-pipelines.amazonaws.com'),
            description: `IAM role for OpenSearch Ingestion pipeline ${pipelineName}`,
        });

        // Add permissions for OpenSearch Serverless access
        this.pipelineRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'aoss:*', // Required for pipeline to connect to collection
                ],
                resources: [collectionArn, `${collectionArn}/*`],
            }),
        );

        // Add CloudWatch logging permissions
        this.pipelineRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:CreateLogGroup'],
                resources: [
                    `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/vendedlogs/opensearch-ingestion/${pipelineName}*`,
                ],
            }),
        );

        // Add EventBridge permissions for pipeline lifecycle events
        this.pipelineRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['events:PutEvents', 'events:DescribeRule', 'events:ListTargetsByRule'],
                resources: [
                    `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/default`,
                    `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:rule/*`,
                ],
            }),
        );

        // Create CloudWatch log group for pipeline logs
        // OpenSearch Ingestion requires log groups to use /aws/vendedlogs/ prefix
        const logGroup = new LogGroup(this, 'PipelineLogGroup', {
            logGroupName: `/aws/vendedlogs/opensearch-ingestion/${pipelineName}`,
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // Generate pipeline configuration YAML
        const pipelineConfiguration = this.generatePipelineConfiguration(
            collectionEndpoint,
            indexTemplate,
            bufferOptions,
            this.pipelineRole.roleArn,
        );

        // Create the OpenSearch Ingestion pipeline
        this.pipeline = new CfnPipeline(this, 'Pipeline', {
            pipelineName: pipelineName,
            pipelineConfigurationBody: pipelineConfiguration,
            minUnits: capacityLimits.min,
            maxUnits: capacityLimits.max,
            // Configure log publishing for pipeline monitoring
            logPublishingOptions: {
                isLoggingEnabled: true,
                cloudWatchLogDestination: {
                    logGroup: `/aws/vendedlogs/opensearch-ingestion/${pipelineName}`,
                },
            },
            // Add tags for resource management
            tags: [
                {
                    key: 'Name',
                    value: pipelineName,
                },
                {
                    key: 'Purpose',
                    value: 'LogIngestion',
                },
                {
                    key: 'Component',
                    value: 'OpenSearchPipeline',
                },
            ],
        });

        // Add dependencies to ensure resources are created in correct order
        this.pipeline.node.addDependency(this.pipelineRole);
        this.pipeline.node.addDependency(logGroup);

        // Set the pipeline endpoint (extract first endpoint from the array)
        // The attrIngestEndpointUrls returns an array, so we need to get the first element
        this.pipelineEndpoint = Fn.select(0, this.pipeline.attrIngestEndpointUrls);

        this.createExports();
        this.createOutputs();
    }

    /**
     * Generates the pipeline configuration YAML for OpenSearch Ingestion
     * Configures HTTP source, JSON parser processor, and OpenSearch Serverless sink
     * @private
     */
    private generatePipelineConfiguration(
        collectionEndpoint: string,
        indexTemplate: string,
        bufferOptions: { flushInterval: number; batchSize: number },
        roleArn: string,
    ): string {
        // Strip https:// from collection endpoint for OpenSearch sink
        const cleanEndpoint = collectionEndpoint.replace('https://', '');

        // Generate YAML configuration for OSI pipeline with minimal processing
        // FluentBit already sends JSON format, so we don't need to parse it
        const yamlConfig = `version: "2"
log-pipeline:
  source:
    http:
      path: "/log/ingest"
  processor:
    - parse_json:
        source: "log"
        destination: "parsed_log"
        parse_when: '/log != null and /log != ""'
    - add_entries:
        entries:
          - key: "pipeline_version"
            value: "1.0"
  sink:
    - opensearch:
        hosts: ["${cleanEndpoint}"]
        index: "${indexTemplate}"
        aws:
          region: "${Stack.of(this).region}"
          sts_role_arn: "${roleArn}"
          serverless: true`;

        return yamlConfig;
    }

    /**
     * Creates CloudFormation exports for the pipeline
     * @private
     */
    private createExports(): void {
        new CfnOutput(this, 'PipelineArn', {
            value: this.pipeline.attrPipelineArn,
            exportName: OPENSEARCH_PIPELINE_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'PipelineEndpoint', {
            value: this.pipelineEndpoint,
            exportName: OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME,
        });

        new CfnOutput(this, 'PipelineRoleArn', {
            value: this.pipelineRole.roleArn,
            exportName: OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME,
        });
    }

    /**
     * Imports pipeline information from CloudFormation exports
     * @static
     */
    public static importFromExports(): {
        pipelineArn: string;
        pipelineEndpoint: string;
        pipelineRoleArn: string;
    } {
        const pipelineArn = Fn.importValue(OPENSEARCH_PIPELINE_ARN_EXPORT_NAME);
        const pipelineEndpoint = Fn.importValue(OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME);
        const pipelineRoleArn = Fn.importValue(OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME);

        return {
            pipelineArn,
            pipelineEndpoint,
            pipelineRoleArn,
        };
    }

    /**
     * Creates SSM parameter outputs for the pipeline
     * @private
     */
    private createOutputs(): void {
        if (this.pipeline) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        opensearchpipelinearn: this.pipeline.attrPipelineArn,
                        opensearchpipelineendpoint: this.pipelineEndpoint,
                        opensearchpipelinerolearn: this.pipelineRole.roleArn,
                    }),
                ),
            );
        } else {
            throw new Error('OpenSearch pipeline is not available');
        }
    }
}
