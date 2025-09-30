import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
export interface PetFoodProperties extends EcsServiceProperties {
    petFoodTable: ITable;
    petFoodCartTable: ITable;
    assetsBucket: IBucket;
}
export declare class PetFoodECSService extends EcsService {
    constructor(scope: Construct, id: string, properties: PetFoodProperties);
    addPermissions(properties: PetFoodProperties): void;
    createOutputs(properties: PetFoodProperties): void;
}
