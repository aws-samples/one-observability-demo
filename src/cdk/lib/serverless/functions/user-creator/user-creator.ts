/**
 * User Creator Lambda function construct.
 *
 * Creates fake user records in the Aurora PostgreSQL database via SQS message processing.
 * Instrumented with OpenTelemetry Python layer and Lambda Insights for observability.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getOpenTelemetryPythonLayerArn,
    getLambdaInsightsLayerArn,
} from '../../../constructs/lambda';
import { ILayerVersion, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack, Duration } from 'aws-cdk-lib';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface UserCreatorProperties extends WorkshopLambdaFunctionProperties {
    databaseSecret: ISecret;
    secretParameterName: string;
    sqsQueue: IQueue;
}

export class UserCreatorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: UserCreatorProperties) {
        const functionProperties = {
            ...properties,
            name: 'user-creator',
            runtime: Runtime.PYTHON_3_13,
            entry: '../applications/lambda/user-creator-python',
            index: 'index.py',
            memorySize: 256,
            timeout: Duration.minutes(5),
            description: 'Lambda function to create users from SQS adoption messages',
        };

        super(scope, id, functionProperties);

        // Add SQS event source
        this.function.addEventSource(
            new SqsEventSource(properties.sqsQueue, {
                batchSize: 10,
                maxBatchingWindow: Duration.seconds(5),
                reportBatchItemFailures: true,
            }),
        );
    }

    addFunctionPermissions(properties: UserCreatorProperties): void {
        const functionPolicy = new Policy(this, 'UserCreatorPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ssm:GetParameter'],
                    resources: [
                        `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${properties.secretParameterName}`,
                    ],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [properties.databaseSecret.secretArn],
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
                    resources: [properties.sqsQueue.queueArn],
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

    getEnvironmentVariables(properties: UserCreatorProperties): { [key: string]: string } | undefined {
        return {
            LOG_LEVEL: 'INFO',
            SECRET_PARAMETER_NAME: properties.secretParameterName,
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
