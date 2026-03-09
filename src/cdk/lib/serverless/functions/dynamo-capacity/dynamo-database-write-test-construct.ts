/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * DynamoDB Write Test Lambda function construct.
 *
 * Generates configurable write load against DynamoDB tables for testing
 * capacity planning, auto-scaling behavior, and CloudWatch contributor insights.
 *
 * @packageDocumentation
 */
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getLambdaInsightsLayerArn,
} from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack } from 'aws-cdk-lib';

/**
 * CDK Construct for DynamoDB Write Capacity Test Lambda Function
 *
 * This construct creates a Lambda function that tests DynamoDB write capacity
 * by writing configurable-sized items and measuring consumed WCUs.
 *
 * Note: DynamoDB permissions are intentionally NOT included in this construct.
 * They should be added separately for workshop/troubleshooting scenarios.
 */
export class DynamoDBWriteTestConstruct extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties) {
        super(scope, id, properties);
        this.createOutputs();
    }

    addFunctionPermissions(): void {
        // Intentionally empty - DynamoDB permissions should be added manually
        // for workshop troubleshooting scenarios
    }

    createOutputs(): void {
        // No specific outputs needed
    }

    getEnvironmentVariables(): { [key: string]: string } | undefined {
        return undefined;
    }

    getBundling(): BundlingOptions {
        // Python function - no bundling needed
        return {
            externalModules: [],
        };
    }

    getLayers(): ILayerVersion[] {
        return [
            LayerVersion.fromLayerVersionArn(
                this,
                'LambdaInsightsLayer',
                getLambdaInsightsLayerArn(Stack.of(this).region),
            ),
        ];
    }
}
