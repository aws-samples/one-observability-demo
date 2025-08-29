/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ManagedPolicy, PolicyDocument, Effect, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Arn, ArnFormat, Stack } from 'aws-cdk-lib';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';
import { Canary } from 'aws-cdk-lib/aws-synthetics';

export interface TrafficGeneratorFunctionProperties extends WorkshopLambdaFunctionProperties {
    trafficCanary: Canary;
}

export class TrafficGeneratorFunction extends WokshopLambdaFunction {
    public api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: TrafficGeneratorFunctionProperties) {
        properties = { ...properties, description: 'Traffic Generator Trigger' };

        super(scope, id, properties);

        this.createOutputs();
    }
    addFunctionPermissions(properties: TrafficGeneratorFunctionProperties): void {
        if (this.function) {
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'),
            );
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            );

            new Policy(this, 'TrafficGeneratorPolicy', {
                policyName: 'TrafficGeneratorPolicy',
                document: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['lambda:InvokeFunction'],
                            resources: [this.getCanaryFunctionArn(properties.trafficCanary)],
                        }),
                    ],
                }),
                roles: [this.function.role!],
            });

            NagSuppressions.addResourceSuppressions(
                this.function.role!,
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
    }
    createOutputs(): void {}
    getEnvironmentVariables(properties: TrafficGeneratorFunctionProperties): { [key: string]: string } | undefined {
        // No environment variables to create
        return {
            FUNCTION_ARN: this.getCanaryFunctionArn(properties.trafficCanary),
        };
    }

    getCanaryFunctionArn(canary: Canary) {
        return Arn.format(
            {
                service: 'lambda',
                resource: 'function',
                arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                resourceName: canary.canaryName,
            },
            Stack.of(this),
        );
    }

    getBundling(): BundlingOptions {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-lambda'],
        };
    }

    getLayers(): ILayerVersion[] {
        const layerArn = Arn.format({
            account: '580247275435',
            resource: 'layer',
            resourceName: 'LambdaInsightsExtension:56',
            region: Stack.of(this).region,
            service: 'lambda',
            partition: 'aws',
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });

        return [LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', layerArn)];
    }
}
