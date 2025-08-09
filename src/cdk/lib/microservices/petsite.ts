/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import { EKSDeployment, EKSDeploymentProperties } from '../constructs/eks-deployment';
import { MicroserviceProperties } from '../constructs/microservice';
import { readFileSync } from 'node:fs';
import * as yaml from 'yaml';
import * as nunjucks from 'nunjucks';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPodIdentityAssociation } from 'aws-cdk-lib/aws-eks';
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

export class PetSite extends EKSDeployment {
    public readonly loadBalancer: ApplicationLoadBalancer;
    public readonly targetGroup: ApplicationTargetGroup;
    constructor(scope: Construct, id: string, properties: EKSDeploymentProperties) {
        super(scope, id, properties);
        this.loadBalancer = new ApplicationLoadBalancer(scope, 'loadBalancer', {
            vpc: properties.vpc!,
            internetFacing: true,
            loadBalancerName: `LB-${properties.name}`,
        });

        this.targetGroup = new ApplicationTargetGroup(scope, 'targetGroup', {
            port: properties.port || 80,
            vpc: properties.vpc!,
            protocol: ApplicationProtocol.HTTP,
            targetGroupName: `TG-${properties.name}`,
            targetType: TargetType.IP,
            healthCheck: {
                path: properties.healthCheck,
            },
        });

        this.namespace = 'petsite';
        this.serviceAccountName = 'petsite-sa';
        this.prepareManifest(properties);
        this.manifest = this.configureEKSService(properties);

        this.createOutputs();

        NagSuppressions.addResourceSuppressions(
            this.loadBalancer,
            [
                {
                    id: 'AwsSolutions-ELB2',
                    reason: 'Access logs not required for this workshop',
                },
            ],
            true,
        );
        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- this is how KubnernetesManifests defines it
    prepareManifest(properties: EKSDeploymentProperties): Record<string, any>[] {
        if (!properties.manifestPath) {
            throw new Error('manifestPath is required');
        }

        const manifestTemplate = readFileSync(properties.manifestPath, 'utf8');
        nunjucks.configure({ autoescape: true });

        const deploymentYaml = nunjucks.renderString(manifestTemplate, {
            ECR_IMAGE_URL: properties.repositoryURI,
            SUBNETS: properties.vpc?.publicSubnets,
            NAMESPACE: this.namespace,
            SERVICE_ACCOUNT_NAME: this.serviceAccountName,
            TARGET_GROUP_ARN: this.targetGroup.targetGroupArn,
        });
        return yaml.parseAllDocuments(deploymentYaml).map((document) => document.toJS());
    }

    configureECSService(): void {
        // Not applicable
    }
    addPermissions(properties: MicroserviceProperties): void {
        this.serviceAccountRole = new Role(this, 'serviceAccountRole', {
            assumedBy: new ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
        });

        this.podIdentityAssociation = new CfnPodIdentityAssociation(this, 'podIdentityAssociation', {
            clusterName: properties.eksCluster!.clusterName,
            namespace: this.namespace || 'default',
            roleArn: this.serviceAccountRole.roleArn,
            serviceAccount: this.serviceAccountName || `${properties.name}-sa`,
        });
    }
    createOutputs(): void {
        if (this.loadBalancer) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        petsiteurl: `http://${this.loadBalancer.loadBalancerDnsName}`,
                    }),
                ),
            );
        }
    }
}
