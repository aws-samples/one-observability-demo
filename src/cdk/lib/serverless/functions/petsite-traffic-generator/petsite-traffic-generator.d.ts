import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
export declare class PetsiteTrafficGeneratorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties);
    addFunctionPermissions(properties: WorkshopLambdaFunctionProperties): void;
    createOutputs(): void;
    getEnvironmentVariables(properties: WorkshopLambdaFunctionProperties): {
        [key: string]: string;
    } | undefined;
    getBundling(): BundlingOptions;
    getLayers(): ILayerVersion[];
}
