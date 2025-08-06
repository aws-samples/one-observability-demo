/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Cluster as EKSCluster } from 'aws-cdk-lib/aws-eks';
import { Cluster as ECSCluster } from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export enum HostType {
    ECS = 'ECS',
    EKS = 'EKS',
}

export enum ComputeType {
    EC2 = 'EC2',
    Fargate = 'Fargate',
}

export interface MicroserviceProperties {
    hostType: HostType;
    computeType: ComputeType;
    tags?: { [key: string]: string };
    securityGroup: SecurityGroup;
    eksCluster?: EKSCluster;
    ecsCluster?: ECSCluster;
    /** Default Log Retention */
    logRetentionDays?: RetentionDays;
}

export abstract class Microservice extends Construct {
    constructor(scope: Construct, id: string, properties: MicroserviceProperties) {
        super(scope, id);

        if (properties.hostType == HostType.ECS) {
            this.configureECSService(properties);
        } else {
            this.configureEKSService(properties);
        }
    }

    abstract configureEKSService(properties: MicroserviceProperties): void;

    abstract configureECSService(properties: MicroserviceProperties): void;
}
