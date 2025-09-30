import { ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { ICluster as IEKSCluster } from 'aws-cdk-lib/aws-eks';
import { ICluster as IECSCluster } from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { HostType, ComputeType } from '../../bin/environment';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
export declare const MicroservicesNames: {
    readonly PayForAdoption: string;
    readonly PetListAdoptions: string;
    readonly PetSearch: string;
    readonly PetSite: string;
    readonly PetFood: string;
};
export interface MicroserviceProperties {
    hostType: HostType;
    computeType: ComputeType;
    tags?: {
        [key: string]: string;
    };
    securityGroup?: ISecurityGroup;
    vpc?: IVpc;
    eksCluster?: IEKSCluster;
    ecsCluster?: IECSCluster;
    /** Default Log Retention */
    logRetentionDays?: RetentionDays;
    name: string;
    repositoryURI: string;
    disableService?: boolean;
    logGroupName?: string;
    healthCheck?: string;
    subnetType?: SubnetType;
    listenerPort?: number;
    containerPort?: number;
    createLoadBalancer?: boolean;
}
export declare abstract class Microservice extends Construct {
    constructor(scope: Construct, id: string, properties: MicroserviceProperties);
    abstract configureEKSService(properties: MicroserviceProperties): void;
    abstract configureECSService(properties: MicroserviceProperties): void;
    abstract addPermissions(properties: MicroserviceProperties): void;
    abstract createOutputs(properties: MicroserviceProperties): void;
    readonly ddbSeedPolicy: PolicyStatement;
    static getDefaultEventBridgePolicy(scope: Construct): PolicyStatement;
    static getDefaultSSMPolicy(scope: Construct, prefix?: string): PolicyStatement;
}
