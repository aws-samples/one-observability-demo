/**
 * Amazon ECS cluster construct for the One Observability Workshop.
 *
 * This module provides a CDK construct for creating and managing an Amazon ECS cluster
 * with EC2 capacity providers, auto scaling groups, and enhanced container insights.
 * The cluster is configured for optimal observability and monitoring capabilities.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import { Cluster, ICluster } from 'aws-cdk-lib/aws-ecs';
import { ISecurityGroup, SecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { ITopic } from 'aws-cdk-lib/aws-sns';
import { OpenSearchPipeline } from './opensearch-pipeline';
/**
 * Properties for configuring the ECS cluster construct.
 */
export interface EcsProperties {
    /** VPC where the ECS cluster will be deployed */
    vpc: IVpc;
    /** SNS topic for auto scaling notifications */
    topic: ITopic;
    /** Number of EC2 instances for the ECS cluster capacity */
    ecsEc2Capacity?: number;
    /** EC2 instance type for the ECS cluster nodes */
    ecsEc2InstanceType?: string;
    /** OpenSearch ingestion pipeline for log routing */
    openSearchPipeline?: OpenSearchPipeline;
}
/**
 * A CDK construct that creates an Amazon ECS cluster with EC2 capacity.
 *
 * This construct sets up:
 * - ECS cluster with enhanced container insights
 * - Auto Scaling Group with ECS-optimized AMI
 * - Security group for cluster resources
 * - Capacity provider for efficient resource management
 * - CloudFormation exports for cross-stack references
 *
 * The cluster is configured with best practices for security, monitoring,
 * and cost optimization.
 */
export declare class WorkshopEcs extends Construct {
    /** The ECS cluster instance */
    readonly cluster: Cluster;
    /** Auto Scaling Group managing the EC2 capacity */
    readonly autoScalingGroup: AutoScalingGroup;
    /** Security group for ECS cluster resources */
    readonly securityGroup: SecurityGroup;
    /** OpenSearch ingestion pipeline for log routing (optional) */
    readonly openSearchPipeline?: OpenSearchPipeline;
    /**
     * Creates a new WorkshopEcs construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the ECS cluster
     */
    constructor(scope: Construct, id: string, properties: EcsProperties);
    /**
     * Creates CloudFormation exports for the ECS cluster resources.
     * These exports allow other stacks to reference the cluster.
     */
    private createExports;
    /**
     * Imports an ECS cluster from CloudFormation exports.
     *
     * This static method allows other stacks to reference an ECS cluster
     * that was created by this construct and exported via CloudFormation.
     *
     * @param scope - The construct scope where the cluster will be imported
     * @param id - The construct identifier for the imported resources
     * @param vpc - The VPC where the cluster is deployed
     * @returns Object containing the imported cluster, security group, and optional pipeline
     */
    static importFromExports(scope: Construct, id: string, vpc: IVpc): {
        cluster: ICluster;
        securityGroup: ISecurityGroup;
        openSearchPipeline?: {
            pipelineEndpoint: string;
            pipelineArn: string;
            pipelineRoleArn: string;
        };
    };
}
