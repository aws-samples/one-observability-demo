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
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';
import { Function } from 'aws-cdk-lib/aws-lambda';

export interface TrafficGeneratorFunctionProperties extends WorkshopLambdaFunctionProperties {
    petsiteTrafficFunction: Function;
}

export class TrafficGeneratorFunction extends WokshopLambdaFunction {
    public api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: TrafficGeneratorFunctionProperties) {
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
                            resources: [properties.petsiteTrafficFunction.functionArn],
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
        return {
            PETSITE_TRAFFIC_FUNCTION_ARN: properties.petsiteTrafficFunction.functionArn,
        };
    }

    getBundling(): BundlingOptions {
        return {
            externalModules: [],
            nodeModules: [],
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
