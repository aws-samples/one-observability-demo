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
 * `CreateScraper` is asynchronous and `DeleteScraper` rejects scrapers that are not
 * ACTIVE, so deletion is handled by a separate Provider-backed custom resource that
 * waits for the scraper to settle before deleting it (see `addScraperDeletionWaiter`).
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CustomResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { IVpc, ISecurityGroup, Port } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId, Provider } from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';

/**
 * Properties for the ManagedPrometheusCollector construct.
 */
export interface ManagedPrometheusCollectorProperties {
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

    constructor(scope: Construct, id: string, properties: ManagedPrometheusCollectorProperties) {
        super(scope, id);

        const alias = properties.alias ?? 'workshop-ecs-collector';
        const parameterPrefix = properties.parameterPrefix ?? '/petstore/prometheus-collector';
        const datasetArn =
            properties.datasetArn ??
            `arn:aws:cloudwatch:${Stack.of(this).region}:${Stack.of(this).account}:dataset/default`;

        // Build scrape configuration YAML
        this.scrapeConfigYaml = this.buildScrapeConfig(properties.targetServices, properties.cloudMapNamespaceName);

        // Pass the raw YAML string directly. The AWS SDK v3 encodes Blob-typed fields
        // automatically for JSON transport. Pre-base64-encoding causes the SDK to encode
        // AGAIN, producing a double-encoded blob that the API rejects with
        // "Invalid Prometheus scrape configuration".

        // Add self-referencing ingress rule for scraper ENIs to reach targets on port 8080
        properties.securityGroup.addIngressRule(
            properties.securityGroup,
            Port.tcp(8080),
            'Managed Prometheus Collector self-reference',
        );

        // Create the scraper via AwsCustomResource
        const scraperResource = new AwsCustomResource(this, 'CreateScraper', {
            // installLatestAwsSdk: install the latest @aws-sdk/client-amp at Lambda cold start.
            // The bundled Node.js runtime SDK doesn't yet include the cloudWatchConfiguration
            // destination type; without this flag, parameter validation rejects the destination.
            installLatestAwsSdk: true,
            onCreate: {
                service: 'amp',
                action: 'createScraper',
                parameters: {
                    alias: alias,
                    source: {
                        vpcConfiguration: {
                            subnetIds: properties.privateSubnetIds,
                            securityGroupIds: [properties.securityGroup.securityGroupId],
                        },
                    },
                    destination: {
                        cloudWatchConfiguration: {
                            datasetArn: datasetArn,
                        },
                    },
                    scrapeConfiguration: {
                        configurationBlob: this.scrapeConfigYaml,
                    },
                },
                physicalResourceId: PhysicalResourceId.fromResponse('scraperId'),
            },
            // No onDelete: DeleteScraper fails while the scraper is still CREATING (e.g. on a
            // rollback right after create). Deletion is handled by the waiter resource below.
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

        // Depends on scraperResource through the scraperId token, so CloudFormation deletes
        // the waiter (and with it the scraper) before the create-only AwsCustomResource.
        this.addScraperDeletionWaiter();

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
        if (properties.additionalUpdateTargets && properties.additionalUpdateTargets.length > 0) {
            const allTargets = [...properties.targetServices, ...properties.additionalUpdateTargets];
            this.updateScrapeConfigYaml = this.buildScrapeConfig(allTargets, properties.cloudMapNamespaceName);

            new StringParameter(this, 'ScrapeConfigWithAllTargetsParam', {
                parameterName: `${parameterPrefix}/scrape-config-yaml-with-all-targets`,
                stringValue: this.updateScrapeConfigYaml,
                description:
                    'Full scrape configuration YAML with all targets (used for hands-on update-scraper exercise)',
            });
        }
    }

    /**
     * Adds a custom resource that deletes the scraper on stack delete or rollback.
     *
     * The isComplete handler waits until the scraper leaves a transitional state
     * (CREATING/UPDATING), calls DeleteScraper once it is ACTIVE, and then waits until
     * the scraper is gone. A scraper that failed to create or no longer exists counts
     * as deleted. Create and Update are no-ops.
     */
    private addScraperDeletionWaiter(): void {
        const waiterRole = new Role(this, 'ScraperDeletionWaiterRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        });
        waiterRole.addToPolicy(
            new PolicyStatement({
                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: ['*'],
            }),
        );
        waiterRole.addToPolicy(
            new PolicyStatement({
                actions: ['aps:DescribeScraper', 'aps:DeleteScraper'],
                resources: [this.scraperArn],
            }),
        );
        waiterRole.addToPolicy(
            new PolicyStatement({
                actions: ['ec2:DeleteNetworkInterface', 'ec2:DescribeNetworkInterfaces'],
                resources: ['*'],
            }),
        );

        const onEventFunction = new LambdaFunction(this, 'ScraperDeletionWaiterFunction', {
            runtime: Runtime.PYTHON_3_13,
            handler: 'index.handler',
            role: waiterRole,
            timeout: Duration.minutes(1),
            logGroup: new LogGroup(this, 'ScraperDeletionWaiterFunctionLogGroup', {
                retention: RetentionDays.ONE_DAY,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            code: Code.fromInline(
                [
                    'def handler(event, context):',
                    '    # onEvent: no work here. On Delete, the isComplete handler waits for',
                    '    # the scraper to become deletable, deletes it and waits until it is gone.',
                    '    if event.get("RequestType") == "Delete":',
                    '        return {}',
                    '    return {"PhysicalResourceId": event["ResourceProperties"]["ScraperId"]}',
                ].join('\n'),
            ),
        });

        const isCompleteFunction = new LambdaFunction(this, 'ScraperDeletionWaiterIsCompleteFunction', {
            runtime: Runtime.PYTHON_3_13,
            handler: 'index.handler',
            role: waiterRole,
            timeout: Duration.minutes(1),
            logGroup: new LogGroup(this, 'ScraperDeletionWaiterIsCompleteFunctionLogGroup', {
                retention: RetentionDays.ONE_DAY,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            code: Code.fromInline(
                [
                    'import boto3',
                    'from botocore.exceptions import ClientError',
                    '',
                    'amp = boto3.client("amp")',
                    '',
                    '# Codes that mean there is no scraper to delete: it is gone, or the ID is',
                    '# not a valid scraper ID (e.g. a placeholder after a failed create).',
                    'GONE_CODES = ("ResourceNotFoundException", "ValidationException")',
                    '',
                    'def handler(event, context):',
                    '    # Only Delete needs to wait; Create and Update are no-ops.',
                    '    if event.get("RequestType") != "Delete":',
                    '        return {"IsComplete": True}',
                    '    scraper_id = event["ResourceProperties"]["ScraperId"]',
                    '    try:',
                    '        status = amp.describe_scraper(scraperId=scraper_id)["scraper"]["status"]["statusCode"]',
                    '    except ClientError as error:',
                    '        if error.response["Error"]["Code"] in GONE_CODES:',
                    '            return {"IsComplete": True}',
                    '        raise',
                    '    print(f"Scraper {scraper_id} status: {status}")',
                    '    if status == "CREATION_FAILED":',
                    '        return {"IsComplete": True}',
                    '    if status == "DELETION_FAILED":',
                    '        raise Exception(f"Scraper {scraper_id} deletion failed; delete it manually")',
                    '    if status in ("ACTIVE", "UPDATE_FAILED"):',
                    '        try:',
                    '            amp.delete_scraper(scraperId=scraper_id)',
                    '        except ClientError as error:',
                    '            code = error.response["Error"]["Code"]',
                    '            if code in GONE_CODES:',
                    '                return {"IsComplete": True}',
                    '            if code != "ConflictException":',
                    '                raise',
                    '    # CREATING, UPDATING or DELETING (or delete just requested): returning',
                    '    # IsComplete=false tells the Provider framework to poll again.',
                    '    return {"IsComplete": False}',
                ].join('\n'),
            ),
        });

        const provider = new Provider(this, 'ScraperDeletionWaiterProvider', {
            onEventHandler: onEventFunction,
            isCompleteHandler: isCompleteFunction,
            queryInterval: Duration.seconds(30),
            // Covers scraper creation (typically a few minutes) plus deletion.
            totalTimeout: Duration.minutes(30),
        });

        new CustomResource(this, 'ScraperDeletionWaiter', {
            serviceToken: provider.serviceToken,
            properties: {
                ScraperId: this.scraperId,
            },
        });

        NagSuppressions.addResourceSuppressions(
            waiterRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'CloudWatch Logs and scraper ENI cleanup actions do not support resource-level scoping',
                },
            ],
            true,
        );
        NagSuppressions.addResourceSuppressions(
            provider,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'CDK Provider framework role uses managed wildcard permissions',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'CDK Provider framework uses AWS managed Lambda basic execution policy',
                },
                {
                    id: 'AwsSolutions-L1',
                    reason: 'CDK Provider framework Lambda runtime is managed by CDK',
                },
                {
                    id: 'AwsSolutions-SF1',
                    reason: 'CDK Provider waiter state machine logging managed by CDK framework',
                },
                {
                    id: 'AwsSolutions-SF2',
                    reason: 'X-Ray tracing not needed for internal deletion waiter state machine',
                },
                {
                    id: 'Workshop-CWL2',
                    reason: 'CDK Provider framework log groups are managed by CDK, not user code',
                },
            ],
            true,
        );
        NagSuppressions.addResourceSuppressions(
            [onEventFunction, isCompleteFunction],
            [
                {
                    id: 'AwsSolutions-L1',
                    reason: 'Python 3.13 is the latest supported runtime at time of writing',
                },
            ],
            true,
        );
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
