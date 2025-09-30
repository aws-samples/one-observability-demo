import { Construct } from 'constructs';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
export interface RdsSeederProperties extends WorkshopLambdaFunctionProperties {
    databaseSecret: ISecret;
    secretParameterName: string;
}
export declare class RdsSeederFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: RdsSeederProperties);
    addFunctionPermissions(properties: RdsSeederProperties): void;
    createOutputs(): void;
    getEnvironmentVariables(properties: RdsSeederProperties): {
        [key: string]: string;
    } | undefined;
    getLayers(): ILayerVersion[];
    getBundling(): BundlingOptions;
}
