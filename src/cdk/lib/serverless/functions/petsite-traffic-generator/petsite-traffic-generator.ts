/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getLambdaInsightsLayerArn,
} from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ManagedPolicy, PolicyDocument, Effect, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Arn, ArnFormat, Stack } from 'aws-cdk-lib';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { NagSuppressions } from 'cdk-nag';

export class PetsiteTrafficGeneratorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties) {
        super(scope, id, properties);

        this.createOutputs();
    }

    addFunctionPermissions(properties: WorkshopLambdaFunctionProperties): void {
        if (this.function) {
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'),
            );
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            );

            new Policy(this, 'PetsiteTrafficGeneratorPolicy', {
                policyName: 'PetsiteTrafficGeneratorPolicy',
                document: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
                            resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/petstore/*`],
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

    getEnvironmentVariables(properties: WorkshopLambdaFunctionProperties): { [key: string]: string } | undefined {
        return {
            PETSITE_URL_PARAMETER_NAME: '/petstore/petsiteurl',
        };
    }

    getBundling(): BundlingOptions {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-ssm', 'puppeteer-core'],
        };
    }

    getLayers(): ILayerVersion[] {
        return [
            LayerVersion.fromLayerVersionArn(
                this,
                'LambdaInsightsLayer',
                getLambdaInsightsLayerArn(Stack.of(this).region),
            ),
            // Chromium layer for Puppeteer
            LayerVersion.fromLayerVersionArn(
                this,
                'ChromiumLayer',
                `arn:aws:lambda:${Stack.of(this).region}:764866452798:layer:chrome-aws-lambda:31`,
            ),
        ];
    }
}
