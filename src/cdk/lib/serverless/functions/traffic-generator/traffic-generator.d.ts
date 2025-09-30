import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { Function } from 'aws-cdk-lib/aws-lambda';
export interface TrafficGeneratorFunctionProperties extends WorkshopLambdaFunctionProperties {
    petsiteTrafficFunction: Function;
}
export declare class TrafficGeneratorFunction extends WokshopLambdaFunction {
    api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: TrafficGeneratorFunctionProperties);
    addFunctionPermissions(properties: TrafficGeneratorFunctionProperties): void;
    createOutputs(): void;
    getEnvironmentVariables(properties: TrafficGeneratorFunctionProperties): {
        [key: string]: string;
    } | undefined;
    getBundling(): BundlingOptions;
    getLayers(): ILayerVersion[];
}
