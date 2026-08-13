/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudWatch Metric Enrichment Pipeline construct for the One Observability Workshop.
 *
 * Creates a CloudWatch Telemetry Pipeline that enriches metrics collected by the
 * Managed Prometheus Collector with additional attributes (e.g., workshop context,
 * collection method). Uses the native L1 `CfnTelemetryPipelines` construct.
 *
 * The pipeline matches metrics by their `cloudmap_namespace` resource attribute,
 * which is set by the scraper's relabel_configs. This provides a single pipeline
 * that covers all services scraped by the managed collector.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnTelemetryPipelines } from 'aws-cdk-lib/aws-observabilityadmin';

/**
 * Properties for the MetricEnrichmentPipeline construct.
 */
export interface MetricEnrichmentPipelineProps {
    /** Name of the telemetry pipeline (default: 'workshop-metric-enrichment') */
    readonly pipelineName?: string;
    /** Target service names (used for documentation; matching is by cloudmap_namespace) */
    readonly targetServiceNames: string[];
    /** Attributes to add to matched metrics (default: workshop context) */
    readonly enrichmentAttributes?: Record<string, string>;
    /** Cloud Map namespace name used in selection criteria */
    readonly cloudMapNamespaceName?: string;
    /** SSM parameter prefix (default: '/petstore/metric-enrichment') */
    readonly parameterPrefix?: string;
}

/**
 * Creates a CloudWatch Telemetry Pipeline that adds enrichment attributes
 * to metrics flowing from the managed Prometheus collector.
 */
export class MetricEnrichmentPipeline extends Construct {
    /** The pipeline ARN */
    public readonly pipelineArn: string;
    /** The pipeline name */
    public readonly pipelineName: string;
    /** The raw pipeline configuration YAML */
    public readonly enrichmentConfigYaml: string;

    constructor(scope: Construct, id: string, props: MetricEnrichmentPipelineProps) {
        super(scope, id);

        this.pipelineName = props.pipelineName ?? 'workshop-metric-enrichment';
        const parameterPrefix = props.parameterPrefix ?? '/petstore/metric-enrichment';
        const cloudMapNamespaceName = props.cloudMapNamespaceName ?? 'Workshop-space';

        const enrichmentAttributes: Record<string, string> = props.enrichmentAttributes ?? {
            collected_by: 'managed_collector',
            workshop: 'one-observability',
            environment: 'workshop',
        };

        // Build the pipeline YAML configuration
        this.enrichmentConfigYaml = this.buildPipelineConfig(cloudMapNamespaceName, enrichmentAttributes);

        // Create the telemetry pipeline using the L1 construct
        const pipeline = new CfnTelemetryPipelines(this, 'Pipeline', {
            name: this.pipelineName,
            configuration: {
                body: this.enrichmentConfigYaml,
            },
        });

        this.pipelineArn = pipeline.attrArn;

        // Create SSM parameters
        new StringParameter(this, 'PipelineNameParam', {
            parameterName: `${parameterPrefix}/pipeline-name`,
            stringValue: this.pipelineName,
            description: 'Metric enrichment pipeline name',
        });

        new StringParameter(this, 'PipelineArnParam', {
            parameterName: `${parameterPrefix}/pipeline-arn`,
            stringValue: this.pipelineArn,
            description: 'Metric enrichment pipeline ARN',
        });

        new StringParameter(this, 'EnrichmentConfigYamlParam', {
            parameterName: `${parameterPrefix}/enrichment-config-yaml`,
            stringValue: this.enrichmentConfigYaml,
            description: 'Metric enrichment pipeline configuration YAML',
        });
    }

    /**
     * Builds the telemetry pipeline YAML configuration.
     *
     * Uses a broad match on `cloudmap_namespace` to select all metrics
     * collected by the managed Prometheus collector via Cloud Map discovery.
     */
    private buildPipelineConfig(
        cloudMapNamespaceName: string,
        enrichmentAttributes: Record<string, string>,
    ): string {
        const attributeEntries = Object.entries(enrichmentAttributes)
            .map(
                ([key, value]) =>
                    `        - key: attributes["${key}"]
          value: "${value}"`,
            )
            .join('\n');

        return `pipeline:
  source:
    cloudwatch_metrics:
      format: otlp
      selection_criteria:
        - match_all:
            - 'resource.attributes["cloudmap_namespace"] == "${cloudMapNamespaceName}"'
  processor:
    - add_attributes:
        attributes:
${attributeEntries}
  sink:
    - cloudwatch_metrics: {}
`;
    }
}
