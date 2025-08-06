/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
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
} from '../../bin/environment';

export interface EcsProperties {
    vpc: IVpc;
    topic: ITopic;
    ecsEc2Capacity?: number;
    ecsEc2InstanceType?: string;
}

export class WorkshopEcs extends Construct {
    public readonly cluster: Cluster;
    public readonly autoScalingGroup: AutoScalingGroup;
    public readonly securityGroup: SecurityGroup;

    constructor(scope: Construct, id: string, properties: EcsProperties) {
        super(scope, id);

        this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
            vpc: properties.vpc,
            description: 'Security group for ECS cluster resources',
            allowAllOutbound: true,
        });

        this.cluster = new Cluster(this, 'Cluster', {
            containerInsightsV2: ContainerInsights.ENHANCED,
            vpc: properties.vpc,
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

    public static importFromExports(
        scope: Construct,
        id: string,
        vpc: IVpc,
    ): { cluster: ICluster; securityGroup: ISecurityGroup } {
        const clusterName = Fn.importValue(ECS_CLUSTER_NAME_EXPORT_NAME);
        const securityGroupId = Fn.importValue(ECS_SECURITY_GROUP_ID_EXPORT_NAME);

        const cluster = Cluster.fromClusterAttributes(scope, `${id}-Cluster`, {
            clusterName: clusterName,
            vpc: vpc,
        });

        const securityGroup = SecurityGroup.fromSecurityGroupId(scope, `${id}-SecurityGroup`, securityGroupId);

        return { cluster, securityGroup };
    }
}
