/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * EKS deployment construct for the One Observability Workshop.
 *
 * Deploys microservices to Amazon EKS using Kubernetes manifests:
 *
 * - **Kubernetes manifest** deployment via `KubernetesManifest` CDK construct
 * - **EKS Pod Identity** associations for IAM role binding to service accounts
 * - **Nunjucks templating** for dynamic manifest generation with environment-specific values
 *
 * Currently used by the petsite-net (.NET) frontend, which runs on EKS to demonstrate
 * Kubernetes-specific observability features like Container Insights for EKS
 * and CloudWatch Application Signals for Kubernetes workloads.
 *
 * @packageDocumentation
 */
import { CfnPodIdentityAssociation, KubernetesManifest } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { Microservice, MicroserviceProperties } from './microservice';
import { Role } from 'aws-cdk-lib/aws-iam';

/**
 * Properties for configuring an EKS-hosted microservice deployment.
 */
export interface EKSDeploymentProperties extends MicroserviceProperties {
    /** Path to the Kubernetes manifest template (Nunjucks format) */
    manifestPath?: string;
    /** Skip Kubernetes manifest validation during synthesis */
    skipValidation?: boolean;
    /** Skip creating the Kubernetes deployment (container build only) */
    disableService?: boolean;
    /** Service name used for resource naming and identification */
    name: string;
}

/**
 * Abstract base class for EKS-hosted microservices.
 *
 * Deploys Kubernetes manifests via CDK's `KubernetesManifest` construct
 * and configures EKS Pod Identity for IAM role binding. Concrete subclasses
 * implement `prepareManifest` to generate the Kubernetes resource definitions.
 */
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
