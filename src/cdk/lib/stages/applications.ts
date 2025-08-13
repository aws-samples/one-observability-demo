/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';
import { WorkshopNetwork } from '../constructs/network';
import { WorkshopEcs } from '../constructs/ecs';
import { Microservice, MicroservicesNames } from '../constructs/microservice';
import { ComputeType, HostType } from '../../bin/environment';
import { PayForAdoptionService } from '../microservices/pay-for-adoption';
import { AuroraDatabase } from '../constructs/database';
import { DynamoDatabase } from '../constructs/dynamodb';
import { ListAdoptionsService } from '../microservices/list-adoptions';
import { PetSearchService } from '../microservices/pet-search';
import { TrafficGeneratorService } from '../microservices/traffic-generator';
import { LambdaFunctionNames, WorkshopLambdaFunctionProperties } from '../constructs/lambda';
import { StatusUpdatedService } from '../constructs/serverless/status-updater';
import { VpcEndpoints } from '../constructs/vpc-endpoints';
import { PetSite } from '../microservices/petsite';
import { WorkshopEks } from '../constructs/eks';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';

export interface MicroserviceApplicationPlacement {
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
    manifestPath?: string;
}

export interface MicroserviceApplicationsProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    microservicesPlacement: Map<string, MicroserviceApplicationPlacement>;
    lambdaFunctions: Map<string, WorkshopLambdaFunctionProperties>;
}

export class MicroservicesStage extends Stage {
    public stack: MicroservicesStack;
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties) {
        super(scope, id, properties);

        this.stack = new MicroservicesStack(this, 'Microservice', properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}

export class MicroservicesStack extends Stack {
    public microservices: Map<string, Microservice>;
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties) {
        super(scope, id, properties);

        /** Retrieve Network Exports */
        const vpcExports = WorkshopNetwork.importVpcFromExports(this, 'WorkshopVpc');

        /** Retrieve ECS Cluster from Exports */
        const ecsExports = WorkshopEcs.importFromExports(this, 'WorkshopEcs', vpcExports);
        const eksExports = WorkshopEks.importFromExports(this, 'WorkshopEks');
        const rdsExports = AuroraDatabase.importFromExports(this, 'AuroraDatabase');
        const dynamodbExports = DynamoDatabase.importFromExports(this, 'DynamoDatabase');
        const vpcEndpoints = VpcEndpoints.importFromExports(this, 'VpcEndpoints');
        const cloudMap = WorkshopNetwork.importCloudMapNamespaceFromExports(this, 'CloudMapNamespace');

        const baseURI = `${Stack.of(this).account}.dkr.ecr.${Stack.of(this).region}.amazonaws.com`;

        this.microservices = new Map<string, Microservice>();

        for (const name of properties.microservicesPlacement.keys()) {
            const service = properties.microservicesPlacement.get(name);
            let svc;
            if (name == MicroservicesNames.PayForAdoption) {
                if (service?.hostType == HostType.ECS) {
                    svc = new PayForAdoptionService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: ecsExports.securityGroup,
                        ecsCluster: ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${baseURI}/${name}`,
                        database: rdsExports.cluster,
                        secret: rdsExports.adminSecret,
                        dynamoDbTable: dynamodbExports.table,
                        instrumentation: 'otel',
                        healthCheck: '/health/status',
                        vpc: vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: cloudMap,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == MicroservicesNames.PetListAdoptions) {
                if (service?.hostType == HostType.ECS) {
                    svc = new ListAdoptionsService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: ecsExports.securityGroup,
                        ecsCluster: ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${baseURI}/${name}`,
                        database: rdsExports.cluster,
                        secret: rdsExports.adminSecret,
                        instrumentation: 'otel',
                        healthCheck: '/health/status',
                        vpc: vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: cloudMap,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == MicroservicesNames.PetSearch) {
                if (service?.hostType == HostType.ECS) {
                    svc = new PetSearchService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: ecsExports.securityGroup,
                        ecsCluster: ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${baseURI}/${name}`,
                        database: rdsExports.cluster,
                        secret: rdsExports.adminSecret,
                        instrumentation: 'otel',
                        healthCheck: '/health/status',
                        vpc: vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: cloudMap,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == MicroservicesNames.TrafficGenerator) {
                if (service?.hostType == HostType.ECS) {
                    svc = new TrafficGeneratorService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: ecsExports.securityGroup,
                        ecsCluster: ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 1,
                        name: name,
                        repositoryURI: `${baseURI}/${name}`,
                        instrumentation: 'none',
                        vpc: vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: false,
                        cloudMapNamespace: cloudMap,
                        healthCheck: '/',
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == MicroservicesNames.PetSite) {
                if (service?.hostType == HostType.EKS) {
                    svc = new PetSite(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: eksExports.securityGroup,
                        eksCluster: eksExports.cluster,
                        disableService: service.disableService,
                        name: name,
                        repositoryURI: `${baseURI}/${name}`,
                        manifestPath: service.manifestPath,
                        vpc: vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        port: 80,
                        healthCheck: '/health/status',
                    });
                } else {
                    throw new Error(`ECS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
        }

        for (const name of properties.lambdaFunctions.keys()) {
            const lambdafunction = properties.lambdaFunctions.get(name) as WorkshopLambdaFunctionProperties;

            if (name == LambdaFunctionNames.StatusUpdater) {
                new StatusUpdatedService(this, name, {
                    ...lambdafunction,
                    name: name,
                    table: dynamodbExports.table,
                    vpcEndpoint: vpcEndpoints.apiGatewayEndpoint,
                });
            }
        }

        /** Grant access between Microservices */
        //const petsite = this.microservices.get(MicroservicesNames.PetSite) as PetSite;
        // TODO

        Utilities.SuppressLogRetentionNagWarnings(this);
        Utilities.SuppressKubectlProviderNagWarnings(this);
    }
}
