/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import { CfnOutput, Fn, Stack } from 'aws-cdk-lib';
import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    ISecurityGroup,
    SecurityGroup,
    SubnetType,
    IVpc,
} from 'aws-cdk-lib/aws-ec2';
import {
    Cluster,
    ICluster,
    AuthenticationMode,
    KubernetesVersion,
    ClusterLoggingTypes,
    Addon,
    CfnAddon,
    NodegroupAmiType,
    AlbControllerVersion,
    CfnNodegroup,
} from 'aws-cdk-lib/aws-eks';
import { KubectlV33Layer } from '@aws-cdk/lambda-layer-kubectl-v33';
import { ManagedPolicy, Role, ServicePrincipal, OpenIdConnectProvider } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import {
    EKS_CLUSTER_ARN_EXPORT_NAME,
    EKS_CLUSTER_NAME_EXPORT_NAME,
    EKS_SECURITY_GROUP_ID_EXPORT_NAME,
    EKS_KUBECTL_ROLE_ARN_EXPORT_NAME,
    EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME,
    EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME,
    EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME,
} from '../../bin/constants';

export interface EksProperties {
    vpc: IVpc;
    eksEc2Capacity?: number;
    eksEc2InstanceType?: string;
}

export class WorkshopEks extends Construct {
    public readonly cluster: Cluster;

    constructor(scope: Construct, id: string, properties: EksProperties) {
        super(scope, id);

        this.cluster = new Cluster(this, 'Cluster', {
            vpc: properties.vpc,
            authenticationMode: AuthenticationMode.API_AND_CONFIG_MAP,
            version: KubernetesVersion.V1_33,
            kubectlLayer: new KubectlV33Layer(this, 'kubectl'),
            defaultCapacity: properties.eksEc2Capacity || 2,
            defaultCapacityInstance: properties.eksEc2InstanceType
                ? new InstanceType(properties.eksEc2InstanceType)
                : InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
            clusterLogging: [
                ClusterLoggingTypes.API,
                ClusterLoggingTypes.AUDIT,
                ClusterLoggingTypes.AUTHENTICATOR,
                ClusterLoggingTypes.CONTROLLER_MANAGER,
                ClusterLoggingTypes.SCHEDULER,
            ],
            albController: {
                version: AlbControllerVersion.V2_8_2,
            },
            vpcSubnets: [
                {
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                },
            ],
            clusterName: `${id}-cluster`,
        });

        this.setupAddons();
        this.setupSuppressions();
        this.createExports();
    }

    private setupAddons(): void {
        const cfnNodeGroup = this.cluster.defaultNodegroup?.node.defaultChild as CfnNodegroup;
        cfnNodeGroup.addPropertyOverride('AmiType', NodegroupAmiType.AL2023_X86_64_STANDARD);

        new Addon(this, 'coreDNSAddon', {
            cluster: this.cluster,
            addonName: 'coredns',
            preserveOnDelete: false,
        });

        new Addon(this, 'nodeMonitoringAgentAddon', {
            cluster: this.cluster,
            addonName: 'eks-node-monitoring-agent',
            preserveOnDelete: false,
        });

        new Addon(this, 'podIdentityAgentAddon', {
            cluster: this.cluster,
            addonName: 'eks-pod-identity-agent',
            preserveOnDelete: false,
        });

        new Addon(this, 'guardDutyAddon', {
            cluster: this.cluster,
            addonName: 'aws-guardduty-agent',
            preserveOnDelete: false,
        });

        const iamRoleCloudwatchAddon = new Role(this, 'CloudwatchAddonRole', {
            description: 'Allows pods running in Amazon EKS cluster to access AWS resources.',
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
            ],
            assumedBy: new ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
        });

        const cloudwatchAddon = new Addon(this, 'cloudwatchObservabilityAddon', {
            cluster: this.cluster,
            addonName: 'amazon-cloudwatch-observability',
            preserveOnDelete: false,
        });

        const cfnCloudWatchAddon = cloudwatchAddon.node.defaultChild as CfnAddon;
        cfnCloudWatchAddon.addPropertyOverride('PodIdentityAssociations', [
            {
                ServiceAccount: 'cloudwatch-agent',
                RoleArn: iamRoleCloudwatchAddon.roleArn,
            },
        ]);

