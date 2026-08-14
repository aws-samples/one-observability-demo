/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Managed Prometheus Collector construct for the One Observability Workshop.
 *
 * Creates an AMP (Amazon Managed Service for Prometheus) Scraper that collects
 * Prometheus metrics from ECS Fargate services via Cloud Map DNS service discovery
 * and sends them to CloudWatch as a destination.
 *
 * Since the CloudFormation `AWS::APS::Scraper` resource does not yet support the
 * `cloudWatchConfiguration` destination, this construct uses an `AwsCustomResource`
 * to call the `amp:CreateScraper` API directly.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { IVpc, ISecurityGroup, Port } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
    AwsCustomResource,
    AwsCustomResourcePolicy,
    PhysicalResourceId,
    PhysicalResourceIdReference,
} from 'aws-cdk-lib/custom-resources';

/**
 * Properties for the ManagedPrometheusCollector construct.
 */
export interface ManagedPrometheusCollectorProps {
    /** VPC where the scraper will be deployed */
    readonly vpc: IVpc;
    /** Security group for the scraper's ENIs */
    readonly securityGroup: ISecurityGroup;
    /** Private subnet IDs where the scraper ENIs are placed */
    readonly privateSubnetIds: string[];
    /** Cloud Map namespace name for DNS-based service discovery */
    readonly cloudMapNamespaceName: string;
    /** Target services to scrape (name + port) */
    readonly targetServices: { name: string; port: number }[];
    /** Additional targets for the "full" scrape config (stored in a separate SSM param for hands-on update-scraper exercise) */
    readonly additionalUpdateTargets?: { name: string; port: number }[];
    /** CloudWatch dataset ARN for metric destination (default: account default dataset) */
    readonly datasetArn?: string;
    /** Alias for the scraper (default: 'workshop-ecs-collector') */
    readonly alias?: string;
    /** SSM parameter prefix (default: '/petstore/prometheus-collector') */
    readonly parameterPrefix?: string;
}

/**
 * Creates an AMP Managed Scraper with CloudWatch destination using AwsCustomResource.
 *
 * The scraper uses DNS-based service discovery via Cloud Map to find targets,
 * and applies relabel_configs to enrich metrics with service context.
 */
export class ManagedPrometheusCollector extends Construct {
    /** The scraper ID returned by the CreateScraper API */
    public readonly scraperId: string;
    /** The scraper ARN */
    public readonly scraperArn: string;
    /** The raw scrape configuration YAML (not base64-encoded) */
    public readonly scrapeConfigYaml: string;
    /** The full scrape config YAML including additional update targets (for hands-on exercise) */
    public readonly updateScrapeConfigYaml?: string;

