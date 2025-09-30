import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
export interface ListAdoptionsServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
}
export declare class ListAdoptionsService extends EcsService {
    constructor(scope: Construct, id: string, properties: ListAdoptionsServiceProperties);
    addPermissions(properties: ListAdoptionsServiceProperties): void;
    createOutputs(properties: ListAdoptionsServiceProperties): void;
}
