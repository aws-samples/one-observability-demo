/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

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
import { CfnOutput, Fn } from 'aws-cdk-lib';
import { AsgCapacityProvider, Cluster, ContainerInsights, EcsOptimizedImage, ICluster } from 'aws-cdk-lib/aws-ecs';
import { InstanceClass, InstanceSize, InstanceType, ISecurityGroup, SecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import { AutoScalingGroup, BlockDeviceVolume, ScalingEvents } from 'aws-cdk-lib/aws-autoscaling';
import { ITopic } from 'aws-cdk-lib/aws-sns';
import { NagSuppressions } from 'cdk-nag';
import {
    ECS_CLUSTER_ARN_EXPORT_NAME,
    ECS_CLUSTER_NAME_EXPORT_NAME,
    ECS_SECURITY_GROUP_ID_EXPORT_NAME,
} from '../../bin/constants';
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
export class WorkshopEcs extends Construct {
    /** The ECS cluster instance */
    public readonly cluster: Cluster;
    /** Auto Scaling Group managing the EC2 capacity */
    public readonly autoScalingGroup: AutoScalingGroup;
    /** Security group for ECS cluster resources */
    public readonly securityGroup: SecurityGroup;
    /** OpenSearch ingestion pipeline for log routing (optional) */
    public readonly openSearchPipeline?: OpenSearchPipeline;

    /**
     * Creates a new WorkshopEcs construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the ECS cluster
     */
    constructor(scope: Construct, id: string, properties: EcsProperties) {
        super(scope, id);

        // Store the pipeline reference for use by ECS services
        this.openSearchPipeline = properties.openSearchPipeline;

        this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
            vpc: properties.vpc,
            description: 'Security group for ECS cluster resources',
            allowAllOutbound: true,
            securityGroupName: `${id}-ecs-security-group`,
        });

        this.cluster = new Cluster(this, 'Cluster', {
            containerInsightsV2: ContainerInsights.ENHANCED,
            vpc: properties.vpc,
            clusterName: `${id}-cluster`,
        });

        this.autoScalingGroup = new AutoScalingGroup(this, 'AutoScalingGroup', {
            vpc: properties.vpc,
            machineImage: EcsOptimizedImage.amazonLinux2023(),
            minCapacity: properties.ecsEc2Capacity || 0,
            maxCapacity: properties.ecsEc2Capacity || 2,
            desiredCapacity: properties.ecsEc2Capacity || 2,
            instanceType: properties.ecsEc2InstanceType
                ? new InstanceType(properties.ecsEc2InstanceType)
                : InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
            blockDevices: [
                {
                    deviceName: '/dev/xvda',
                    volume: BlockDeviceVolume.ebs(30, { encrypted: true }),
                },
            ],
            notifications: [
                {
                    topic: properties.topic,
                    scalingEvents: ScalingEvents.ALL,
                },
            ],
            autoScalingGroupName: `${id}-ecs-asg`,
        });

        this.cluster.addAsgCapacityProvider(
            new AsgCapacityProvider(this, 'AsgCapacityProvider', {
                autoScalingGroup: this.autoScalingGroup,
            }),
        );

        NagSuppressions.addResourceSuppressions(
            this.autoScalingGroup,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Autoscaling group needs access to all ECS tasks',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(this.cluster, [
            {
                id: 'AwsSolutions-ECS4',
                reason: 'Containers insights v2 is enabled, false positive',
            },
        ]);

        this.createExports();
    }

    /**
     * Creates CloudFormation exports for the ECS cluster resources.
     * These exports allow other stacks to reference the cluster.
     */
    private createExports(): void {
        new CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            exportName: ECS_CLUSTER_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'ClusterName', {
            value: this.cluster.clusterName,
            exportName: ECS_CLUSTER_NAME_EXPORT_NAME,
        });

        new CfnOutput(this, 'SecurityGroupId', {
            value: this.securityGroup.securityGroupId,
            exportName: ECS_SECURITY_GROUP_ID_EXPORT_NAME,
        });
    }

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
    public static importFromExports(
        scope: Construct,
        id: string,
        vpc: IVpc,
    ): { cluster: ICluster; securityGroup: ISecurityGroup; openSearchPipeline?: { pipelineEndpoint: string; pipelineArn: string; pipelineRoleArn: string } } {
        const clusterName = Fn.importValue(ECS_CLUSTER_NAME_EXPORT_NAME);
        const securityGroupId = Fn.importValue(ECS_SECURITY_GROUP_ID_EXPORT_NAME);

        const cluster = Cluster.fromClusterAttributes(scope, `${id}-Cluster`, {
            clusterName: clusterName,
            vpc: vpc,
        });

        const securityGroup = SecurityGroup.fromSecurityGroupId(scope, `${id}-SecurityGroup`, securityGroupId);

        // Import OpenSearch pipeline information if available
        // This provides backward compatibility - if pipeline exports don't exist, 
        // the import will gracefully handle the missing values
        let openSearchPipeline: { pipelineEndpoint: string; pipelineArn: string; pipelineRoleArn: string } | undefined;
        
        try {
            const pipelineImports = OpenSearchPipeline.importFromExports();
            openSearchPipeline = {
                pipelineEndpoint: pipelineImports.pipelineEndpoint,
                pipelineArn: pipelineImports.pipelineArn,
                pipelineRoleArn: pipelineImports.pipelineRoleArn,
            };
        } catch (error) {
            // Pipeline exports don't exist - this is fine for backward compatibility
            openSearchPipeline = undefined;
        }

        return { cluster, securityGroup, openSearchPipeline };
    }
}
