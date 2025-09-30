import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AssetsProperties, WorkshopAssets } from '../constructs/assets';
import { DynamoDatabase as DynamoDatabase, DynamoDatabaseProperties } from '../constructs/dynamodb';
import { AuroraDatabase, AuroraDBProperties } from '../constructs/database';
import { CodeBuildStep } from 'aws-cdk-lib/pipelines';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Function } from 'aws-cdk-lib/aws-lambda';
export interface StorageProperties extends StackProps {
    assetsProperties?: AssetsProperties;
    dynamoDatabaseProperties?: DynamoDatabaseProperties;
    auroraDatabaseProperties?: AuroraDBProperties;
    /** Tags to apply to all resources in the stage */
    tags?: {
        [key: string]: string;
    };
}
export declare class StorageStage extends Stage {
    stack: StorageStack;
    constructor(scope: Construct, id: string, properties: StorageProperties);
    getDDBSeedingStep(scope: Stack, artifactBucket: IBucket): CodeBuildStep;
    getRDSSeedingStep(scope: Stack): CodeBuildStep;
}
export declare class StorageStack extends Stack {
    readonly dynamoDatabase: DynamoDatabase;
    readonly auroraDatabase: AuroraDatabase;
    readonly workshopAssets: WorkshopAssets;
    readonly rdsSeederLambda: Function;
    constructor(scope: Construct, id: string, properties: StorageProperties);
    private createRdsSeederSecurityGroup;
}
