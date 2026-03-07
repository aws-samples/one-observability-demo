/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pet Food Stock Processor Lambda function construct.
 *
 * Processes EventBridge stock purchase events from the petfood-rs service,
 * updating food inventory in DynamoDB. Uses Node.js with Lambda Insights.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getOpenTelemetryNodeJSLayerArn,
    getLambdaInsightsLayerArn,
} from '../../../constructs/lambda';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { NagSuppressions } from 'cdk-nag';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack } from 'aws-cdk-lib';

export interface PetfoodStockProcessorProperties extends WorkshopLambdaFunctionProperties {
    eventBridgeBus: IEventBus;
    petfoodTable: ITable;
}

/**
 * Lambda function that processes StockPurchased events and decreases stock quantities
 */
export class PetfoodStockProcessorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: PetfoodStockProcessorProperties) {
        const enhancedProperties = {
            ...properties,
            description: 'Processes StockPurchased events to decrease food item stock quantities',
        };

        super(scope, id, enhancedProperties);

        // Create EventBridge rule to trigger on StockPurchased events
        new Rule(this, 'StockProcessorRule', {
            eventBus: properties.eventBridgeBus,
            eventPattern: {
                source: ['petfood.service'],
                detailType: ['StockPurchased'],
            },
            targets: [new LambdaFunction(this.function, {})],
            description: 'Triggers stock processor when items are purchased',
        });
    }

    addFunctionPermissions(properties: PetfoodStockProcessorProperties): void {
        const functionPolicy = new Policy(this, 'StockProcessorPolicy', {
            statements: [
                // DynamoDB permissions for reading and updating food items
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'],
                    resources: [properties.petfoodTable.tableArn],
                }),
                // CloudWatch Logs permissions for detailed logging
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: ['*'],
                }),
                // X-Ray permissions for distributed tracing
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
                    resources: ['*'],
                }),
            ],
            roles: [this.function.role!],
        });

        // Add NAG suppressions for acceptable managed policies and permissions
        NagSuppressions.addResourceSuppressions(
            [this.function.role!, functionPolicy],
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for Lambda execution role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Wildcard permissions are necessary for CloudWatch Logs and X-Ray',
                },
            ],
            true,
        );
    }

    createOutputs(): void {}
    getEnvironmentVariables(properties: WorkshopLambdaFunctionProperties): { [key: string]: string } | undefined {
        const stockProperties = properties as PetfoodStockProcessorProperties;
        return {
            FOODS_TABLE_NAME: stockProperties.petfoodTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1', // Improve performance
            OTEL_NODE_DISABLED_INSTRUMENTATIONS: 'none',
            OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
            OTEL_METRICS_EXPORTER: 'none',
            OTEL_LOGS_EXPORTER: 'none',
            OTEL_SERVICE_NAME: properties.name,
            OTEL_SERVICE_VERSION: '0.1.0',
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
        };
    }

    /**
     * Get Lambda layers for the function
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getLayers(_properties: WorkshopLambdaFunctionProperties): ILayerVersion[] {
        return [
            LayerVersion.fromLayerVersionArn(
                this,
                'LambdaInsightsLayer',
                getLambdaInsightsLayerArn(Stack.of(this).region),
            ),
            LayerVersion.fromLayerVersionArn(
                this,
                'OpenTelemetryLayer',
                getOpenTelemetryNodeJSLayerArn(Stack.of(this).region),
            ),
        ];
    }

    /**
     * Get bundling options for the Lambda function
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getBundling(_properties: WorkshopLambdaFunctionProperties): BundlingOptions {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
        };
    }
}
