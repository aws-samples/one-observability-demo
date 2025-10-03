/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import {
    WokshopLambdaFunction,
    WorkshopLambdaFunctionProperties,
    getLambdaInsightsLayerArn,
    getOpenTelemetryPythonLayerArn,
} from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';
import { SSM_PARAMETER_NAMES } from '../../../../bin/constants';
import { Stack } from 'aws-cdk-lib';
import { PARAMETER_STORE_PREFIX } from '../../../../bin/environment';

export class TrafficGeneratorFunction extends WokshopLambdaFunction {
    public api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties) {
        super(scope, id, properties);

        this.createOutputs();
    }
    addFunctionPermissions(): void {
        if (this.function) {
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'),
            );
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            );

            new Policy(this, 'GetParameterPolicy', {
                statements: [
                    new PolicyStatement({
                        resources: [
                            `arn:aws:ssm:${Stack.of(this).region}:${
                                Stack.of(this).account
                            }:parameter${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`,
                        ],
                        actions: ['ssm:GetParameter'],
                    }),
                ],
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
    getEnvironmentVariables(): { [key: string]: string } | undefined {
        // No environment variables to create
        return {
            PETSITE_URL_PARAMETER_NAME: `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`,
        };
    }

    getBundling(): BundlingOptions {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-ssm'],
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
}