        const iamRoleNetworkFlowAgent = new Role(this, 'NetworkFlowAgentRole', {
            description: 'Allows pods running in Amazon EKS cluster to access AWS resources.',
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('CloudWatchNetworkFlowMonitorAgentPublishPolicy'),
            ],
            assumedBy: new ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
        });

        const networkFlowAgentAddon = new Addon(this, 'networkFlowMonitoringAgentAddon', {
            cluster: this.cluster,
            addonName: 'aws-network-flow-monitoring-agent',
            preserveOnDelete: false,
        });

        const cfnNetworkFlowAddon = networkFlowAgentAddon.node.defaultChild as CfnAddon;
        cfnNetworkFlowAddon.addPropertyOverride('PodIdentityAssociations', [
            {
                ServiceAccount: 'aws-network-flow-monitor-agent-service-account',
                RoleArn: iamRoleNetworkFlowAgent.roleArn,
            },
        ]);
    }

    private setupSuppressions(): void {
        NagSuppressions.addResourceSuppressions(
            this.cluster,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'CDK EKS automation requires multiple * access',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'EKS Creation Role requires star access',
                },
                {
                    id: 'AwsSolutions-EKS1',
                    reason: 'Public API are needed to manage the cluster from CloudShell in the workshop',
                },
            ],
            true,
        );

        NagSuppressions.addStackSuppressions(
            Stack.of(this),
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'CDK EKS automation requires multiple * access',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'EKS Creation Role requires star access',
                },
                {
                    id: 'AwsSolutions-SF1',
                    reason: 'Step functions are implemented by CDK EKS Construct and out of scope',
                },
                {
                    id: 'AwsSolutions-SF2',
                    reason: 'Step functions are implemented by CDK EKS Construct and out of scope',
                },
                {
                    id: 'AwsSolutions-L1',
                    reason: 'Lambda functions are implemented by CDK EKS Construct and out of scope',
                },
            ],
            true,
        );
    }

    private createExports(): void {
        new CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            exportName: EKS_CLUSTER_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'ClusterName', {
            value: this.cluster.clusterName,
            exportName: EKS_CLUSTER_NAME_EXPORT_NAME,
        });

        new CfnOutput(this, 'SecurityGroupId', {
            value: this.cluster.clusterSecurityGroupId,
            exportName: EKS_SECURITY_GROUP_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'KubectlRoleArn', {
            value: this.cluster.kubectlRole!.roleArn,
            exportName: EKS_KUBECTL_ROLE_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'OpenIdConnectProviderArn', {
            value: this.cluster.openIdConnectProvider.openIdConnectProviderArn,
            exportName: EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'KubectlSecurityGroupId', {
            value: this.cluster.kubectlSecurityGroup!.securityGroupId,
            exportName: EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'KubectlLambdaRoleArn', {
            value: this.cluster.kubectlLambdaRole!.roleArn,
            exportName: EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME,
        });
    }

    public static importFromExports(
        scope: Construct,
        id: string,
    ): { cluster: ICluster; securityGroup: ISecurityGroup } {
        const clusterName = Fn.importValue(EKS_CLUSTER_NAME_EXPORT_NAME);
        const securityGroupId = Fn.importValue(EKS_SECURITY_GROUP_ID_EXPORT_NAME);
        const kubectlRoleArn = Fn.importValue(EKS_KUBECTL_ROLE_ARN_EXPORT_NAME);
        const kubectlLambdaRoleArn = Fn.importValue(EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME);
        const openIdConnectProviderArn = Fn.importValue(EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME);
        const kubectlSecurityGroupId = Fn.importValue(EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME);
        const kubectlRole = Role.fromRoleArn(scope, `${id}-KubectlRole`, kubectlRoleArn);
        const kubectlLambdaRole = Role.fromRoleArn(scope, `${id}-KubectlLambdaRole`, kubectlLambdaRoleArn);
        const kubectlSecurityGroup = SecurityGroup.fromSecurityGroupId(
            scope,
            `${id}-KubectlSecurityGroup`,
            kubectlSecurityGroupId,
        );
        const openIdConnectProvider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
            scope,
            `${id}-OpenIdConnectProvider`,
            openIdConnectProviderArn,
        );

        const cluster = Cluster.fromClusterAttributes(scope, `${id}-Cluster`, {
            clusterName: clusterName,
            kubectlRoleArn: kubectlRole.roleArn,
            kubectlLambdaRole: kubectlLambdaRole,
            openIdConnectProvider: openIdConnectProvider,
            kubectlSecurityGroupId: kubectlSecurityGroup.securityGroupId,
            kubectlLayer: new KubectlV33Layer(scope, 'kubectl'),
        });

        const securityGroup = SecurityGroup.fromSecurityGroupId(scope, `${id}-SecurityGroup`, securityGroupId);

        return { cluster, securityGroup };
    }
}
