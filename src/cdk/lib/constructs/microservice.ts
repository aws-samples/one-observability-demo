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
    PETLISTADOPTIONS_PY,
    PETSEARCH_JAVA,
    PETSITE_NET,
    PETFOOD_RS,
    HostType,
    ComputeType,
    PETFOODAGENT_STRANDS_PY,
} from '../../bin/environment';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack, Duration } from 'aws-cdk-lib';
import { CfnServiceLevelObjective } from 'aws-cdk-lib/aws-applicationsignals';

export const MicroservicesNames = {
    PayForAdoption: PAYFORADOPTION_GO.name,
    PetListAdoptions: PETLISTADOPTIONS_PY.name,
    PetSearch: PETSEARCH_JAVA.name,
    PetSite: PETSITE_NET.name,
    PetFood: PETFOOD_RS.name,
    PetFoodAgent: PETFOODAGENT_STRANDS_PY.name,
} as const;

/**
 * SLO configuration for a microservice
 */
export interface SLOConfig {
    /** Availability target percentage (e.g., 99.9 for 99.9%) */
    availabilityTarget: number;
    /** P99 latency target in milliseconds */
    latencyP99Target: number;
    /** Service tier (1, 2, or 3) for documentation purposes */
    tier: 1 | 2 | 3;
}

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
    healthCheck?: string;
    subnetType?: SubnetType;
    listenerPort?: number;
    containerPort?: number;
    createLoadBalancer?: boolean;
    /** SLO configuration for this service */
    sloConfig?: SLOConfig;
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

        // Create SLO definitions if configured
        if (properties.sloConfig) {
            this.createSLOs(properties.name, properties.sloConfig);
        }
    }

    /**
     * Create SLO definitions for this microservice using AWS Application Signals
     */
    private createSLOs(serviceName: string, config: SLOConfig): void {
        const tierDescription = `Tier ${config.tier}`;

        // Create availability SLO
        new CfnServiceLevelObjective(this, `${serviceName}-AvailabilitySLO`, {
            name: `${serviceName}-availability`,
            description: `${tierDescription}: ${serviceName} availability`,
            goal: {
                interval: {
                    rollingInterval: {
                        duration: 30,
                        durationUnit: 'DAY',
                    },
                },
                attainmentGoal: config.availabilityTarget,
                warningThreshold: config.availabilityTarget - 0.5, // Alert when within 0.5% of target
            },
            sli: {
                sliMetric: {
                    keyAttributes: {
                        Service: serviceName,
                    },
                    metricType: 'AVAILABILITY',
                },
                comparisonOperator: 'GreaterThanOrEqualTo',
                metricThreshold: config.availabilityTarget,
            },
        });

        // Create latency SLO
        new CfnServiceLevelObjective(this, `${serviceName}-LatencySLO`, {
            name: `${serviceName}-latency`,
            description: `${tierDescription}: ${serviceName} P99 latency`,
            goal: {
                interval: {
                    rollingInterval: {
                        duration: 30,
                        durationUnit: 'DAY',
                    },
                },
                attainmentGoal: 99, // 99% of requests should meet latency target
                warningThreshold: 98.5,
            },
            sli: {
                sliMetric: {
                    keyAttributes: {
                        Service: serviceName,
                    },
                    metricType: 'LATENCY',
                    statistic: 'p99',
                },
                comparisonOperator: 'LessThan',
                metricThreshold: config.latencyP99Target,
            },
        });
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