    constructor(scope: Construct, id: string, props: ManagedPrometheusCollectorProps) {
        super(scope, id);

        const alias = props.alias ?? 'workshop-ecs-collector';
        const parameterPrefix = props.parameterPrefix ?? '/petstore/prometheus-collector';
        const datasetArn =
            props.datasetArn ??
            `arn:aws:cloudwatch:${Stack.of(this).region}:${Stack.of(this).account}:dataset/default`;

        // Build scrape configuration YAML
        this.scrapeConfigYaml = this.buildScrapeConfig(props.targetServices, props.cloudMapNamespaceName);

        // Base64-encode the scrape config for the API call.
        // AwsCustomResource passes Blob-typed fields as base64 strings to the SDK.
        const base64ConfigBlob = Buffer.from(this.scrapeConfigYaml).toString('base64');

        // Add self-referencing ingress rule for scraper ENIs to reach targets on port 8080
        props.securityGroup.addIngressRule(
            props.securityGroup,
            Port.tcp(8080),
            'Managed Prometheus Collector self-reference',
        );

        // Create the scraper via AwsCustomResource
        const scraperResource = new AwsCustomResource(this, 'CreateScraper', {
            onCreate: {
                service: 'amp',
                action: 'createScraper',
                parameters: {
                    alias: alias,
                    source: {
                        vpcConfiguration: {
                            subnetIds: props.privateSubnetIds,
                            securityGroupIds: [props.securityGroup.securityGroupId],
                        },
                    },
                    destination: {
                        cloudWatchConfiguration: {
                            datasetArn: datasetArn,
                        },
                    },
                    scrapeConfiguration: {
                        configurationBlob: base64ConfigBlob,
                    },
                },
                physicalResourceId: PhysicalResourceId.fromResponse('scraperId'),
            },
            onDelete: {
                service: 'amp',
                action: 'deleteScraper',
                parameters: {
                    scraperId: new PhysicalResourceIdReference(),
                },
            },
            policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                    actions: [
                        'aps:CreateScraper',
                        'aps:DeleteScraper',
                        'aps:DescribeScraper',
                        'iam:PassRole',
                        'iam:CreateServiceLinkedRole',
                        'ec2:CreateNetworkInterface',
                        'ec2:DeleteNetworkInterface',
                        'ec2:DescribeNetworkInterfaces',
                        'ec2:DescribeSubnets',
                        'ec2:DescribeSecurityGroups',
                    ],
                    resources: ['*'],
                }),
            ]),
        });

        // Extract outputs from the custom resource response
        this.scraperId = scraperResource.getResponseField('scraperId');
        this.scraperArn = scraperResource.getResponseField('arn');

        // Create SSM parameters
        new StringParameter(this, 'ScraperIdParam', {
            parameterName: `${parameterPrefix}/scraper-id`,
            stringValue: this.scraperId,
            description: 'Managed Prometheus Collector scraper ID',
        });

        new StringParameter(this, 'ScrapeConfigYamlParam', {
            parameterName: `${parameterPrefix}/scrape-config-yaml`,
            stringValue: this.scrapeConfigYaml,
            description: 'Managed Prometheus Collector scrape configuration YAML',
        });

        new StringParameter(this, 'DatasetArnParam', {
            parameterName: `${parameterPrefix}/dataset-arn`,
            stringValue: datasetArn,
            description: 'CloudWatch dataset ARN used by the managed collector',
        });

        new StringParameter(this, 'AliasParam', {
            parameterName: `${parameterPrefix}/alias`,
            stringValue: alias,
            description: 'Managed Prometheus Collector alias',
        });

        // If additional update targets are provided, generate a full scrape config
        // containing BOTH initial services and the additional targets.
        // This is stored in a separate SSM parameter for the hands-on update-scraper exercise.
        if (props.additionalUpdateTargets && props.additionalUpdateTargets.length > 0) {
            const allTargets = [...props.targetServices, ...props.additionalUpdateTargets];
            this.updateScrapeConfigYaml = this.buildScrapeConfig(allTargets, props.cloudMapNamespaceName);

            new StringParameter(this, 'ScrapeConfigWithAllTargetsParam', {
                parameterName: `${parameterPrefix}/scrape-config-yaml-with-all-targets`,
                stringValue: this.updateScrapeConfigYaml,
                description: 'Full scrape configuration YAML with all targets (used for hands-on update-scraper exercise)',
            });
        }
    }

    /**
     * Builds the Prometheus scrape configuration YAML.
     * One job per target service using DNS SD against Cloud Map.
     */
    private buildScrapeConfig(targetServices: { name: string; port: number }[], cloudMapNamespace: string): string {
        const scrapeConfigs = targetServices.map(
            (svc) => `  - job_name: 'ecs-${svc.name}'
    dns_sd_configs:
      - names: ['${svc.name}.${cloudMapNamespace}']
        type: A
        port: ${svc.port}
    metrics_path: '/metrics'
    relabel_configs:
      - target_label: service_name
        replacement: '${svc.name}'
      - target_label: cloudmap_namespace
        replacement: '${cloudMapNamespace}'
      - target_label: compute_platform
        replacement: 'ecs-fargate'`,
        );

        return `global:
  scrape_interval: 30s
  scrape_timeout: 10s
scrape_configs:
${scrapeConfigs.join('\n')}
`;
    }
}
