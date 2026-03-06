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

export interface RdsSeederProperties extends WorkshopLambdaFunctionProperties {
    databaseSecret: ISecret;
    secretParameterName: string;
}

export class RdsSeederFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: RdsSeederProperties) {
        const functionProperties = {
            ...properties,
            name: 'rds-seeder',
            runtime: Runtime.PYTHON_3_13,
            entry: '../applications/lambda/rds-seeder-python',
            index: 'index.py',
            memorySize: 256,
            timeout: Duration.minutes(5),
            description: 'Lambda function to seed RDS Aurora PostgreSQL database',
        };

        super(scope, id, functionProperties);
    }

    addFunctionPermissions(properties: RdsSeederProperties): void {
        const functionPolicy = new Policy(this, 'RdsSeederPolicy', {
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

    getEnvironmentVariables(properties: RdsSeederProperties): { [key: string]: string } | undefined {
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
