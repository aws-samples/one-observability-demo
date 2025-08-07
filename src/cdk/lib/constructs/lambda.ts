/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Runtime, Function, ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { STATUS_UPDATER_FUNCTION } from '../../bin/environment';

export interface WorkshopLambdaFunctionProperties {
    name: string;
    runtime: Runtime;
    depsLockFilePath?: string;
    entry: string;
    memorySize: number;
    handle: string;
    logRetentionDays?: RetentionDays;
    description?: string;
}

export const LambdaFunctionNames = {
    StatusUpdater: STATUS_UPDATER_FUNCTION.name,
} as const;

export abstract class WokshopLambdaFunction extends Construct {
    public function: Function;
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties) {
        super(scope, id);

        if (properties.runtime.name.startsWith('nodejs')) {
            /** NodeJS Lambda function */
            this.function = new NodejsFunction(this, `${properties.name}-function`, {
                runtime: properties.runtime,
                depsLockFilePath: properties.depsLockFilePath,
                entry: properties.entry,
                handler: properties.handle,
                memorySize: properties.memorySize,
                logRetention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
                layers: this.getLayers(properties),
                environment: this.getEnvironmentVariables(properties),
                bundling: this.getBundling(properties),
            });
        } else {
            throw new Error(`Runtime ${properties.runtime.name} not supported`);
        }

        this.addFunctionPermissions(properties);
        this.createOutputs(properties);
    }
    abstract addFunctionPermissions(properties: WorkshopLambdaFunctionProperties): void;

    abstract createOutputs(properties: WorkshopLambdaFunctionProperties): void;

    abstract getEnvironmentVariables(
        properties: WorkshopLambdaFunctionProperties,
    ): { [key: string]: string } | undefined;

    abstract getLayers(properties: WorkshopLambdaFunctionProperties): ILayerVersion[];

    abstract getBundling(properties: WorkshopLambdaFunctionProperties): BundlingOptions;
}
