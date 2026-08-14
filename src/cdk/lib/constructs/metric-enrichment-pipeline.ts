/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudWatch Metric Enrichment Pipeline construct for the One Observability Workshop.
 *
 * Creates a CloudWatch Telemetry Pipeline that enriches metrics from ECS services
 * with additional attributes (e.g., workshop context, collection method).
 * Uses the native L1 `CfnTelemetryPipelines` construct.
 *
 * The pipeline uses OR-style multiple selection_criteria entries to match metrics
 * by `service.name` resource attribute. This covers ALL services regardless of
 * collection method — both Prometheus-scraped metrics and OTel SDK pushed metrics.
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
    /** Target service names used to build OR-style selection criteria matching by service.name */
    readonly targetServiceNames: string[];
    /** Attributes to add to matched metrics (default: workshop context) */
    readonly enrichmentAttributes?: Record<string, string>;
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

        const enrichmentAttributes: Record<string, string> = props.enrichmentAttributes ?? {
            collected_by: 'managed_collector',
            workshop: 'one-observability',
            environment: 'workshop',
        };

        // Build the pipeline YAML configuration
        this.enrichmentConfigYaml = this.buildPipelineConfig(props.targetServiceNames, enrichmentAttributes);

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
     * Uses OR-style multiple selection_criteria entries to match metrics from
     * all target services regardless of collection method (scraped or OTLP-pushed).
     * Each entry matches by `service.name` resource attribute.
     */
    private buildPipelineConfig(
        targetServiceNames: string[],
        enrichmentAttributes: Record<string, string>,
    ): string {
        const attributeEntries = Object.entries(enrichmentAttributes)
            .map(
                ([key, value]) =>
                    `        - key: attributes["${key}"]
          value: "${value}"`,
            )
            .join('\n');

        const selectionCriteriaEntries = targetServiceNames
            .map(
                (name) =>
                    `        - match_all:
            - 'resource.attributes["service.name"] == "${name}"'`,
            )
            .join('\n');

        return `pipeline:
  source:
    cloudwatch_metrics:
      format: otlp
      selection_criteria:
${selectionCriteriaEntries}
  processor:
    - add_attributes:
        attributes:
${attributeEntries}
  sink:
    - cloudwatch_metrics: {}
`;
    }
}
