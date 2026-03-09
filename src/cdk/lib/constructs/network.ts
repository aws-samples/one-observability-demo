/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * VPC and networking construct for the One Observability Workshop.
 *
 * Creates the foundational network infrastructure with observability built in:
 *
 * - **VPC** with public, private, and isolated subnets across multiple AZs
 * - **VPC Flow Logs** to CloudWatch Logs for network traffic analysis
 * - **Route 53 DNS Query Resolver Logs** for DNS query visibility
 * - **Cloud Map private DNS namespace** for service discovery between microservices
 * - **VPC Endpoints** for private connectivity to AWS services
 *
 * > **Best practice**: VPC Flow Logs and DNS query logs are essential for network
 * > observability. They enable troubleshooting connectivity issues and detecting
 * > anomalous traffic patterns without deploying additional agents.
 *
 * @packageDocumentation
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
import { ENABLE_PET_FOOD_AGENT, MAX_AVAILABILITY_ZONES, AVAILABILITY_ZONES } from '../../bin/environment';
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
    CLOUDMAP_NAMESPACE_ID_EXPORT_NAME,
    CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME,
    CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME,
    VPC_FLOWLOGS_LOGGROUP_NAME,
    R53_QUERY_RESOLVER_LOGGROUP_NAME,
} from '../../bin/constants';
import { PrivateDnsNamespace, IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Utilities } from '../utils/utilities';

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
    /** Cloud Map domain */
    public readonly cloudMapNamespace: PrivateDnsNamespace;
    /** VPC Flow logs group */
    public readonly vpcFlowLogs: FlowLog;
    /** DNS Query Resolver Logs */
    public readonly dnsQueryResolverLogs: CfnResolverQueryLoggingConfig;

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
            maxAzs: ENABLE_PET_FOOD_AGENT ? undefined : MAX_AVAILABILITY_ZONES,
            availabilityZones: ENABLE_PET_FOOD_AGENT ? AVAILABILITY_ZONES : undefined,
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

        /** Add tags for EKS auto-discovery */
        for (const subnet of this.vpc.publicSubnets) {
            Utilities.TagConstruct(subnet, {
                'kubernetes.io/role/elb': '1',
            });
        }
        for (const subnet of this.vpc.privateSubnets) {
            Utilities.TagConstruct(subnet, {
                'kubernetes.io/role/internal-elb': '1',
            });
        }

        if (properties.enableFlowLogs) {
            this.vpcFlowLogs = this.enableFlowLogs(properties.logRetentionDays || RetentionDays.ONE_WEEK);
        }

        if (properties.enableDnsQueryResolverLogs) {
            this.dnsQueryResolverLogs = this.enableDnsQueryResolverLogs(
                properties.logRetentionDays || RetentionDays.ONE_WEEK,
            );
        }

        // Create VPC endpoints
        this.vpcEndpoints = new VpcEndpoints(this, 'VpcEndpoints', {
            vpc: this.vpc,
        });

        // Create Cloudmap namespace
        this.cloudMapNamespace = new PrivateDnsNamespace(this, 'CloudMapNamespace', {
            name: `${properties.name}-space`,
            description: 'Cloud Map namespace for ' + properties.name,
            vpc: this.vpc,
        });

        // Create CloudFormation outputs for VPC resources
        this.createVpcOutputs();
        this.createCloudMapOutputs();
    }

    /**
     * Enables DNS query resolver logs for the VPC
     * @param retention - Log retention period
     */
    private enableDnsQueryResolverLogs(retention: RetentionDays) {
        const resolverLogGroup = new LogGroup(this, 'ResolverLogGroup', {
            retention: retention,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const cfnResolverQueryConfig = new CfnResolverQueryLoggingConfig(this, 'ResolverQueryLogConfig', {
            destinationArn: resolverLogGroup.logGroupArn,
            name: 'ResolverQueryLogConfig',
        });

        const cfnResolverAssociation = new CfnResolverQueryLoggingConfigAssociation(
            this,
            'ResolverQueryLogConfigAssociation',
            {
                resolverQueryLogConfigId: cfnResolverQueryConfig.ref,
                resourceId: this.vpc.vpcId,
            },
        );
        cfnResolverAssociation.node.addDependency(resolverLogGroup);
        cfnResolverAssociation.node.addDependency(this.vpc);

        return cfnResolverQueryConfig;
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

        return new FlowLog(this, 'VPCFlowLog', {
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
        new CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            exportName: VPC_ID_EXPORT_NAME,
            description: 'VPC ID for the workshop network',
        });
        new CfnOutput(this, 'VpcCidr', {
            value: this.vpc.vpcCidrBlock,
            exportName: VPC_CIDR_EXPORT_NAME,
            description: 'CIDR block of the workshop VPC',
        });
        new CfnOutput(this, 'VpcPrivateSubnets', {
            value: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_PRIVATE_SUBNETS_EXPORT_NAME,
            description: 'Comma-separated list of private subnet IDs with NAT gateway access',
        });
        new CfnOutput(this, 'VpcPublicSubnets', {
            value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_PUBLIC_SUBNETS_EXPORT_NAME,
            description: 'Comma-separated list of public subnet IDs with internet gateway access',
        });
        new CfnOutput(this, 'VpcIsolatedSubnets', {
            value: this.vpc.isolatedSubnets.map((s) => s.subnetId).join(','),
            exportName: VPC_ISOLATED_SUBNETS_EXPORT_NAME,
            description: 'Comma-separated list of isolated subnet IDs without internet access',
        });
        new CfnOutput(this, 'VpcAvailabilityZones', {
            value: this.vpc.availabilityZones.join(','),
            exportName: VPC_AVAILABILITY_ZONES_EXPORT_NAME,
            description: 'Comma-separated list of availability zones used by the VPC',
        });
        new CfnOutput(this, 'VpcPrivateSubnetCidrs', {
            value: this.vpc.privateSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME,
            description: 'Comma-separated list of CIDR blocks for private subnets',
        });
        new CfnOutput(this, 'VpcPublicSubnetCidrs', {
            value: this.vpc.publicSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME,
            description: 'Comma-separated list of CIDR blocks for public subnets',
        });
        new CfnOutput(this, 'VpcIsolatedSubnetCidrs', {
            value: this.vpc.isolatedSubnets.map((s) => s.ipv4CidrBlock).join(','),
            exportName: VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME,
            description: 'Comma-separated list of CIDR blocks for isolated subnets',
        });
        new CfnOutput(this, 'VpcFlowLogsLogGroupName', {
            value: this.vpcFlowLogs && this.vpcFlowLogs.logGroup ? this.vpcFlowLogs.logGroup.logGroupName : '',
            exportName: VPC_FLOWLOGS_LOGGROUP_NAME,
            description: 'VPC Flow logs Log Group name',
        });
        new CfnOutput(this, 'R53QueryResolverLogGroupName', {
            value:
                this.dnsQueryResolverLogs && this.dnsQueryResolverLogs.destinationArn
                    ? this.dnsQueryResolverLogs.destinationArn
                    : '',
            exportName: R53_QUERY_RESOLVER_LOGGROUP_NAME,
            description: 'R53 Query Resolver Group name',
        });
    }

    /**
     * Creates CloudFormation outputs for CloudMap namespace resources
     */
    private createCloudMapOutputs() {
        new CfnOutput(this, 'CloudMapNamespaceId', {
            value: this.cloudMapNamespace.namespaceId,
            exportName: CLOUDMAP_NAMESPACE_ID_EXPORT_NAME,
            description: 'Cloud Map namespace ID for service discovery',
        });

        new CfnOutput(this, 'CloudMapNamespaceName', {
            value: this.cloudMapNamespace.namespaceName,
            exportName: CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME,
            description: 'Cloud Map namespace name for service discovery',
        });

        new CfnOutput(this, 'CloudMapNamespaceArn', {
            value: this.cloudMapNamespace.namespaceArn,
            exportName: CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME,
            description: 'Cloud Map namespace ARN for service discovery',
        });
    }

    /**
     * Imports a CloudMap namespace from CloudFormation exports
     * @param scope - The construct scope
     * @param id - The construct identifier
     * @returns The imported CloudMap namespace
     */
    public static importCloudMapNamespaceFromExports(scope: Construct, id: string): IPrivateDnsNamespace {
        const namespaceId = Fn.importValue(CLOUDMAP_NAMESPACE_ID_EXPORT_NAME);
        const namespaceName = Fn.importValue(CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME);
        const namespaceArn = Fn.importValue(CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME);

        return PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(scope, id, {
            namespaceId: namespaceId,
            namespaceName: namespaceName,
            namespaceArn: namespaceArn,
        });
    }
}
