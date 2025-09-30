import { Construct } from 'constructs';
import { Vpc, IVpc } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { VpcEndpoints } from './vpc-endpoints';
import { PrivateDnsNamespace, IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
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
export declare class WorkshopNetwork extends Construct {
    /** The VPC instance created by this construct */
    readonly vpc: Vpc;
    /** The VPC endpoints created by this construct */
    readonly vpcEndpoints: VpcEndpoints;
    /** Cloud Map domain */
    readonly cloudMapNamespace: PrivateDnsNamespace;
    /**
     * Creates a new WorkshopNetwork construct
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the network
     */
    constructor(scope: Construct, id: string, properties: WorkshopNetworkProperties);
    /**
     * Enables DNS query resolver logs for the VPC
     * @param retention - Log retention period
     */
    private enableDnsQueryResolverLogs;
    /**
     * Enables VPC Flow Logs with comprehensive log format
     * @param retention - Log retention period
     */
    private enableFlowLogs;
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
    static importVpcFromExports(scope: Construct, id: string): IVpc;
    /**
     * Creates CloudFormation outputs for VPC resources
     */
    private createVpcOutputs;
    /**
     * Creates CloudFormation outputs for CloudMap namespace resources
     */
    private createCloudMapOutputs;
    /**
     * Imports a CloudMap namespace from CloudFormation exports
     * @param scope - The construct scope
     * @param id - The construct identifier
     * @returns The imported CloudMap namespace
     */
    static importCloudMapNamespaceFromExports(scope: Construct, id: string): IPrivateDnsNamespace;
}
