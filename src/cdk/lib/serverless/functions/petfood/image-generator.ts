import { Construct } from 'constructs';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Arn, Stack, ArnFormat } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';

export interface PetfoodImageGeneratorProperties extends WorkshopLambdaFunctionProperties {
    bedrockModelId?: string;
    imageBucket: IBucket;
    eventBridgeBus?: IEventBus;
    petfoodTable: ITable;
}

export class PetfoodImageGeneratorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: PetfoodImageGeneratorProperties) {
        properties = { ...properties, description: 'Generate pet food image' };

        super(scope, id, properties);

        new Rule(this, 'PetfoodImageGeneratorUpdatedRule', {
            eventBus: properties.eventBridgeBus!,
            eventPattern: {
                source: ['petfood.service'],
                detailType: ['FoodItemUpdated'],
            },
            targets: [new LambdaFunction(this.function, {})],
        });

        new Rule(this, 'PetfoodImageGeneratorCreatedRule', {
            eventBus: properties.eventBridgeBus!,
            eventPattern: {
                source: ['petfood.service'],
                detailType: ['FoodItemCreated'],
            },
            targets: [new LambdaFunction(this.function, {})],
        });
    }

    addFunctionPermissions(properties: PetfoodImageGeneratorProperties): void {
        new Policy(this, 'PetfoodImageGeneratorPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['bedrock:InvokeModel'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:GetObject'],
                    resources: [properties.imageBucket.bucketArn + '/*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
                    resources: [properties.petfoodTable.tableArn],
                }),
            ],
            roles: [this.function.role!],
        });
    }
    createOutputs(): void {}
    getEnvironmentVariables(properties: PetfoodImageGeneratorProperties): { [key: string]: string } | undefined {
        return {
            LOG_LEVEL: 'INFO',
            FOOD_TABLE_NAME: properties.petfoodTable.tableName,
            S3_BUCKET_NAME: properties.imageBucket.bucketName,
            BEDROCK_MODEL_ID: properties.bedrockModelId || 'amazon.titan-image-generator-v2:0',
            OTEL_PYTHON_DISABLED_INSTRUMENTATIONS: 'none',
            OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
            OTEL_METRICS_EXPORTER: 'none',
            OTEL_LOGS_EXPORTER: 'none',
            OTEL_SERVICE_NAME: properties.name,
            OTEL_SERVICE_VERSION: '0.1.0',
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
        };
    }
    getLayers(): ILayerVersion[] {
        const lambdaInsightesLayerArn = Arn.format({
            account: '580247275435',
            resource: 'layer',
            resourceName: 'LambdaInsightsExtension:56',
            region: Stack.of(this).region,
            service: 'lambda',
            partition: 'aws',
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });

        const openTelemetryLaterArn = Arn.format({
            account: '615299751070',
            resource: 'AWSOpenTelemetryDistroPython:20',
            region: Stack.of(this).region,
            service: 'lambda',
            partition: 'aws',
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });

        return [
            LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', lambdaInsightesLayerArn),
            LayerVersion.fromLayerVersionArn(this, 'OpenTelemetryLayer', openTelemetryLaterArn),
        ];
    }
    getBundling(): BundlingOptions {
        return {};
    }
}
