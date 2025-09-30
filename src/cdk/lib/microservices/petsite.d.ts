import { Construct } from 'constructs';
import { EKSDeployment, EKSDeploymentProperties } from '../constructs/eks-deployment';
import { MicroserviceProperties } from '../constructs/microservice';
import { ApplicationLoadBalancer, ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
export declare class PetSite extends EKSDeployment {
    readonly loadBalancer: ApplicationLoadBalancer;
    readonly targetGroup: ApplicationTargetGroup;
    readonly distribution: Distribution;
    constructor(scope: Construct, id: string, properties: EKSDeploymentProperties);
    prepareManifest(properties: EKSDeploymentProperties): Record<string, any>[];
    configureECSService(): void;
    addPermissions(properties: MicroserviceProperties): void;
    createOutputs(): void;
}
