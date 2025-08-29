/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RemovalPolicy, Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';
import { WorkshopNetwork } from '../constructs/network';
import { WorkshopEcs } from '../constructs/ecs';
import { Microservice, MicroservicesNames } from '../constructs/microservice';
import { ComputeType, HostType, PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { PayForAdoptionService } from '../microservices/pay-for-adoption';
import { AuroraDatabase } from '../constructs/database';
import { DynamoDatabase } from '../constructs/dynamodb';
import { ListAdoptionsService } from '../microservices/petlist-adoptions';
import { PetSearchService } from '../microservices/pet-search';
import { LambdaFunctionNames, WorkshopLambdaFunctionProperties } from '../constructs/lambda';
import { StatusUpdatedService } from '../serverless/functions/status-updater/status-updater';
import { VpcEndpoints } from '../constructs/vpc-endpoints';
import { PetSite } from '../microservices/petsite';
import { WorkshopEks } from '../constructs/eks';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { OpenSearchCollection } from '../constructs/opensearch-collection';
import { WorkshopAssets } from '../constructs/assets';
import { EventBusResources } from '../constructs/eventbus';
import { PetFoodECSService } from '../microservices/petfood';
import { CanaryNames, WorkshopCanaryProperties } from '../constructs/canary';
import { TrafficGeneratorFunction } from '../serverless/functions/traffic-generator/traffic-generator';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { HouseKeepingCanary } from '../serverless/canaries/housekeeping/housekeeping';
import { TrafficGeneratorCanary } from '../serverless/canaries/traffic-generator/traffic-generator';
import { NagSuppressions } from 'cdk-nag';
import { PetfoodCleanupProcessorFunction } from '../serverless/functions/petfood/cleanup-processor';
import { PetfoodImageGeneratorFunction } from '../serverless/functions/petfood/image-generator';

export interface MicroserviceApplicationPlacement {
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
    manifestPath?: string;
}

interface ImportedResources {
    vpcExports: any;
    ecsExports: any;
    eksExports: any;
    rdsExports: any;
    dynamodbExports: any;
    vpcEndpoints: any;
    cloudMap: any;
    openSearchExports: any;
    assetsBucket: any;
    eventBusExports: any;
    baseURI: string;
}

export interface MicroserviceApplicationsProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
    microservicesPlacement: Map<string, MicroserviceApplicationPlacement>;
    lambdaFunctions: Map<string, WorkshopLambdaFunctionProperties>;
    canaries: Map<string, WorkshopCanaryProperties>;
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

        // Import all required resources
        const imports = this.importResources();

        // Create microservices
        this.createMicroservices(properties, imports);

        // Create canaries and Lambda functions
        this.createCanariesAndLambdas(properties, imports);

        Utilities.SuppressLogRetentionNagWarnings(this);
        Utilities.SuppressKubectlProviderNagWarnings(this);
    }

    private importResources() {
        const vpcExports = WorkshopNetwork.importVpcFromExports(this, 'WorkshopVpc');
        const ecsExports = WorkshopEcs.importFromExports(this, 'WorkshopEcs', vpcExports);
        const eksExports = WorkshopEks.importFromExports(this, 'WorkshopEks');
        const rdsExports = AuroraDatabase.importFromExports(this, 'AuroraDatabase');
        const dynamodbExports = DynamoDatabase.importFromExports(this, 'DynamoDatabase');
        const vpcEndpoints = VpcEndpoints.importFromExports(this, 'VpcEndpoints');
        const cloudMap = WorkshopNetwork.importCloudMapNamespaceFromExports(this, 'CloudMapNamespace');
        const openSearchExports = OpenSearchCollection.importFromExports();
        const assetsBucket = WorkshopAssets.importBucketFromExports(this, 'WorkshopAssets');
        const eventBusExports = EventBusResources.importFromExports(this, 'EventBusResources');
        const baseURI = `${Stack.of(this).account}.dkr.ecr.${Stack.of(this).region}.amazonaws.com`;

        return {
            vpcExports,
            ecsExports,
            eksExports,
            rdsExports,
            dynamodbExports,
            vpcEndpoints,
            cloudMap,
            openSearchExports,
            assetsBucket,
            eventBusExports,
            baseURI,
        };
    }

    private createMicroservices(properties: MicroserviceApplicationsProperties, imports: ImportedResources) {
        this.microservices = new Map<string, Microservice>();

        for (const name of properties.microservicesPlacement.keys()) {
            const service = properties.microservicesPlacement.get(name);
            let svc;

            if (name == MicroservicesNames.PayForAdoption) {
                if (service?.hostType == HostType.ECS) {
                    svc = new PayForAdoptionService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: imports.ecsExports.securityGroup,
                        ecsCluster: imports.ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        database: imports.rdsExports.cluster,
                        secret: imports.rdsExports.adminSecret,
                        table: imports.dynamodbExports.table,
                        healthCheck: '/health/status',
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
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
                        securityGroup: imports.ecsExports.securityGroup,
                        ecsCluster: imports.ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        database: imports.rdsExports.cluster,
                        secret: imports.rdsExports.adminSecret,
                        healthCheck: '/health/status',
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
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
                        securityGroup: imports.ecsExports.securityGroup,
                        ecsCluster: imports.ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        database: imports.rdsExports.cluster,
                        secret: imports.rdsExports.adminSecret,
                        healthCheck: '/health/status',
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        table: imports.dynamodbExports.table,
                        bucket: imports.assetsBucket,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == MicroservicesNames.PetFood) {
                if (service?.hostType == HostType.ECS) {
                    svc = new PetFoodECSService(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: imports.ecsExports.securityGroup,
                        ecsCluster: imports.ecsExports.cluster,
                        disableService: service.disableService,
                        cpu: 1024,
                        memoryLimitMiB: 2048,
                        desiredTaskCount: 2,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        healthCheck: '/health/status',
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        petFoodTable: imports.dynamodbExports.petFoodsTable,
                        petFoodCartTable: imports.dynamodbExports.petFoodsCartTable,
                        additionalEnvironment: {
                            PETFOOD_ENABLE_JSON_LOGGING: 'true',
                            PETFOOD_OTLP_ENDPOINT: 'http://localhost:4317',
                            AWS_REGION: Stack.of(this).region,
                            PETFOOD_FOODS_TABLE_NAME: imports.dynamodbExports.petFoodsTable.tableName,
                            PETFOOD_CARTS_TABLE_NAME: imports.dynamodbExports.petFoodsCartTable.tableName,
                            PETFOOD_ASSETS_BUCKET_NAME: imports.assetsBucket.bucketName,
                        },
                        assetsBucket: imports.assetsBucket,
                        containerPort: 8080,
                        // Use pipeline if available, otherwise fall back to direct collection access
                        ...(imports.ecsExports.openSearchPipeline
                            ? { openSearchPipeline: imports.ecsExports.openSearchPipeline }
                            : { openSearchCollection: imports.openSearchExports }),
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
                        securityGroup: imports.eksExports.securityGroup,
                        eksCluster: imports.eksExports.cluster,
                        disableService: service.disableService,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        manifestPath: service.manifestPath,
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        listenerPort: 80,
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
    }

    private createCanariesAndLambdas(properties: MicroserviceApplicationsProperties, imports: ImportedResources) {
        const canaryArtifactBucket = new Bucket(this, 'CanaryArtifacts', {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true,
        });

        let trafficCanary;
        for (const name of properties.canaries.keys()) {
            const canaryProperties = properties.canaries.get(name) as WorkshopCanaryProperties;

            if (name == CanaryNames.Petsite) {
                trafficCanary = new TrafficGeneratorCanary(this, name, {
                    ...canaryProperties,
                    artifactsBucket: canaryArtifactBucket,
                    urlParameterName: `${PARAMETER_STORE_PREFIX}/petsiteurl`,
                });
            }
            if (name == CanaryNames.HouseKeeping) {
                new HouseKeepingCanary(this, name, {
                    ...canaryProperties,
                    artifactsBucket: canaryArtifactBucket,
                    urlParameterName: `${PARAMETER_STORE_PREFIX}/petsiteurl`,
                });
            }
        }

        if (!trafficCanary) {
            throw new Error('Traffic canary not found');
        }

        for (const name of properties.lambdaFunctions.keys()) {
            const lambdafunction = properties.lambdaFunctions.get(name) as WorkshopLambdaFunctionProperties;

            if (name == LambdaFunctionNames.StatusUpdater) {
                new StatusUpdatedService(this, name, {
                    ...lambdafunction,
                    name: name,
                    table: imports.dynamodbExports.table,
                    vpcEndpoint: imports.vpcEndpoints.apiGatewayEndpoint,
                });
            }
            if (name == LambdaFunctionNames.TrafficGenerator) {
                new TrafficGeneratorFunction(this, name, {
                    ...lambdafunction,
                    name: name,
                    trafficCanary: trafficCanary.canary,
                });
            }
            if (name == LambdaFunctionNames.PetfoodCleanupProcessor) {
                new PetfoodCleanupProcessorFunction(this, name, {
                    ...lambdafunction,
                    name: name,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petfoodTable,
                });
            }
            if (name == LambdaFunctionNames.PetfoodImageGenerator) {
                new PetfoodImageGeneratorFunction(this, name, {
                    ...lambdafunction,
                    name: name,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petfoodTable,
                });
            }
        }

        NagSuppressions.addResourceSuppressions(canaryArtifactBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'This bucket is used for canary artifacts and does not need access logs',
            },
        ]);
    }
}
