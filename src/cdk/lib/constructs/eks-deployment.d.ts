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
export declare abstract class EKSDeployment extends Microservice {
    manifest: KubernetesManifest;
    serviceAccountRole?: Role;
    namespace?: string;
    serviceAccountName?: string;
    podIdentityAssociation?: CfnPodIdentityAssociation;
    constructor(scope: Construct, id: string, properties: EKSDeploymentProperties);
    abstract prepareManifest(properties: EKSDeploymentProperties): Record<string, any>[];
    configureEKSService(properties: EKSDeploymentProperties): KubernetesManifest;
}
