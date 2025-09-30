import { ISecurityGroup, IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AuroraPostgresEngineVersion, DatabaseCluster, IDatabaseCluster, ParameterGroup } from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
/**
 * Properties for configuring Aurora PostgreSQL database cluster
 * @interface AuroraDBProperties
 */
export interface AuroraDBProperties {
    /** RDS username for database authentication */
    rdsUsername?: string;
    /** VPC where the database cluster will be deployed */
    vpc?: IVpc;
    /** Aurora PostgreSQL engine version */
    engineVersion?: AuroraPostgresEngineVersion;
    /** Parameter group for database configuration */
    parameterGroup?: ParameterGroup;
    /** Default retention period for CloudWatch logs */
    defaultRetentionDays?: RetentionDays;
}
/**
 * AWS CDK Construct that creates Aurora PostgreSQL database cluster with security group
 * @class AuroraDatabase
 * @extends Construct
 */
export declare class AuroraDatabase extends Construct {
    /** The Aurora PostgreSQL database cluster */
    cluster: DatabaseCluster;
    /** Security group for database access */
    databaseSecurityGroup: SecurityGroup;
    /**
     * Creates a new AuroraDatabase construct with serverless v2 configuration
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the database cluster
     */
    constructor(scope: Construct, id: string, properties: AuroraDBProperties);
    private createExports;
    static importFromExports(scope: Construct, id: string): {
        cluster: IDatabaseCluster;
        securityGroup: ISecurityGroup;
        adminSecret: ISecret;
    };
    createOutputs(): void;
}
