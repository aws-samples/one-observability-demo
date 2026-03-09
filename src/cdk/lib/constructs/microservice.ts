/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Base microservice construct for the One Observability Workshop.
 *
 * Provides the abstract base class and shared configuration for all microservices:
 *
 * - **SSM Parameter Store** policies for runtime configuration discovery
 * - **EventBridge** policies for event-driven communication
 * - **Naming conventions** via `MicroservicesNames` for consistent resource identification
 * - **Deployment placement** configuration (ECS Fargate, ECS EC2, EKS, or None)
 *
 * All six microservices (payforadoption-go, petlistadoption-py, petsearch-java,
 * petsite-net, petfood-rs, petfoodagent-strands-py) extend this base class
 * through either {@link EcsService} or {@link EKSDeployment}.
 *
 * @packageDocumentation
 */
import { ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { ICluster as IEKSCluster } from 'aws-cdk-lib/aws-eks';
import { ICluster as IECSCluster } from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
    PAYFORADOPTION_GO,
    PETLISTADOPTIONS_PY,
    PETSEARCH_JAVA,
    PETSITE_NET,
    PETFOOD_RS,
    HostType,
    ComputeType,
    PETFOODAGENT_STRANDS_PY,
} from '../../bin/environment';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';

/** Canonical name constants for all six microservices. */
export const MicroservicesNames = {
    PayForAdoption: PAYFORADOPTION_GO.name,
    PetListAdoptions: PETLISTADOPTIONS_PY.name,
    PetSearch: PETSEARCH_JAVA.name,
    PetSite: PETSITE_NET.name,
    PetFood: PETFOOD_RS.name,
    PetFoodAgent: PETFOODAGENT_STRANDS_PY.name,
} as const;

/** Common properties shared by all microservice constructs (ECS, EKS, and AgentCore). */
export interface MicroserviceProperties {
    /** Where the service runs: ECS, EKS, or None (AgentCore) */
    hostType: HostType;
    /** Compute backing: Fargate or EC2 */
    computeType: ComputeType;
    /** Resource tags applied to all child constructs */
    tags?: { [key: string]: string };
    /** Security group for the service's network interface */
    securityGroup?: ISecurityGroup;
    /** VPC for network placement */
    vpc?: IVpc;
    /** EKS cluster (required when hostType is EKS) */
    eksCluster?: IEKSCluster;
    /** ECS cluster (required when hostType is ECS) */
    ecsCluster?: IECSCluster;
    /** Default Log Retention */
    logRetentionDays?: RetentionDays;
    /** Service name used for resource naming and identification */
    name: string;
    /** ECR repository URI for the container image */
    repositoryURI: string;
    /** Skip creating the runtime service (container build only) */
    disableService?: boolean;
    /** Health check path for the load balancer target group */
    healthCheck?: string;
    /** Subnet type for task placement */
    subnetType?: SubnetType;
    /** ALB listener port (default: 80) */
    listenerPort?: number;
    /** Container port the application listens on */
    containerPort?: number;
    /** Whether to create an ALB for this service */
    createLoadBalancer?: boolean;
    /** Whether to create Application Signals SLOs */
    enableSLO?: boolean;
}

/** Abstract base class for all microservice constructs. Validates host-type requirements and provides shared IAM policies. */
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

    public static getDefaultEventBridgePolicy(scope: Construct) {
        const publishEventPolicy = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['events:PutEvents'],
            resources: [`arn:aws:events:${Stack.of(scope).region}:${Stack.of(scope).account}:event-bus/default`],
        });
        return publishEventPolicy;
    }

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
