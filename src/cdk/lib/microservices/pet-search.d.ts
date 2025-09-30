import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
export interface PetSearchServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
    table: ITable;
    bucket: IBucket;
}
export declare class PetSearchService extends EcsService {
    constructor(scope: Construct, id: string, properties: PetSearchServiceProperties);
    addPermissions(properties: PetSearchServiceProperties): void;
    createOutputs(properties: PetSearchServiceProperties): void;
}
