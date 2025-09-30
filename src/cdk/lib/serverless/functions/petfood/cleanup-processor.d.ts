import { Construct } from 'constructs';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
export interface PetfoodCleanupProcessorProperties extends WorkshopLambdaFunctionProperties {
    bedrockModelId?: string;
    imageBucket: IBucket;
    eventBridgeBus?: IEventBus;
    petfoodTable: ITable;
}
export declare class PetfoodCleanupProcessorFunction extends WokshopLambdaFunction {
    constructor(scope: Construct, id: string, properties: PetfoodCleanupProcessorProperties);
    addFunctionPermissions(properties: PetfoodCleanupProcessorProperties): void;
    createOutputs(): void;
    getEnvironmentVariables(properties: PetfoodCleanupProcessorProperties): {
        [key: string]: string;
    } | undefined;
    getLayers(): ILayerVersion[];
    getBundling(): BundlingOptions;
}
