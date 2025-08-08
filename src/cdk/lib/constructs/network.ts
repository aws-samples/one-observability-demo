/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import {
    Vpc,
    IpAddresses,
    FlowLog,
    FlowLogDestination,
    FlowLogResourceType,
    LogFormat,
    SubnetType,
    IVpc,
} from 'aws-cdk-lib/aws-ec2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
    CfnResolverQueryLoggingConfig,
    CfnResolverQueryLoggingConfigAssociation,
} from 'aws-cdk-lib/aws-route53resolver';
import { CfnOutput, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { VpcEndpoints } from './vpc-endpoints';
import { MAX_AVAILABILITY_ZONES } from '../../bin/environment';
import {
    VPC_AVAILABILITY_ZONES_EXPORT_NAME,
    VPC_CIDR_EXPORT_NAME,
    VPC_ID_EXPORT_NAME,
    VPC_ISOLATED_SUBNETS_EXPORT_NAME,
    VPC_PRIVATE_SUBNETS_EXPORT_NAME,
    VPC_PUBLIC_SUBNETS_EXPORT_NAME,
    VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME,
    VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME,
    VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME,
} from '../../bin/constants';

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
    /** The VPC endpoints created by this construct */
    public readonly vpcEndpoints: VpcEndpoints;

    /**
     * Creates a new WorkshopNetwork construct
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the network
     */
    constructor(scope: Construct, id: string, properties: WorkshopNetworkProperties) {
        super(scope, id);

        // Create a VPC with public and private subnets
        // The VPC where all the microservices will be deployed into
        this.vpc = new Vpc(this, 'VPC-' + properties.name, {
            ipAddresses: IpAddresses.cidr(properties.cidrRange),
            natGateways: 1,
            maxAzs: MAX_AVAILABILITY_ZONES,
            subnetConfiguration: [
                {
                    name: 'Public',
                    cidrMask: 24,
                    subnetType: SubnetType.PUBLIC,
                    mapPublicIpOnLaunch: false,
                },
                {
                    name: 'Private',
                    cidrMask: 24,
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    name: 'Isolated',
                    cidrMask: 28,
                    subnetType: SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });

        if (properties.enableFlowLogs) {
            this.enableFlowLogs(properties.logRetentionDays || RetentionDays.ONE_WEEK);
        }

        if (properties.enableDnsQueryResolverLogs) {
            this.enableDnsQueryResolverLogs(properties.logRetentionDays || RetentionDays.ONE_WEEK);
        }

        // Create VPC endpoints
        this.vpcEndpoints = new VpcEndpoints(this, 'VpcEndpoints', {
            vpc: this.vpc,
        });

        // Create CloudFormation outputs for VPC resources
        this.createVpcOutputs();
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
            removalPolicy: RemovalPolicy.DESTROY,
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

    /**
     * Imports a VPC from CloudFormation exports created by WorkshopNetwork
     *
     * This static method reconstructs a VPC instance from CloudFormation exports,
     * allowing other stacks to reference and use the VPC created by the core infrastructure.
     *
     * @param scope - The construct scope where the VPC will be imported
     * @param id - The construct identifier for the imported VPC
     * @returns The imported VPC instance with all subnet and availability zone information
     *
     * @example
     * ```typescript
     * const vpc = WorkshopNetwork.importVpcFromExports(this, 'ImportedVpc');
     * // Use vpc.privateSubnets, vpc.publicSubnets, etc.
     * ```
     */
    public static importVpcFromExports(scope: Construct, id: string): IVpc {
        const vpcId = Fn.importValue(VPC_ID_EXPORT_NAME);
        const availabilityZones = Fn.importListValue(VPC_AVAILABILITY_ZONES_EXPORT_NAME, MAX_AVAILABILITY_ZONES, ',');

        const publicSubnetIds = Fn.importListValue(VPC_PUBLIC_SUBNETS_EXPORT_NAME, MAX_AVAILABILITY_ZONES, ',');
        const privateSubnetIds = Fn.importListValue(VPC_PRIVATE_SUBNETS_EXPORT_NAME, MAX_AVAILABILITY_ZONES, ',');
        const isolatedSubnetIds = Fn.importListValue(VPC_ISOLATED_SUBNETS_EXPORT_NAME, MAX_AVAILABILITY_ZONES, ',');

        const publicSubnetCidrs = Fn.importListValue(VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME, MAX_AVAILABILITY_ZONES, ',');
        const privateSubnetCidrs = Fn.importListValue(
            VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME,
            MAX_AVAILABILITY_ZONES,
            ',',
        );
        const isolatedSubnetCidrs = Fn.importListValue(
            VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME,
            MAX_AVAILABILITY_ZONES,
            ',',
        );

        const vpcCidrBlock = Fn.importValue(VPC_CIDR_EXPORT_NAME);

        return Vpc.fromVpcAttributes(scope, id, {
            vpcId: vpcId,
            availabilityZones: availabilityZones,
            privateSubnetIds: privateSubnetIds,
            publicSubnetIds: publicSubnetIds,
            isolatedSubnetIds: isolatedSubnetIds,
            privateSubnetIpv4CidrBlocks: privateSubnetCidrs,
            publicSubnetIpv4CidrBlocks: publicSubnetCidrs,
            isolatedSubnetIpv4CidrBlocks: isolatedSubnetCidrs,
            vpcCidrBlock: vpcCidrBlock,
        });
    }

    /**
     * Creates CloudFormation outputs for VPC resources
     */
    private createVpcOutputs() {
        new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: VPC_ID_EXPORT_NAME });
        new CfnOutput(this, 'VpcCidr', { value: this.vpc.vpcCidrBlock, exportName: VPC_CIDR_EXPORT_NAME });
        new CfnOutput(this, 'VpcPrivateSubnets', {
            value: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_PRIVATE_SUBNETS_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcPublicSubnets', {
            value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_PUBLIC_SUBNETS_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcIsolatedSubnets', {
            value: this.vpc.isolatedSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_ISOLATED_SUBNETS_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcAvailabilityZones', {
            value: this.vpc.availabilityZones.join(','),
            exportName: VPC_AVAILABILITY_ZONES_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcPrivateSubnetCidrs', {
            value: this.vpc.privateSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcPublicSubnetCidrs', {
            value: this.vpc.publicSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME,
        });
        new CfnOutput(this, 'VpcIsolatedSubnetCidrs', {
            value: this.vpc.isolatedSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME,
        });
    }
}
