import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../../../constructs/lambda';
import { Construct } from 'constructs';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { IVpcEndpoint } from 'aws-cdk-lib/aws-ec2';
export interface StatusUpdaterServiceProperties extends WorkshopLambdaFunctionProperties {
    table: ITable;
    vpcEndpoint?: IVpcEndpoint;
}
export declare class StatusUpdatedService extends WokshopLambdaFunction {
    api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: StatusUpdaterServiceProperties);
    addFunctionPermissions(properties: StatusUpdaterServiceProperties): void;
    createOutputs(): void;
    getEnvironmentVariables(properties: StatusUpdaterServiceProperties): {
        [key: string]: string;
    } | undefined;
    getLayers(): ILayerVersion[];
    getBundling(): BundlingOptions;
}
