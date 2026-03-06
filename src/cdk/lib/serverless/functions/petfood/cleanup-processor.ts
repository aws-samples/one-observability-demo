import { Construct } from 'constructs';
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getLambdaInsightsLayerArn,
    getOpenTelemetryPythonLayerArn,
} from '../../../constructs/lambda';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { NagSuppressions } from 'cdk-nag';

export interface PetfoodCleanupProcessorProperties extends WorkshopLambdaFunctionProperties {
    bedrockModelId?: string;
    imageBucket: IBucket;
    eventBridgeBus?: IEventBus;
    petfoodTable: ITable;
}

export class PetfoodCleanupProcessorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: PetfoodCleanupProcessorProperties) {
        properties = { ...properties, description: 'Generate pet food image' };

        super(scope, id, properties);

        new Rule(this, 'PetfoodCleanupProcessorRule', {
            eventBus: properties.eventBridgeBus!,
            eventPattern: {
                source: ['petfood.service'],
                detailType: ['ItemDiscontinued'],
            },
            targets: [new LambdaFunction(this.function, {})],
        });
    }

    addFunctionPermissions(properties: PetfoodCleanupProcessorProperties): void {
        const functionPolicy = new Policy(this, 'PetfoodImageGeneratorPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['bedrock:InvokeModel'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:GetObject', 's3:DeleteObject', 's3:HeadObject'],
                    resources: [properties.imageBucket.bucketArn + '/*'],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:DeleteItem'],
                    resources: [properties.petfoodTable.tableArn],
                }),
            ],
            roles: [this.function.role!],
        });

        NagSuppressions.addResourceSuppressions(
            [this.function.role!, functionPolicy],
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the task role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the task role',
                },
            ],
            true,
        );
    }
    createOutputs(): void {}
    getEnvironmentVariables(properties: PetfoodCleanupProcessorProperties): { [key: string]: string } | undefined {
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
        return [
            LayerVersion.fromLayerVersionArn(
                this,
                'LambdaInsightsLayer',
                getLambdaInsightsLayerArn(Stack.of(this).region),
            ),
            LayerVersion.fromLayerVersionArn(
                this,
                'OpenTelemetryLayer',
                getOpenTelemetryPythonLayerArn(Stack.of(this).region),
            ),
        ];
    }
    getBundling(): BundlingOptions {
        return {};
    }
}
