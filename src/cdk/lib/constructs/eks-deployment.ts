/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnPodIdentityAssociation, KubernetesManifest } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { Microservice, MicroserviceProperties } from './microservice';
import { Role } from 'aws-cdk-lib/aws-iam';

export interface EKSDeploymentProperties extends MicroserviceProperties {
    manifestPath?: string;
    skipValidation?: boolean;
    disableService?: boolean;
    name: string;
}

export abstract class EKSDeployment extends Microservice {
    public manifest: KubernetesManifest;
    public serviceAccountRole?: Role;
    public namespace?: string;
    public serviceAccountName?: string;
    public podIdentityAssociation?: CfnPodIdentityAssociation;

    constructor(scope: Construct, id: string, properties: EKSDeploymentProperties) {
        super(scope, id, properties);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- this is how KubnernetesManifests defines it
    abstract prepareManifest(properties: EKSDeploymentProperties): Record<string, any>[];

    configureEKSService(properties: EKSDeploymentProperties): KubernetesManifest {
        if (!properties.eksCluster) {
            throw new Error('eksCluster is required');
        }

        if (!properties.manifestPath) {
            throw new Error('manifestPath is required');
        }

        return new KubernetesManifest(this, 'KubernetesManifests', {
            overwrite: true,
            prune: true,
            skipValidation: properties.skipValidation,
            manifest: this.prepareManifest(properties),
            cluster: properties.eksCluster,
        });
    }
}
