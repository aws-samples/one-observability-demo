/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { RemovalPolicy } from 'aws-cdk-lib';
import { IVpc, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
    AuroraPostgresEngineVersion,
    ClusterInstance,
    DatabaseCluster,
    DatabaseClusterEngine,
    DatabaseInsightsMode,
    ParameterGroup,
    PerformanceInsightRetention,
} from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

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
export class AuroraDatabase extends Construct {
    /** The Aurora PostgreSQL database cluster */
    public cluster: DatabaseCluster;
    /** Security group for database access */
    public databaseSecurityGroup: SecurityGroup;

    /**
     * Creates a new AuroraDatabase construct with serverless v2 configuration
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the database cluster
     */
    constructor(scope: Construct, id: string, properties: AuroraDBProperties) {
        super(scope, id);

        if (!properties.vpc) {
            throw new Error('VPC is required for Aurora PostgreSQL cluster');
        }

        const databaseSecurityGroup = new SecurityGroup(this, 'dbSecurityGroup', {
            vpc: properties.vpc,
            description: 'Aurora Postgres Cluster Security Group',
        });

        /** Add ingress rules to Security Group for private Subnets */
        for (const subnet of properties.vpc.privateSubnets) {
            databaseSecurityGroup.addIngressRule(Peer.ipv4(subnet.ipv4CidrBlock), Port.POSTGRES);
        }

        this.cluster = new DatabaseCluster(this, 'Database', {
            engine: DatabaseClusterEngine.auroraPostgres({
                version: properties.engineVersion || AuroraPostgresEngineVersion.VER_13_20,
            }),
            parameterGroup:
                properties.parameterGroup ||
                ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql13'),
            vpc: properties.vpc,
            securityGroups: [databaseSecurityGroup],
            defaultDatabaseName: 'adoptions',
            databaseInsightsMode: DatabaseInsightsMode.ADVANCED,
            performanceInsightRetention: PerformanceInsightRetention.MONTHS_15,
            writer: ClusterInstance.serverlessV2('writer', {
                autoMinorVersionUpgrade: true,
            }),
            readers: [],
            serverlessV2MaxCapacity: 1,
            serverlessV2MinCapacity: 0.5,
            iamAuthentication: true,
            cloudwatchLogsExports: ['postgresql'],
            cloudwatchLogsRetention: properties.defaultRetentionDays || RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
            vpcSubnets: {
                subnetGroupName: 'Isolated',
            },
        });
    }
}
