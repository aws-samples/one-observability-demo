/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { ICluster as IEKSCluster } from 'aws-cdk-lib/aws-eks';
import { ICluster as IECSCluster } from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
    PAYFORADOPTION_GO,
    PETLISTADOPTIONS_GO,
    PETSEARCH_JAVA,
    PETSITE,
    PETSTATUSUPDATER,
    HostType,
    ComputeType,
} from '../../bin/environment';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';

export const MicroservicesNames = {
    PayForAdoption: PAYFORADOPTION_GO.name,
    PetListAdoptions: PETLISTADOPTIONS_GO.name,
    PetSearch: PETSEARCH_JAVA.name,
    PetSite: PETSITE.name,
    PetStatusUpdater: PETSTATUSUPDATER.name,
} as const;

export interface MicroserviceProperties {
    hostType: HostType;
    computeType: ComputeType;
    tags?: { [key: string]: string };
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
    port?: number;
    createLoadBalancer?: boolean;
}

export abstract class Microservice extends Construct {
    constructor(scope: Construct, id: string, properties: MicroserviceProperties) {
        super(scope, id);

        if (properties.hostType == HostType.ECS && !properties.ecsCluster) {
            throw new Error('ecsCluster is required if host type is ECS');
        }
        if (properties.hostType == HostType.EKS && !properties.eksCluster) {
            throw new Error('eksCluster is required if host type is EKS');
        }
    }

    abstract configureEKSService(properties: MicroserviceProperties): void;

    abstract configureECSService(properties: MicroserviceProperties): void;

    abstract addPermissions(properties: MicroserviceProperties): void;

    abstract createOutputs(properties: MicroserviceProperties): void;

    readonly ddbSeedPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:BatchWriteItem', 'dynamodb:ListTables', 'dynamodb:Scan', 'dynamodb:Query'],
        resources: ['*'],
    });

    public static getDefaultSSMPolicy(scope: Construct, prefix?: string) {
        const cleanPrefix = (prefix || '/petstore/').startsWith('/')
            ? (prefix || '/petstore/').slice(1)
            : prefix || '/petstore/';
        const readSMParametersPolicy = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
            resources: [`arn:aws:ssm:${Stack.of(scope).region}:${Stack.of(scope).account}:parameter/${cleanPrefix}*`],
        });

        return readSMParametersPolicy;
    }
}
