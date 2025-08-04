/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import { Vpc, IpAddresses, FlowLog, FlowLogDestination, FlowLogResourceType, LogFormat } from 'aws-cdk-lib/aws-ec2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
    CfnResolverQueryLoggingConfig,
    CfnResolverQueryLoggingConfigAssociation,
} from 'aws-cdk-lib/aws-route53resolver';

/**
 * Properties for the WorkshopNetwork construct
 */
export interface WorkshopNetworkProperties {
    /** The name identifier for the network resources */
    name: string;
    /** The CIDR range for the VPC (e.g., '10.0.0.0/16') */
    cidrRange: string;
    /** Whether to enable VPC Flow Logs */
    enableFlowLogs?: boolean;
    /** Whether to enable DNS Query Resolver Logs for the VPC*/
    enableDnsQueryResolverLogs?: boolean;
    /** Default Log Retention */
    logRetentionDays?: RetentionDays;
}

/**
 * A CDK construct that creates a VPC with public and private subnets,
 * NAT gateway, and VPC Flow Logs for the observability workshop
 */
export class WorkshopNetwork extends Construct {
    /** The VPC instance created by this construct */
    public readonly vpc: Vpc;

    /**
     * Creates a new WorkshopNetwork construct
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param props - Configuration properties for the network
     */
    constructor(scope: Construct, id: string, properties: WorkshopNetworkProperties) {
        super(scope, id);

        // Create a VPC with public and private subnets
        // The VPC where all the microservices will be deployed into
        this.vpc = new Vpc(this, 'VPC-' + properties.name, {
            ipAddresses: IpAddresses.cidr(properties.cidrRange),
            natGateways: 1,
            maxAzs: 2,
        });

        if (properties.enableFlowLogs) {
            this.enableFlowLogs(properties.logRetentionDays || RetentionDays.ONE_WEEK);
        }

        if (properties.enableDnsQueryResolverLogs) {
            this.enableDnsQueryResolverLogs(properties.logRetentionDays || RetentionDays.ONE_WEEK);
        }
    }

    /**
     * Enables DNS query resolver logs for the VPC
     * @param retention - Log retention period
     */
    private enableDnsQueryResolverLogs(retention: RetentionDays) {
        const resolverLogGroup = new LogGroup(this, 'ResolverLogGroup', {
            logGroupName: '/aws/vpc/dns-query-resolver-logs/' + this.vpc.vpcId,
            retention: retention,
        });

        const cfnResovlerQueryConfig = new CfnResolverQueryLoggingConfig(this, 'ResolverQueryLogConfig', {
            destinationArn: resolverLogGroup.logGroupArn,
            name: 'ResolverQueryLogConfig',
        });

        new CfnResolverQueryLoggingConfigAssociation(this, 'ResolverQueryLogConfigAssociation', {
            resolverQueryLogConfigId: cfnResovlerQueryConfig.ref,
            resourceId: this.vpc.vpcId,
        });
    }

    /**
     * Enables VPC Flow Logs with comprehensive log format
     * @param retention - Log retention period
     */
    private enableFlowLogs(retention: RetentionDays) {
        const flowLogGroup = new LogGroup(this, 'FlowLogGroup', {
            logGroupName: '/aws/vpcflowlogs/' + this.vpc.vpcId,
            retention: retention,
        });

        const role = new Role(this, 'VPCFlowLogRole', {
            assumedBy: new ServicePrincipal('vpc-flow-logs.amazonaws.com'),
        });

        new FlowLog(this, 'VPCFlowLog', {
            destination: FlowLogDestination.toCloudWatchLogs(flowLogGroup, role),
            resourceType: FlowLogResourceType.fromVpc(this.vpc),
            logFormat: [
                LogFormat.ACCOUNT_ID,
                LogFormat.ACTION,
                LogFormat.AZ_ID,
                LogFormat.BYTES,
                LogFormat.DST_ADDR,
                LogFormat.DST_PORT,
                LogFormat.END_TIMESTAMP,
                LogFormat.FLOW_DIRECTION,
                LogFormat.INSTANCE_ID,
                LogFormat.INTERFACE_ID,
                LogFormat.LOG_STATUS,
                LogFormat.PACKETS,
                LogFormat.PKT_DST_AWS_SERVICE,
                LogFormat.PKT_DST_ADDR,
                LogFormat.PKT_SRC_AWS_SERVICE,
                LogFormat.PKT_SRC_ADDR,
                LogFormat.PROTOCOL,
                LogFormat.REGION,
                LogFormat.SRC_ADDR,
                LogFormat.SRC_PORT,
                LogFormat.START_TIMESTAMP,
                LogFormat.SUBLOCATION_ID,
                LogFormat.SUBLOCATION_TYPE,
                LogFormat.SUBNET_ID,
                LogFormat.TCP_FLAGS,
                LogFormat.TRAFFIC_PATH,
                LogFormat.TRAFFIC_TYPE,
                LogFormat.VERSION,
                LogFormat.VPC_ID,
            ],
        });
    }
}
