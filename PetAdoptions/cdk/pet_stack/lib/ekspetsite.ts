import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as eks from '@aws-cdk/aws-eks';
import { KubernetesVersion } from '@aws-cdk/aws-eks';

export class EKSPetsite extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const clusterAdmin = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });

        const cluster = new eks.Cluster(this, 'eks_petsite', {
            clusterName: 'eks_petsite',
            kubectlEnabled: true,
            mastersRole: clusterAdmin,
            version: KubernetesVersion.V1_16
        });
    }
}