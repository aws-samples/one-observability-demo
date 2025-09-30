"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenSearchPipeline = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_osis_1 = require("aws-cdk-lib/aws-osis");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
const constants_1 = require("../../bin/constants");
const utilities_1 = require("../utils/utilities");
const environment_1 = require("../../bin/environment");
/**
 * AWS CDK Construct that creates OpenSearch Ingestion pipeline for log processing
 * @class OpenSearchPipeline
 * @extends Construct
 */
class OpenSearchPipeline extends constructs_1.Construct {
    /**
     * Creates a new OpenSearchPipeline construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope, id, properties) {
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
        const collectionEndpoint = 'collectionEndpoint' in properties.openSearchCollection
            ? properties.openSearchCollection.collectionEndpoint
            : properties.openSearchCollection.collection.attrCollectionEndpoint;
        const collectionArn = 'collectionArn' in properties.openSearchCollection
            ? properties.openSearchCollection.collectionArn
            : properties.openSearchCollection.collection.attrArn;
        // Create IAM role for the pipeline
        this.pipelineRole = new aws_iam_1.Role(this, 'PipelineRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('osis-pipelines.amazonaws.com'),
            description: `IAM role for OpenSearch Ingestion pipeline ${pipelineName}`,
        });
        // Add permissions for OpenSearch Serverless access
        this.pipelineRole.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'aoss:*', // Required for pipeline to connect to collection
            ],
            resources: [collectionArn, `${collectionArn}/*`],
        }));
        // Add CloudWatch logging permissions
        this.pipelineRole.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:CreateLogGroup'],
            resources: [
                `arn:aws:logs:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:log-group:/aws/vendedlogs/opensearch-ingestion/${pipelineName}*`,
            ],
        }));
        // Add EventBridge permissions for pipeline lifecycle events
        this.pipelineRole.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: ['events:PutEvents', 'events:DescribeRule', 'events:ListTargetsByRule'],
            resources: [
                `arn:aws:events:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:event-bus/default`,
                `arn:aws:events:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:rule/*`,
            ],
        }));
        // Create CloudWatch log group for pipeline logs
        // OpenSearch Ingestion requires log groups to use /aws/vendedlogs/ prefix
        const logGroup = new aws_logs_1.LogGroup(this, 'PipelineLogGroup', {
            logGroupName: `/aws/vendedlogs/opensearch-ingestion/${pipelineName}`,
            retention: aws_logs_1.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // Generate pipeline configuration YAML
        const pipelineConfiguration = this.generatePipelineConfiguration(collectionEndpoint, indexTemplate, bufferOptions, this.pipelineRole.roleArn);
        // Create the OpenSearch Ingestion pipeline
        this.pipeline = new aws_osis_1.CfnPipeline(this, 'Pipeline', {
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
        this.pipelineEndpoint = aws_cdk_lib_1.Fn.select(0, this.pipeline.attrIngestEndpointUrls);
        this.createExports();
        this.createOutputs();
    }
    /**
     * Generates the pipeline configuration YAML for OpenSearch Ingestion
     * Configures HTTP source, JSON parser processor, and OpenSearch Serverless sink
     * @private
     */
    generatePipelineConfiguration(collectionEndpoint, indexTemplate, bufferOptions, roleArn) {
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
          region: "${aws_cdk_lib_1.Stack.of(this).region}"
          sts_role_arn: "${roleArn}"
          serverless: true`;
        return yamlConfig;
    }
    /**
     * Creates CloudFormation exports for the pipeline
     * @private
     */
    createExports() {
        new aws_cdk_lib_1.CfnOutput(this, 'PipelineArn', {
            value: this.pipeline.attrPipelineArn,
            exportName: constants_1.OPENSEARCH_PIPELINE_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'PipelineEndpoint', {
            value: this.pipelineEndpoint,
            exportName: constants_1.OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'PipelineRoleArn', {
            value: this.pipelineRole.roleArn,
            exportName: constants_1.OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME,
        });
    }
    /**
     * Imports pipeline information from CloudFormation exports
     */
    static importFromExports() {
        const pipelineArn = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_PIPELINE_ARN_EXPORT_NAME);
        const pipelineEndpoint = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME);
        const pipelineRoleArn = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME);
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
    createOutputs() {
        if (this.pipeline) {
            utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
                opensearchpipelinearn: this.pipeline.attrPipelineArn,
                opensearchpipelineendpoint: this.pipelineEndpoint,
                opensearchpipelinerolearn: this.pipelineRole.roleArn,
            })));
        }
        else {
            throw new Error('OpenSearch pipeline is not available');
        }
    }
}
exports.OpenSearchPipeline = OpenSearchPipeline;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC1waXBlbGluZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9wZW5zZWFyY2gtcGlwZWxpbmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7OztFQUdFO0FBQ0YsNkNBQWtFO0FBQ2xFLG1EQUFtRDtBQUNuRCxpREFBc0Y7QUFDdEYsbURBQStEO0FBQy9ELDJDQUF1QztBQUN2QyxtREFJNkI7QUFDN0Isa0RBQStDO0FBQy9DLHVEQUErRDtBQWlEL0Q7Ozs7R0FJRztBQUNILE1BQWEsa0JBQW1CLFNBQVEsc0JBQVM7SUFtQjdDOzs7OztPQUtHO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUF3QztRQUM5RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLCtCQUErQjtRQUMvQixJQUFJLENBQUMsVUFBVSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyxvREFBb0QsQ0FBQyxDQUFDO1FBQzFFLENBQUM7UUFFRCxxQkFBcUI7UUFDckIsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLFlBQVksSUFBSSxtQkFBbUIsQ0FBQztRQUNwRSxNQUFNLGFBQWEsR0FBRztZQUNsQixhQUFhLEVBQUUsVUFBVSxDQUFDLGFBQWEsRUFBRSxhQUFhLElBQUksRUFBRTtZQUM1RCxTQUFTLEVBQUUsVUFBVSxDQUFDLGFBQWEsRUFBRSxTQUFTLElBQUksSUFBSTtTQUN6RCxDQUFDO1FBQ0YsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLGFBQWEsSUFBSSxHQUFHLFlBQVksT0FBTyxDQUFDO1FBQ3pFLE1BQU0sY0FBYyxHQUFHO1lBQ25CLEdBQUcsRUFBRSxVQUFVLENBQUMsY0FBYyxFQUFFLEdBQUcsSUFBSSxDQUFDO1lBQ3hDLEdBQUcsRUFBRSxVQUFVLENBQUMsY0FBYyxFQUFFLEdBQUcsSUFBSSxDQUFDO1NBQzNDLENBQUM7UUFFRixpQ0FBaUM7UUFDakMsTUFB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R0c7SUFDSyxhQUFhO1FBQ2pCLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2hCLHFCQUFTLENBQUMsbUJBQW1CLENBQ3pCLElBQUksRUFDSixvQ0FBc0IsRUFDdEIsSUFBSSxHQUFHLENBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQztnQkFDWCxxQkFBcUIsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWU7Z0JBQ3BELDBCQUEwQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7Z0JBQ2pELHlCQUF5QixFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTzthQUN2RCxDQUFDLENBQ0wsQ0FDSixDQUFDO1FBQ04sQ0FBQzthQUFNLENBQUM7WUFDSixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7UUFDNUQsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQWpRRCxnREFpUUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbmltcG9ydCB7IENmbk91dHB1dCwgRm4sIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ2ZuUGlwZWxpbmUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3Npcyc7XG5pbXBvcnQgeyBSb2xlLCBTZXJ2aWNlUHJpbmNpcGFsLCBQb2xpY3lTdGF0ZW1lbnQsIEVmZmVjdCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgTG9nR3JvdXAsIFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gICAgT1BFTlNFQVJDSF9QSVBFTElORV9BUk5fRVhQT1JUX05BTUUsXG4gICAgT1BFTlNFQVJDSF9QSVBFTElORV9FTkRQT0lOVF9FWFBPUlRfTkFNRSxcbiAgICBPUEVOU0VBUkNIX1BJUEVMSU5FX1JPTEVfQVJOX0VYUE9SVF9OQU1FLFxufSBmcm9tICcuLi8uLi9iaW4vY29uc3RhbnRzJztcbmltcG9ydCB7IFV0aWxpdGllcyB9IGZyb20gJy4uL3V0aWxzL3V0aWxpdGllcyc7XG5pbXBvcnQgeyBQQVJBTUVURVJfU1RPUkVfUFJFRklYIH0gZnJvbSAnLi4vLi4vYmluL2Vudmlyb25tZW50JztcbmltcG9ydCB7IE9wZW5TZWFyY2hDb2xsZWN0aW9uIH0gZnJvbSAnLi9vcGVuc2VhcmNoLWNvbGxlY3Rpb24nO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIGNvbmZpZ3VyaW5nIE9wZW5TZWFyY2hQaXBlbGluZSBjb25zdHJ1Y3RcbiAqIEBpbnRlcmZhY2UgT3BlblNlYXJjaFBpcGVsaW5lUHJvcGVydGllc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIE9wZW5TZWFyY2hQaXBlbGluZVByb3BlcnRpZXMge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIE9wZW5TZWFyY2ggSW5nZXN0aW9uIHBpcGVsaW5lXG4gICAgICogQGRlZmF1bHQgJ3BldC1sb2dzLXBpcGVsaW5lJ1xuICAgICAqL1xuICAgIHBpcGVsaW5lTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIE9wZW5TZWFyY2ggY29sbGVjdGlvbiB0byBzZW5kIGxvZ3MgdG9cbiAgICAgKi9cbiAgICBvcGVuU2VhcmNoQ29sbGVjdGlvbjpcbiAgICAgICAgfCBPcGVuU2VhcmNoQ29sbGVjdGlvblxuICAgICAgICB8IHtcbiAgICAgICAgICAgICAgY29sbGVjdGlvbkFybjogc3RyaW5nO1xuICAgICAgICAgICAgICBjb2xsZWN0aW9uRW5kcG9pbnQ6IHN0cmluZztcbiAgICAgICAgICB9O1xuXG4gICAgLyoqXG4gICAgICogTG9nIGJ1ZmZlciBjb25maWd1cmF0aW9uXG4gICAgICogQGRlZmF1bHQgeyBmbHVzaEludGVydmFsOiA2MCwgYmF0Y2hTaXplOiAxMDAwIH1cbiAgICAgKi9cbiAgICBidWZmZXJPcHRpb25zPzoge1xuICAgICAgICBmbHVzaEludGVydmFsPzogbnVtYmVyO1xuICAgICAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIEluZGV4IHRlbXBsYXRlIGZvciBsb2cgb3JnYW5pemF0aW9uXG4gICAgICogQGRlZmF1bHQgJ2xvZ3Mte3l5eXkuTU0uZGR9J1xuICAgICAqL1xuICAgIGluZGV4VGVtcGxhdGU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBNaW5pbXVtIGFuZCBtYXhpbXVtIHBpcGVsaW5lIGNhcGFjaXR5IHVuaXRzXG4gICAgICogQGRlZmF1bHQgeyBtaW46IDEsIG1heDogNCB9XG4gICAgICovXG4gICAgY2FwYWNpdHlMaW1pdHM/OiB7XG4gICAgICAgIG1pbj86IG51bWJlcjtcbiAgICAgICAgbWF4PzogbnVtYmVyO1xuICAgIH07XG59XG5cbi8qKlxuICogQVdTIENESyBDb25zdHJ1Y3QgdGhhdCBjcmVhdGVzIE9wZW5TZWFyY2ggSW5nZXN0aW9uIHBpcGVsaW5lIGZvciBsb2cgcHJvY2Vzc2luZ1xuICogQGNsYXNzIE9wZW5TZWFyY2hQaXBlbGluZVxuICogQGV4dGVuZHMgQ29uc3RydWN0XG4gKi9cbmV4cG9ydCBjbGFzcyBPcGVuU2VhcmNoUGlwZWxpbmUgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAgIC8qKlxuICAgICAqIFRoZSBPcGVuU2VhcmNoIEluZ2VzdGlvbiBwaXBlbGluZSBmb3IgcHJvY2Vzc2luZyBsb2dzXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyByZWFkb25seSBwaXBlbGluZTogQ2ZuUGlwZWxpbmU7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgSUFNIHJvbGUgZm9yIHRoZSBwaXBlbGluZVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwdWJsaWMgcmVhZG9ubHkgcGlwZWxpbmVSb2xlOiBSb2xlO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHBpcGVsaW5lIGVuZHBvaW50IFVSTFxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwdWJsaWMgcmVhZG9ubHkgcGlwZWxpbmVFbmRwb2ludDogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBPcGVuU2VhcmNoUGlwZWxpbmUgY29uc3RydWN0XG4gICAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgY29uc3RydWN0IElEXG4gICAgICogQHBhcmFtIHByb3BlcnRpZXMgLSBDb25maWd1cmF0aW9uIHByb3BlcnRpZXMgZm9yIHRoZSBjb25zdHJ1Y3RcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBPcGVuU2VhcmNoUGlwZWxpbmVQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgcHJvcGVydGllc1xuICAgICAgICBpZiAoIXByb3BlcnRpZXMub3BlblNlYXJjaENvbGxlY3Rpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignT3BlblNlYXJjaCBjb2xsZWN0aW9uIGlzIHJlcXVpcmVkIGZvciB0aGUgcGlwZWxpbmUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCBkZWZhdWx0IHZhbHVlc1xuICAgICAgICBjb25zdCBwaXBlbGluZU5hbWUgPSBwcm9wZXJ0aWVzLnBpcGVsaW5lTmFtZSB8fCAncGV0LWxvZ3MtcGlwZWxpbmUnO1xuICAgICAgICBjb25zdCBidWZmZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgZmx1c2hJbnRlcnZhbDogcHJvcGVydGllcy5idWZmZXJPcHRpb25zPy5mbHVzaEludGVydmFsIHx8IDYwLFxuICAgICAgICAgICAgYmF0Y2hTaXplOiBwcm9wZXJ0aWVzLmJ1ZmZlck9wdGlvbnM/LmJhdGNoU2l6ZSB8fCAxMDAwLFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBpbmRleFRlbXBsYXRlID0gcHJvcGVydGllcy5pbmRleFRlbXBsYXRlIHx8IGAke3BpcGVsaW5lTmFtZX0tbG9nc2A7XG4gICAgICAgIGNvbnN0IGNhcGFjaXR5TGltaXRzID0ge1xuICAgICAgICAgICAgbWluOiBwcm9wZXJ0aWVzLmNhcGFjaXR5TGltaXRzPy5taW4gfHwgMSxcbiAgICAgICAgICAgIG1heDogcHJvcGVydGllcy5jYXBhY2l0eUxpbWl0cz8ubWF4IHx8IDQsXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gRXh0cmFjdCBjb2xsZWN0aW9uIGluZm9ybWF0aW9uXG4gICAgICAgIGNvbnN0IGNvbGxlY3Rpb25FbmRwb2ludCA9XG4gICAgICAgICAgICAnY29sbGVjdGlvbkVuZHBvaW50JyBpbiBwcm9wZXJ0aWVzLm9wZW5TZWFyY2hDb2xsZWN0aW9uXG4gICAgICAgICAgICAgICAgPyBwcm9wZXJ0aWVzLm9wZW5TZWFyY2hDb2xsZWN0aW9uLmNvbGxlY3Rpb25FbmRwb2ludFxuICAgICAgICAgICAgICAgIDogcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvbi5jb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnQ7XG5cbiAgICAgICAgY29uc3QgY29sbGVjdGlvbkFybiA9XG4gICAgICAgICAgICAnY29sbGVjdGlvbkFybicgaW4gcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvblxuICAgICAgICAgICAgICAgID8gcHJvcGVydGllcy5vcGVuU2VhcmNoQ29sbGVjdGlvbi5jb2xsZWN0aW9uQXJuXG4gICAgICAgICAgICAgICAgOiBwcm9wZXJ0aWVzLm9wZW5TZWFyY2hDb2xsZWN0aW9uLmNvbGxlY3Rpb24uYXR0ckFybjtcblxuICAgICAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIHRoZSBwaXBlbGluZVxuICAgICAgICB0aGlzLnBpcGVsaW5lUm9sZSA9IG5ldyBSb2xlKHRoaXMsICdQaXBlbGluZVJvbGUnLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdvc2lzLXBpcGVsaW5lcy5hbWF6b25hd3MuY29tJyksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYElBTSByb2xlIGZvciBPcGVuU2VhcmNoIEluZ2VzdGlvbiBwaXBlbGluZSAke3BpcGVsaW5lTmFtZX1gLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgcGVybWlzc2lvbnMgZm9yIE9wZW5TZWFyY2ggU2VydmVybGVzcyBhY2Nlc3NcbiAgICAgICAgdGhpcy5waXBlbGluZVJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICdhb3NzOionLCAvLyBSZXF1aXJlZCBmb3IgcGlwZWxpbmUgdG8gY29ubmVjdCB0byBjb2xsZWN0aW9uXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb2xsZWN0aW9uQXJuLCBgJHtjb2xsZWN0aW9uQXJufS8qYF0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBBZGQgQ2xvdWRXYXRjaCBsb2dnaW5nIHBlcm1pc3Npb25zXG4gICAgICAgIHRoaXMucGlwZWxpbmVSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cycsICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHtTdGFjay5vZih0aGlzKS5yZWdpb259OiR7U3RhY2sub2YodGhpcykuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvdmVuZGVkbG9ncy9vcGVuc2VhcmNoLWluZ2VzdGlvbi8ke3BpcGVsaW5lTmFtZX0qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQWRkIEV2ZW50QnJpZGdlIHBlcm1pc3Npb25zIGZvciBwaXBlbGluZSBsaWZlY3ljbGUgZXZlbnRzXG4gICAgICAgIHRoaXMucGlwZWxpbmVSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydldmVudHM6UHV0RXZlbnRzJywgJ2V2ZW50czpEZXNjcmliZVJ1bGUnLCAnZXZlbnRzOkxpc3RUYXJnZXRzQnlSdWxlJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmV2ZW50czoke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtTdGFjay5vZih0aGlzKS5hY2NvdW50fTpldmVudC1idXMvZGVmYXVsdGAsXG4gICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmV2ZW50czoke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtTdGFjay5vZih0aGlzKS5hY2NvdW50fTpydWxlLypgLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIHBpcGVsaW5lIGxvZ3NcbiAgICAgICAgLy8gT3BlblNlYXJjaCBJbmdlc3Rpb24gcmVxdWlyZXMgbG9nIGdyb3VwcyB0byB1c2UgL2F3cy92ZW5kZWRsb2dzLyBwcmVmaXhcbiAgICAgICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgJ1BpcGVsaW5lTG9nR3JvdXAnLCB7XG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL3ZlbmRlZGxvZ3Mvb3BlbnNlYXJjaC1pbmdlc3Rpb24vJHtwaXBlbGluZU5hbWV9YCxcbiAgICAgICAgICAgIHJldGVudGlvbjogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgcGlwZWxpbmUgY29uZmlndXJhdGlvbiBZQU1MXG4gICAgICAgIGNvbnN0IHBpcGVsaW5lQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2VuZXJhdGVQaXBlbGluZUNvbmZpZ3VyYXRpb24oXG4gICAgICAgICAgICBjb2xsZWN0aW9uRW5kcG9pbnQsXG4gICAgICAgICAgICBpbmRleFRlbXBsYXRlLFxuICAgICAgICAgICAgYnVmZmVyT3B0aW9ucyxcbiAgICAgICAgICAgIHRoaXMucGlwZWxpbmVSb2xlLnJvbGVBcm4sXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHRoZSBPcGVuU2VhcmNoIEluZ2VzdGlvbiBwaXBlbGluZVxuICAgICAgICB0aGlzLnBpcGVsaW5lID0gbmV3IENmblBpcGVsaW5lKHRoaXMsICdQaXBlbGluZScsIHtcbiAgICAgICAgICAgIHBpcGVsaW5lTmFtZTogcGlwZWxpbmVOYW1lLFxuICAgICAgICAgICAgcGlwZWxpbmVDb25maWd1cmF0aW9uQm9keTogcGlwZWxpbmVDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgbWluVW5pdHM6IGNhcGFjaXR5TGltaXRzLm1pbixcbiAgICAgICAgICAgIG1heFVuaXRzOiBjYXBhY2l0eUxpbWl0cy5tYXgsXG4gICAgICAgICAgICAvLyBDb25maWd1cmUgbG9nIHB1Ymxpc2hpbmcgZm9yIHBpcGVsaW5lIG1vbml0b3JpbmdcbiAgICAgICAgICAgIGxvZ1B1Ymxpc2hpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgaXNMb2dnaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjbG91ZFdhdGNoTG9nRGVzdGluYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL3ZlbmRlZGxvZ3Mvb3BlbnNlYXJjaC1pbmdlc3Rpb24vJHtwaXBlbGluZU5hbWV9YCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIEFkZCB0YWdzIGZvciByZXNvdXJjZSBtYW5hZ2VtZW50XG4gICAgICAgICAgICB0YWdzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBrZXk6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHBpcGVsaW5lTmFtZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAga2V5OiAnUHVycG9zZScsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiAnTG9nSW5nZXN0aW9uJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAga2V5OiAnQ29tcG9uZW50JyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6ICdPcGVuU2VhcmNoUGlwZWxpbmUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgZGVwZW5kZW5jaWVzIHRvIGVuc3VyZSByZXNvdXJjZXMgYXJlIGNyZWF0ZWQgaW4gY29ycmVjdCBvcmRlclxuICAgICAgICB0aGlzLnBpcGVsaW5lLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLnBpcGVsaW5lUm9sZSk7XG4gICAgICAgIHRoaXMucGlwZWxpbmUubm9kZS5hZGREZXBlbmRlbmN5KGxvZ0dyb3VwKTtcblxuICAgICAgICAvLyBTZXQgdGhlIHBpcGVsaW5lIGVuZHBvaW50IChleHRyYWN0IGZpcnN0IGVuZHBvaW50IGZyb20gdGhlIGFycmF5KVxuICAgICAgICAvLyBUaGUgYXR0ckluZ2VzdEVuZHBvaW50VXJscyByZXR1cm5zIGFuIGFycmF5LCBzbyB3ZSBuZWVkIHRvIGdldCB0aGUgZmlyc3QgZWxlbWVudFxuICAgICAgICB0aGlzLnBpcGVsaW5lRW5kcG9pbnQgPSBGbi5zZWxlY3QoMCwgdGhpcy5waXBlbGluZS5hdHRySW5nZXN0RW5kcG9pbnRVcmxzKTtcblxuICAgICAgICB0aGlzLmNyZWF0ZUV4cG9ydHMoKTtcbiAgICAgICAgdGhpcy5jcmVhdGVPdXRwdXRzKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIHRoZSBwaXBlbGluZSBjb25maWd1cmF0aW9uIFlBTUwgZm9yIE9wZW5TZWFyY2ggSW5nZXN0aW9uXG4gICAgICogQ29uZmlndXJlcyBIVFRQIHNvdXJjZSwgSlNPTiBwYXJzZXIgcHJvY2Vzc29yLCBhbmQgT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIHNpbmtcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgZ2VuZXJhdGVQaXBlbGluZUNvbmZpZ3VyYXRpb24oXG4gICAgICAgIGNvbGxlY3Rpb25FbmRwb2ludDogc3RyaW5nLFxuICAgICAgICBpbmRleFRlbXBsYXRlOiBzdHJpbmcsXG4gICAgICAgIGJ1ZmZlck9wdGlvbnM6IHsgZmx1c2hJbnRlcnZhbDogbnVtYmVyOyBiYXRjaFNpemU6IG51bWJlciB9LFxuICAgICAgICByb2xlQXJuOiBzdHJpbmcsXG4gICAgKTogc3RyaW5nIHtcbiAgICAgICAgLy8gU3RyaXAgaHR0cHM6Ly8gZnJvbSBjb2xsZWN0aW9uIGVuZHBvaW50IGZvciBPcGVuU2VhcmNoIHNpbmtcbiAgICAgICAgY29uc3QgY2xlYW5FbmRwb2ludCA9IGNvbGxlY3Rpb25FbmRwb2ludC5yZXBsYWNlKCdodHRwczovLycsICcnKTtcblxuICAgICAgICAvLyBHZW5lcmF0ZSBZQU1MIGNvbmZpZ3VyYXRpb24gZm9yIE9TSSBwaXBlbGluZSB3aXRoIG1pbmltYWwgcHJvY2Vzc2luZ1xuICAgICAgICAvLyBGbHVlbnRCaXQgYWxyZWFkeSBzZW5kcyBKU09OIGZvcm1hdCwgc28gd2UgZG9uJ3QgbmVlZCB0byBwYXJzZSBpdFxuICAgICAgICBjb25zdCB5YW1sQ29uZmlnID0gYHZlcnNpb246IFwiMlwiXG5sb2ctcGlwZWxpbmU6XG4gIHNvdXJjZTpcbiAgICBodHRwOlxuICAgICAgcGF0aDogXCIvbG9nL2luZ2VzdFwiXG4gIHByb2Nlc3NvcjpcbiAgICAtIHBhcnNlX2pzb246XG4gICAgICAgIHNvdXJjZTogXCJsb2dcIlxuICAgICAgICBkZXN0aW5hdGlvbjogXCJwYXJzZWRfbG9nXCJcbiAgICAgICAgcGFyc2Vfd2hlbjogJy9sb2cgIT0gbnVsbCBhbmQgL2xvZyAhPSBcIlwiJ1xuICAgIC0gYWRkX2VudHJpZXM6XG4gICAgICAgIGVudHJpZXM6XG4gICAgICAgICAgLSBrZXk6IFwicGlwZWxpbmVfdmVyc2lvblwiXG4gICAgICAgICAgICB2YWx1ZTogXCIxLjBcIlxuICBzaW5rOlxuICAgIC0gb3BlbnNlYXJjaDpcbiAgICAgICAgaG9zdHM6IFtcIiR7Y2xlYW5FbmRwb2ludH1cIl1cbiAgICAgICAgaW5kZXg6IFwiJHtpbmRleFRlbXBsYXRlfVwiXG4gICAgICAgIGF3czpcbiAgICAgICAgICByZWdpb246IFwiJHtTdGFjay5vZih0aGlzKS5yZWdpb259XCJcbiAgICAgICAgICBzdHNfcm9sZV9hcm46IFwiJHtyb2xlQXJufVwiXG4gICAgICAgICAgc2VydmVybGVzczogdHJ1ZWA7XG5cbiAgICAgICAgcmV0dXJuIHlhbWxDb25maWc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBDbG91ZEZvcm1hdGlvbiBleHBvcnRzIGZvciB0aGUgcGlwZWxpbmVcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlRXhwb3J0cygpOiB2b2lkIHtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnUGlwZWxpbmVBcm4nLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5waXBlbGluZS5hdHRyUGlwZWxpbmVBcm4sXG4gICAgICAgICAgICBleHBvcnROYW1lOiBPUEVOU0VBUkNIX1BJUEVMSU5FX0FSTl9FWFBPUlRfTkFNRSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnUGlwZWxpbmVFbmRwb2ludCcsIHtcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLnBpcGVsaW5lRW5kcG9pbnQsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBPUEVOU0VBUkNIX1BJUEVMSU5FX0VORFBPSU5UX0VYUE9SVF9OQU1FLFxuICAgICAgICB9KTtcblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdQaXBlbGluZVJvbGVBcm4nLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5waXBlbGluZVJvbGUucm9sZUFybixcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IE9QRU5TRUFSQ0hfUElQRUxJTkVfUk9MRV9BUk5fRVhQT1JUX05BTUUsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEltcG9ydHMgcGlwZWxpbmUgaW5mb3JtYXRpb24gZnJvbSBDbG91ZEZvcm1hdGlvbiBleHBvcnRzXG4gICAgICovXG4gICAgcHVibGljIHN0YXRpYyBpbXBvcnRGcm9tRXhwb3J0cygpOiB7XG4gICAgICAgIHBpcGVsaW5lQXJuOiBzdHJpbmc7XG4gICAgICAgIHBpcGVsaW5lRW5kcG9pbnQ6IHN0cmluZztcbiAgICAgICAgcGlwZWxpbmVSb2xlQXJuOiBzdHJpbmc7XG4gICAgfSB7XG4gICAgICAgIGNvbnN0IHBpcGVsaW5lQXJuID0gRm4uaW1wb3J0VmFsdWUoT1BFTlNFQVJDSF9QSVBFTElORV9BUk5fRVhQT1JUX05BTUUpO1xuICAgICAgICBjb25zdCBwaXBlbGluZUVuZHBvaW50ID0gRm4uaW1wb3J0VmFsdWUoT1BFTlNFQVJDSF9QSVBFTElORV9FTkRQT0lOVF9FWFBPUlRfTkFNRSk7XG4gICAgICAgIGNvbnN0IHBpcGVsaW5lUm9sZUFybiA9IEZuLmltcG9ydFZhbHVlKE9QRU5TRUFSQ0hfUElQRUxJTkVfUk9MRV9BUk5fRVhQT1JUX05BTUUpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwaXBlbGluZUFybixcbiAgICAgICAgICAgIHBpcGVsaW5lRW5kcG9pbnQsXG4gICAgICAgICAgICBwaXBlbGluZVJvbGVBcm4sXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBTU00gcGFyYW1ldGVyIG91dHB1dHMgZm9yIHRoZSBwaXBlbGluZVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBjcmVhdGVPdXRwdXRzKCk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5waXBlbGluZSkge1xuICAgICAgICAgICAgVXRpbGl0aWVzLmNyZWF0ZVNzbVBhcmFtZXRlcnMoXG4gICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICBQQVJBTUVURVJfU1RPUkVfUFJFRklYLFxuICAgICAgICAgICAgICAgIG5ldyBNYXAoXG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5zZWFyY2hwaXBlbGluZWFybjogdGhpcy5waXBlbGluZS5hdHRyUGlwZWxpbmVBcm4sXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuc2VhcmNocGlwZWxpbmVlbmRwb2ludDogdGhpcy5waXBlbGluZUVuZHBvaW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbnNlYXJjaHBpcGVsaW5lcm9sZWFybjogdGhpcy5waXBlbGluZVJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ09wZW5TZWFyY2ggcGlwZWxpbmUgaXMgbm90IGF2YWlsYWJsZScpO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19