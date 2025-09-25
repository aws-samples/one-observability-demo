/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    ISecurityGroup,
    IVpc,
    Peer,
    Port,
    SecurityGroup,
} from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
    AuroraPostgresEngineVersion,
    ClusterInstance,
    DatabaseCluster,
    DatabaseClusterEngine,
    DatabaseInsightsMode,
    IDatabaseCluster,
    ParameterGroup,
    PerformanceInsightRetention,
} from 'aws-cdk-lib/aws-rds';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import {
    AURORA_CLUSTER_ARN_EXPORT_NAME,
    AURORA_CLUSTER_ENDPOINT_EXPORT_NAME,
    AURORA_SECURITY_GROUP_ID_EXPORT_NAME,
    AURORA_ADMIN_SECRET_ARN_EXPORT_NAME,
    SSM_PARAMETER_NAMES,
} from '../../bin/constants';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

const databaseName = 'adoptions';

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

        this.databaseSecurityGroup = new SecurityGroup(this, 'dbSecurityGroup', {
            vpc: properties.vpc,
            description: 'Aurora Postgres Cluster Security Group',
        });

        /** Add ingress rules to Security Group for private Subnets */
        for (const subnet of properties.vpc.privateSubnets) {
            this.databaseSecurityGroup.addIngressRule(Peer.ipv4(subnet.ipv4CidrBlock), Port.POSTGRES);
        }

        this.cluster = new DatabaseCluster(this, 'Database', {
            engine: DatabaseClusterEngine.auroraPostgres({
                version: properties.engineVersion || AuroraPostgresEngineVersion.VER_16_8,
            }),
            parameterGroup:
                properties.parameterGroup ||
                ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql16'),
            vpc: properties.vpc,
            securityGroups: [this.databaseSecurityGroup],
            defaultDatabaseName: databaseName,
            databaseInsightsMode: DatabaseInsightsMode.ADVANCED,
            performanceInsightRetention: PerformanceInsightRetention.MONTHS_15,
            writer: ClusterInstance.provisioned('writer', {
                autoMinorVersionUpgrade: true,
                instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
            }),
            readers: [
                ClusterInstance.provisioned('reader1', {
                    promotionTier: 1,
                    instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
                    autoMinorVersionUpgrade: true,
                }),
            ],
            serverlessV2MaxCapacity: 1,
            serverlessV2MinCapacity: 0.5,
            iamAuthentication: true,
            cloudwatchLogsExports: ['postgresql'],
            cloudwatchLogsRetention: properties.defaultRetentionDays || RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
            vpcSubnets: {
                subnetGroupName: 'Isolated',
            },
            storageEncrypted: true,
            backup: {
                retention: Duration.days(1), // To minimize cost
            },
        });

        NagSuppressions.addResourceSuppressions(this.cluster, [
            {
                id: 'AwsSolutions-RDS10',
                reason: 'Demo purposes only',
            },
        ]);

        NagSuppressions.addResourceSuppressions(
            this.cluster,
            [
                {
                    id: 'AwsSolutions-SMG4',
                    reason: 'Demo purposes only',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Log Retention lambda using managed policies is acceptable',
                },
            ],
            true,
        );

        this.createExports();
        this.createOutputs();
    }

    private createExports(): void {
        new CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            exportName: AURORA_CLUSTER_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'ClusterEndpoint', {
            value: this.cluster.clusterEndpoint.hostname,
            exportName: AURORA_CLUSTER_ENDPOINT_EXPORT_NAME,
        });

        new CfnOutput(this, 'SecurityGroupId', {
            value: this.databaseSecurityGroup.securityGroupId,
            exportName: AURORA_SECURITY_GROUP_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'AdminSecretArn', {
            value: this.cluster.secret!.secretArn,
            exportName: AURORA_ADMIN_SECRET_ARN_EXPORT_NAME,
        });
    }

    public static importFromExports(
        scope: Construct,
        id: string,
    ): { cluster: IDatabaseCluster; securityGroup: ISecurityGroup; adminSecret: ISecret } {
        const clusterArn = Fn.importValue(AURORA_CLUSTER_ARN_EXPORT_NAME);
        const clusterEndpoint = Fn.importValue(AURORA_CLUSTER_ENDPOINT_EXPORT_NAME);
        const securityGroupId = Fn.importValue(AURORA_SECURITY_GROUP_ID_EXPORT_NAME);
        const adminSecretArn = Fn.importValue(AURORA_ADMIN_SECRET_ARN_EXPORT_NAME);

        const cluster = DatabaseCluster.fromDatabaseClusterAttributes(scope, `${id}-Cluster`, {
            clusterIdentifier: clusterArn.split(':')[6],
            clusterEndpointAddress: clusterEndpoint,
        });

        const securityGroup = SecurityGroup.fromSecurityGroupId(scope, `${id}-SecurityGroup`, securityGroupId);

        const adminSecret = Secret.fromSecretCompleteArn(scope, `${id}-AdminSecret`, adminSecretArn);

        return { cluster, securityGroup, adminSecret };
    }

    createOutputs(): void {
        if (this.cluster.secret) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.RDS_SECRET_ARN_NAME]: this.cluster.secret?.secretArn,
                        [SSM_PARAMETER_NAMES.RDS_READER_ENDPOINT_NAME]: this.cluster.clusterReadEndpoint.hostname,
                        [SSM_PARAMETER_NAMES.RDS_WRITER_ENDPOINT_NAME]: this.cluster.clusterEndpoint.hostname,
                        [SSM_PARAMETER_NAMES.RDS_DATABASE_NAME]: databaseName,
                    }),
                ),
            );
        } else {
            throw new Error('Cluster secret is not available');
        }
    }
}
