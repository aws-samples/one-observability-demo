/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../lambda';
import { Construct } from 'constructs';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Arn, Stack } from 'aws-cdk-lib';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { EndpointType, LambdaRestApi, MethodLoggingLevel } from 'aws-cdk-lib/aws-apigateway';

export interface StatusUpdaterServiceProperties extends WorkshopLambdaFunctionProperties {
    table: ITable;
}

export class StatusUpdatedService extends WokshopLambdaFunction {
    public api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: StatusUpdaterServiceProperties) {
        properties = { ...properties, description: 'Update Pet availability status' };

        super(scope, id, properties);

        this.api = new LambdaRestApi(this, `${properties.name}-api`, {
            handler: this.function,
            description: 'Update Pet availability status',
            proxy: true,
            endpointConfiguration: {
                types: [EndpointType.REGIONAL],
            },
            deployOptions: {
                tracingEnabled: true,
                loggingLevel: MethodLoggingLevel.INFO,
                stageName: 'prod',
            },
            defaultMethodOptions: {
                methodResponses: [],
            },
        });
    }
    addFunctionPermissions(properties: StatusUpdaterServiceProperties): void {
        if (this.function) {
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName(
                    'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy',
                ),
            );
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName(
                    'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                ),
            );

            properties.table.grantReadWriteData(this.function);
        }
    }
    createOutputs(): void {
        // No outputs to create
    }
    getEnvironmentVariables(properties: StatusUpdaterServiceProperties): { [key: string]: string } | undefined {
        // No environment variables to create
        return {
            TABLE_NAME: properties.table.tableName,
        };
    }
    getLayers(): ILayerVersion[] {
        const layerArn = Arn.format({
            account: '580247275435',
            resource: 'layer',
            resourceName: 'LambdaInsightsExtension:21',
            region: Stack.of(this).region,
            service: 'lambda',
            partition: 'aws',
        });

        return [LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', layerArn)];
    }
    getBundling(): BundlingOptions {
        return {
            externalModules: [
                'aws-sdk', // Use the 'aws-sdk' available in the Lambda runtime
            ],
            nodeModules: ['aws-xray-sdk'],
        };
    }
}
