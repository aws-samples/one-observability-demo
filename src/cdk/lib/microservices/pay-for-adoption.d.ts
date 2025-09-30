import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { Construct } from 'constructs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
export interface PayForAdoptionServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
    table: ITable;
}
export declare class PayForAdoptionService extends EcsService {
    constructor(scope: Construct, id: string, properties: PayForAdoptionServiceProperties);
    addPermissions(properties: PayForAdoptionServiceProperties): void;
    createOutputs(properties: PayForAdoptionServiceProperties): void;
}
