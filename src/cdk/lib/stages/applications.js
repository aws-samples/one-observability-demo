"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicroservicesStack = exports.MicroservicesStage = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
/* eslint-disable @typescript-eslint/no-explicit-any */
const aws_cdk_lib_1 = require("aws-cdk-lib");
const utilities_1 = require("../utils/utilities");
const network_1 = require("../constructs/network");
const ecs_1 = require("../constructs/ecs");
const microservice_1 = require("../constructs/microservice");
const environment_1 = require("../../bin/environment");
const pay_for_adoption_1 = require("../microservices/pay-for-adoption");
const database_1 = require("../constructs/database");
const dynamodb_1 = require("../constructs/dynamodb");
const petlist_adoptions_1 = require("../microservices/petlist-adoptions");
const pet_search_1 = require("../microservices/pet-search");
const lambda_1 = require("../constructs/lambda");
const status_updater_1 = require("../serverless/functions/status-updater/status-updater");
const vpc_endpoints_1 = require("../constructs/vpc-endpoints");
const petsite_1 = require("../microservices/petsite");
const eks_1 = require("../constructs/eks");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const opensearch_collection_1 = require("../constructs/opensearch-collection");
const assets_1 = require("../constructs/assets");
const eventbus_1 = require("../constructs/eventbus");
const petfood_1 = require("../microservices/petfood");
const canary_1 = require("../constructs/canary");
const traffic_generator_1 = require("../serverless/functions/traffic-generator/traffic-generator");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const housekeeping_1 = require("../serverless/canaries/housekeeping/housekeeping");
const traffic_generator_2 = require("../serverless/canaries/traffic-generator/traffic-generator");
const cdk_nag_1 = require("cdk-nag");
const cleanup_processor_1 = require("../serverless/functions/petfood/cleanup-processor");
const image_generator_1 = require("../serverless/functions/petfood/image-generator");
const petsite_traffic_generator_1 = require("../serverless/functions/petsite-traffic-generator/petsite-traffic-generator");
const aws_eks_1 = require("aws-cdk-lib/aws-eks");
class MicroservicesStage extends aws_cdk_lib_1.Stage {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        this.stack = new MicroservicesStack(this, 'Microservice', properties);
        if (properties.tags) {
            utilities_1.Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}
exports.MicroservicesStage = MicroservicesStage;
class MicroservicesStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        // Import all required resources
        const imports = this.importResources();
        // Create microservices
        this.createMicroservices(properties, imports);
        // Create canaries and Lambda functions
        this.createCanariesAndLambdas(properties, imports);
        utilities_1.Utilities.SuppressLogRetentionNagWarnings(this);
        utilities_1.Utilities.SuppressKubectlProviderNagWarnings(this);
    }
    importResources() {
        const vpcExports = network_1.WorkshopNetwork.importVpcFromExports(this, 'WorkshopVpc');
        const ecsExports = ecs_1.WorkshopEcs.importFromExports(this, 'WorkshopEcs', vpcExports);
        const eksExports = eks_1.WorkshopEks.importFromExports(this, 'WorkshopEks');
        const rdsExports = database_1.AuroraDatabase.importFromExports(this, 'AuroraDatabase');
        const dynamodbExports = dynamodb_1.DynamoDatabase.importFromExports(this, 'DynamoDatabase');
        const vpcEndpoints = vpc_endpoints_1.VpcEndpoints.importFromExports(this, 'VpcEndpoints');
        const cloudMap = network_1.WorkshopNetwork.importCloudMapNamespaceFromExports(this, 'CloudMapNamespace');
        const openSearchExports = opensearch_collection_1.OpenSearchCollection.importFromExports();
        const assetsBucket = assets_1.WorkshopAssets.importBucketFromExports(this, 'WorkshopAssets');
        const eventBusExports = eventbus_1.EventBusResources.importFromExports(this, 'EventBusResources');
        const baseURI = `${aws_cdk_lib_1.Stack.of(this).account}.dkr.ecr.${aws_cdk_lib_1.Stack.of(this).region}.amazonaws.com`;
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
    createMicroservices(properties, imports) {
        this.microservices = new Map();
        const albEKSCheck = new aws_eks_1.KubernetesObjectValue(this, 'ALBEKS', {
            cluster: imports.eksExports.cluster,
            objectType: 'validatingwebhookconfigurations',
            objectName: 'aws-load-balancer-webhook',
            objectNamespace: 'kube-system',
            jsonPath: '.webhooks[*].clientConfig.service.path',
        });
        for (const name of properties.microservicesPlacement.keys()) {
            const service = properties.microservicesPlacement.get(name);
            let svc;
            if (name == microservice_1.MicroservicesNames.PayForAdoption) {
                if (service?.hostType == environment_1.HostType.ECS) {
                    svc = new pay_for_adoption_1.PayForAdoptionService(this, name, {
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
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        enableCloudWatchAgent: true,
                    });
                }
                else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == microservice_1.MicroservicesNames.PetListAdoptions) {
                if (service?.hostType == environment_1.HostType.ECS) {
                    svc = new petlist_adoptions_1.ListAdoptionsService(this, name, {
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
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                    });
                }
                else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == microservice_1.MicroservicesNames.PetSearch) {
                if (service?.hostType == environment_1.HostType.ECS) {
                    svc = new pet_search_1.PetSearchService(this, name, {
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
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        table: imports.dynamodbExports.table,
                        bucket: imports.assetsBucket,
                    });
                }
                else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == microservice_1.MicroservicesNames.PetFood) {
                if (service?.hostType == environment_1.HostType.ECS) {
                    svc = new petfood_1.PetFoodECSService(this, name, {
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
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        petFoodTable: imports.dynamodbExports.petFoodsTable,
                        petFoodCartTable: imports.dynamodbExports.petFoodsCartTable,
                        additionalEnvironment: {
                            PETFOOD_ENABLE_JSON_LOGGING: 'true',
                            PETFOOD_OTLP_ENDPOINT: 'http://localhost:4317',
                            AWS_REGION: aws_cdk_lib_1.Stack.of(this).region,
                        },
                        assetsBucket: imports.assetsBucket,
                        containerPort: 8080,
                        enableCloudWatchAgent: true,
                        // Use pipeline if available, otherwise fall back to direct collection access
                        ...(imports.ecsExports.openSearchPipeline
                            ? { openSearchPipeline: imports.ecsExports.openSearchPipeline }
                            : { openSearchCollection: imports.openSearchExports }),
                    });
                }
                else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
            if (name == microservice_1.MicroservicesNames.PetSite) {
                if (service?.hostType == environment_1.HostType.EKS) {
                    svc = new petsite_1.PetSite(this, name, {
                        hostType: service.hostType,
                        computeType: service.computeType,
                        securityGroup: imports.eksExports.securityGroup,
                        eksCluster: imports.eksExports.cluster,
                        disableService: service.disableService,
                        name: name,
                        repositoryURI: `${imports.baseURI}/${name}`,
                        manifestPath: service.manifestPath,
                        vpc: imports.vpcExports,
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        listenerPort: 80,
                        healthCheck: '/health/status',
                    });
                    svc.node.addDependency(albEKSCheck);
                }
                else {
                    throw new Error(`ECS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                }
            }
        }
    }
    createCanariesAndLambdas(properties, imports) {
        const canaryArtifactBucket = new aws_s3_1.Bucket(this, 'CanaryArtifacts', {
            autoDeleteObjects: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            enforceSSL: true,
        });
        let trafficCanary;
        for (const name of properties.canaries.keys()) {
            const canaryProperties = properties.canaries.get(name);
            if (name == canary_1.CanaryNames.Petsite) {
                trafficCanary = new traffic_generator_2.TrafficGeneratorCanary(this, name, {
                    ...canaryProperties,
                    artifactsBucket: canaryArtifactBucket,
                    urlParameterName: `${environment_1.PARAMETER_STORE_PREFIX}/petsiteurl`,
                });
            }
            if (name == canary_1.CanaryNames.HouseKeeping) {
                new housekeeping_1.HouseKeepingCanary(this, name, {
                    ...canaryProperties,
                    artifactsBucket: canaryArtifactBucket,
                    urlParameterName: `${environment_1.PARAMETER_STORE_PREFIX}/petsiteurl`,
                });
            }
        }
        if (!trafficCanary) {
            throw new Error('Traffic canary not found');
        }
        // Create petsite traffic generator function
        let petsiteTrafficFunction;
        for (const name of properties.lambdaFunctions.keys()) {
            const lambdafunction = properties.lambdaFunctions.get(name);
            if (name == 'petsite-traffic-generator-node') {
                petsiteTrafficFunction = new petsite_traffic_generator_1.PetsiteTrafficGeneratorFunction(this, name, {
                    ...lambdafunction,
                });
            }
        }
        if (!petsiteTrafficFunction) {
            throw new Error('Petsite traffic generator function not found');
        }
        for (const name of properties.lambdaFunctions.keys()) {
            const lambdafunction = properties.lambdaFunctions.get(name);
            if (name == lambda_1.LambdaFunctionNames.StatusUpdater) {
                new status_updater_1.StatusUpdatedService(this, name, {
                    ...lambdafunction,
                    table: imports.dynamodbExports.table,
                    vpcEndpoint: imports.vpcEndpoints.apiGatewayEndpoint,
                });
            }
            if (name == lambda_1.LambdaFunctionNames.TrafficGenerator) {
                new traffic_generator_1.TrafficGeneratorFunction(this, name, {
                    ...lambdafunction,
                    petsiteTrafficFunction: petsiteTrafficFunction.function,
                });
            }
            if (name == lambda_1.LambdaFunctionNames.PetfoodCleanupProcessor) {
                new cleanup_processor_1.PetfoodCleanupProcessorFunction(this, name, {
                    ...lambdafunction,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petFoodsTable,
                });
            }
            if (name == lambda_1.LambdaFunctionNames.PetfoodImageGenerator) {
                new image_generator_1.PetfoodImageGeneratorFunction(this, name, {
                    ...lambdafunction,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petFoodsTable,
                });
            }
        }
        cdk_nag_1.NagSuppressions.addResourceSuppressions(canaryArtifactBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'This bucket is used for canary artifacts and does not need access logs',
            },
        ]);
    }
}
exports.MicroservicesStack = MicroservicesStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb25zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwbGljYXRpb25zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7RUFHRTtBQUNGLHVEQUF1RDtBQUN2RCw2Q0FBc0U7QUFFdEUsa0RBQStDO0FBQy9DLG1EQUF3RDtBQUN4RCwyQ0FBZ0Q7QUFDaEQsNkRBQThFO0FBQzlFLHVEQUFzRjtBQUN0Rix3RUFBMEU7QUFDMUUscURBQXdEO0FBQ3hELHFEQUF3RDtBQUN4RCwwRUFBMEU7QUFDMUUsNERBQStEO0FBQy9ELGlEQUE2RjtBQUM3RiwwRkFBNkY7QUFDN0YsK0RBQTJEO0FBQzNELHNEQUFtRDtBQUNuRCwyQ0FBZ0Q7QUFDaEQsaURBQWlEO0FBQ2pELCtFQUEyRTtBQUMzRSxpREFBc0Q7QUFDdEQscURBQTJEO0FBQzNELHNEQUE2RDtBQUM3RCxpREFBNkU7QUFDN0UsbUdBQXVHO0FBQ3ZHLCtDQUE0QztBQUM1QyxtRkFBc0Y7QUFDdEYsa0dBQW9HO0FBQ3BHLHFDQUEwQztBQUMxQyx5RkFBb0c7QUFDcEcscUZBQWdHO0FBQ2hHLDJIQUE4SDtBQUM5SCxpREFBNEQ7QUErQjVELE1BQWEsa0JBQW1CLFNBQVEsbUJBQUs7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUE4QztRQUNwRixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUU3QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksa0JBQWtCLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUV0RSxJQUFJLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNsQixxQkFBUyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN4RCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBWEQsZ0RBV0M7QUFFRCxNQUFhLGtCQUFtQixTQUFR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QzFDLEdBQUcsY0FBYztvQkFDakIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxZQUFZO29CQUNqQyxjQUFjLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxRQUFRO29CQUNoRCxZQUFZLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxhQUFhO2lCQUN0RCxDQUFDLENBQUM7WUFDUCxDQUFDO1FBQ0wsQ0FBQztRQUVELHlCQUFlLENBQUMsdUJBQXVCLENBQUMsb0JBQW9CLEVBQUU7WUFDMUQ7Z0JBQ0ksRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLHdFQUF3RTthQUNuRjtTQUNKLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQWpURCxnREFpVEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbi8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnkgKi9cbmltcG9ydCB7IFJlbW92YWxQb2xpY3ksIFN0YWNrLCBTdGFja1Byb3BzLCBTdGFnZSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgVXRpbGl0aWVzIH0gZnJvbSAnLi4vdXRpbHMvdXRpbGl0aWVzJztcbmltcG9ydCB7IFdvcmtzaG9wTmV0d29yayB9IGZyb20gJy4uL2NvbnN0cnVjdHMvbmV0d29yayc7XG5pbXBvcnQgeyBXb3Jrc2hvcEVjcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZWNzJztcbmltcG9ydCB7IE1pY3Jvc2VydmljZSwgTWljcm9zZXJ2aWNlc05hbWVzIH0gZnJvbSAnLi4vY29uc3RydWN0cy9taWNyb3NlcnZpY2UnO1xuaW1wb3J0IHsgQ29tcHV0ZVR5cGUsIEhvc3RUeXBlLCBQQVJBTUVURVJfU1RPUkVfUFJFRklYIH0gZnJvbSAnLi4vLi4vYmluL2Vudmlyb25tZW50JztcbmltcG9ydCB7IFBheUZvckFkb3B0aW9uU2VydmljZSB9IGZyb20gJy4uL21pY3Jvc2VydmljZXMvcGF5LWZvci1hZG9wdGlvbic7XG5pbXBvcnQgeyBBdXJvcmFEYXRhYmFzZSB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZGF0YWJhc2UnO1xuaW1wb3J0IHsgRHluYW1vRGF0YWJhc2UgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2R5bmFtb2RiJztcbmltcG9ydCB7IExpc3RBZG9wdGlvbnNTZXJ2aWNlIH0gZnJvbSAnLi4vbWljcm9zZXJ2aWNlcy9wZXRsaXN0LWFkb3B0aW9ucyc7XG5pbXBvcnQgeyBQZXRTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi4vbWljcm9zZXJ2aWNlcy9wZXQtc2VhcmNoJztcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uTmFtZXMsIFdvcmtzaG9wTGFtYmRhRnVuY3Rpb25Qcm9wZXJ0aWVzIH0gZnJvbSAnLi4vY29uc3RydWN0cy9sYW1iZGEnO1xuaW1wb3J0IHsgU3RhdHVzVXBkYXRlZFNlcnZpY2UgfSBmcm9tICcuLi9zZXJ2ZXJsZXNzL2Z1bmN0aW9ucy9zdGF0dXMtdXBkYXRlci9zdGF0dXMtdXBkYXRlcic7XG5pbXBvcnQgeyBWcGNFbmRwb2ludHMgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL3ZwYy1lbmRwb2ludHMnO1xuaW1wb3J0IHsgUGV0U2l0ZSB9IGZyb20gJy4uL21pY3Jvc2VydmljZXMvcGV0c2l0ZSc7XG5pbXBvcnQgeyBXb3Jrc2hvcEVrcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZWtzJztcbmltcG9ydCB7IFN1Ym5ldFR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IE9wZW5TZWFyY2hDb2xsZWN0aW9uIH0gZnJvbSAnLi4vY29uc3RydWN0cy9vcGVuc2VhcmNoLWNvbGxlY3Rpb24nO1xuaW1wb3J0IHsgV29ya3Nob3BBc3NldHMgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2Fzc2V0cyc7XG5pbXBvcnQgeyBFdmVudEJ1c1Jlc291cmNlcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZXZlbnRidXMnO1xuaW1wb3J0IHsgUGV0Rm9vZEVDU1NlcnZpY2UgfSBmcm9tICcuLi9taWNyb3NlcnZpY2VzL3BldGZvb2QnO1xuaW1wb3J0IHsgQ2FuYXJ5TmFtZXMsIFdvcmtzaG9wQ2FuYXJ5UHJvcGVydGllcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvY2FuYXJ5JztcbmltcG9ydCB7IFRyYWZmaWNHZW5lcmF0b3JGdW5jdGlvbiB9IGZyb20gJy4uL3NlcnZlcmxlc3MvZnVuY3Rpb25zL3RyYWZmaWMtZ2VuZXJhdG9yL3RyYWZmaWMtZ2VuZXJhdG9yJztcbmltcG9ydCB7IEJ1Y2tldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgeyBIb3VzZUtlZXBpbmdDYW5hcnkgfSBmcm9tICcuLi9zZXJ2ZXJsZXNzL2NhbmFyaWVzL2hvdXNla2VlcGluZy9ob3VzZWtlZXBpbmcnO1xuaW1wb3J0IHsgVHJhZmZpY0dlbmVyYXRvckNhbmFyeSB9IGZyb20gJy4uL3NlcnZlcmxlc3MvY2FuYXJpZXMvdHJhZmZpYy1nZW5lcmF0b3IvdHJhZmZpYy1nZW5lcmF0b3InO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBQZXRmb29kQ2xlYW51cFByb2Nlc3NvckZ1bmN0aW9uIH0gZnJvbSAnLi4vc2VydmVybGVzcy9mdW5jdGlvbnMvcGV0Zm9vZC9jbGVhbnVwLXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBQZXRmb29kSW1hZ2VHZW5lcmF0b3JGdW5jdGlvbiB9IGZyb20gJy4uL3NlcnZlcmxlc3MvZnVuY3Rpb25zL3BldGZvb2QvaW1hZ2UtZ2VuZXJhdG9yJztcbmltcG9ydCB7IFBldHNpdGVUcmFmZmljR2VuZXJhdG9yRnVuY3Rpb24gfSBmcm9tICcuLi9zZXJ2ZXJsZXNzL2Z1bmN0aW9ucy9wZXRzaXRlLXRyYWZmaWMtZ2VuZXJhdG9yL3BldHNpdGUtdHJhZmZpYy1nZW5lcmF0b3InO1xuaW1wb3J0IHsgS3ViZXJuZXRlc09iamVjdFZhbHVlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWljcm9zZXJ2aWNlQXBwbGljYXRpb25QbGFjZW1lbnQge1xuICAgIGhvc3RUeXBlOiBIb3N0VHlwZTtcbiAgICBjb21wdXRlVHlwZTogQ29tcHV0ZVR5cGU7XG4gICAgZGlzYWJsZVNlcnZpY2U6IGJvb2xlYW47XG4gICAgbWFuaWZlc3RQYXRoPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgSW1wb3J0ZWRSZXNvdXJjZXMge1xuICAgIHZwY0V4cG9ydHM6IGFueTtcbiAgICBlY3NFeHBvcnRzOiBhbnk7XG4gICAgZWtzRXhwb3J0czogYW55O1xuICAgIHJkc0V4cG9ydHM6IGFueTtcbiAgICBkeW5hbW9kYkV4cG9ydHM6IGFueTtcbiAgICB2cGNFbmRwb2ludHM6IGFueTtcbiAgICBjbG91ZE1hcDogYW55O1xuICAgIG9wZW5TZWFyY2hFeHBvcnRzOiBhbnk7XG4gICAgYXNzZXRzQnVja2V0OiBhbnk7XG4gICAgZXZlbnRCdXNFeHBvcnRzOiBhbnk7XG4gICAgYmFzZVVSSTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1pY3Jvc2VydmljZUFwcGxpY2F0aW9uc1Byb3BlcnRpZXMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgICAvKiogVGFncyB0byBhcHBseSB0byBhbGwgcmVzb3VyY2VzIGluIHRoZSBzdGFnZSAqL1xuICAgIHRhZ3M/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xuICAgIG1pY3Jvc2VydmljZXNQbGFjZW1lbnQ6IE1hcDxzdHJpbmcsIE1pY3Jvc2VydmljZUFwcGxpY2F0aW9uUGxhY2VtZW50PjtcbiAgICBsYW1iZGFGdW5jdGlvbnM6IE1hcDxzdHJpbmcsIFdvcmtzaG9wTGFtYmRhRnVuY3Rpb25Qcm9wZXJ0aWVzPjtcbiAgICBjYW5hcmllczogTWFwPHN0cmluZywgV29ya3Nob3BDYW5hcnlQcm9wZXJ0aWVzPjtcbn1cblxuZXhwb3J0IGNsYXNzIE1pY3Jvc2VydmljZXNTdGFnZSBleHRlbmRzIFN0YWdlIHtcbiAgICBwdWJsaWMgc3RhY2s6IE1pY3Jvc2VydmljZXNTdGFjaztcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBNaWNyb3NlcnZpY2VBcHBsaWNhdGlvbnNQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcGVydGllcyk7XG5cbiAgICAgICAgdGhpcy5zdGFjayA9IG5ldyBNaWNyb3NlcnZpY2VzU3RhY2sodGhpcywgJ01pY3Jvc2VydmljZScsIHByb3BlcnRpZXMpO1xuXG4gICAgICAgIGlmIChwcm9wZXJ0aWVzLnRhZ3MpIHtcbiAgICAgICAgICAgIFV0aWxpdGllcy5UYWdDb25zdHJ1Y3QodGhpcy5zdGFjaywgcHJvcGVydGllcy50YWdzKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIE1pY3Jvc2VydmljZXNTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgICBwdWJsaWMgbWljcm9zZXJ2aWNlczogTWFwPHN0cmluZywgTWljcm9zZXJ2aWNlPjtcblxuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM6IE1pY3Jvc2VydmljZUFwcGxpY2F0aW9uc1Byb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wZXJ0aWVzKTtcblxuICAgICAgICAvLyBJbXBvcnQgYWxsIHJlcXVpcmVkIHJlc291cmNlc1xuICAgICAgICBjb25zdCBpbXBvcnRzID0gdGhpcy5pbXBvcnRSZXNvdXJjZXMoKTtcblxuICAgICAgICAvLyBDcmVhdGUgbWljcm9zZXJ2aWNlc1xuICAgICAgICB0aGlzLmNyZWF0ZU1pY3Jvc2VydmljZXMocHJvcGVydGllcywgaW1wb3J0cyk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGNhbmFyaWVzIGFuZCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgIHRoaXMuY3JlYXRlQ2FuYXJpZXNBbmRMYW1iZGFzKHByb3BlcnRpZXMsIGltcG9ydHMpO1xuXG4gICAgICAgIFV0aWxpdGllcy5TdXBwcmVzc0xvZ1JldGVudGlvbk5hZ1dhcm5pbmdzKHRoaXMpO1xuICAgICAgICBVdGlsaXRpZXMuU3VwcHJlc3NLdWJlY3RsUHJvdmlkZXJOYWdXYXJuaW5ncyh0aGlzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGltcG9ydFJlc291cmNlcygpIHtcbiAgICAgICAgY29uc3QgdnBjRXhwb3J0cyA9IFdvcmtzaG9wTmV0d29yay5pbXBvcnRWcGNGcm9tRXhwb3J0cyh0aGlzLCAnV29ya3Nob3BWcGMnKTtcbiAgICAgICAgY29uc3QgZWNzRXhwb3J0cyA9IFdvcmtzaG9wRWNzLmltcG9ydEZyb21FeHBvcnRzKHRoaXMsICdXb3Jrc2hvcEVjcycsIHZwY0V4cG9ydHMpO1xuICAgICAgICBjb25zdCBla3NFeHBvcnRzID0gV29ya3Nob3BFa3MuaW1wb3J0RnJvbUV4cG9ydHModGhpcywgJ1dvcmtzaG9wRWtzJyk7XG4gICAgICAgIGNvbnN0IHJkc0V4cG9ydHMgPSBBdXJvcmFEYXRhYmFzZS5pbXBvcnRGcm9tRXhwb3J0cyh0aGlzLCAnQXVyb3JhRGF0YWJhc2UnKTtcbiAgICAgICAgY29uc3QgZHluYW1vZGJFeHBvcnRzID0gRHluYW1vRGF0YWJhc2UuaW1wb3J0RnJvbUV4cG9ydHModGhpcywgJ0R5bmFtb0RhdGFiYXNlJyk7XG4gICAgICAgIGNvbnN0IHZwY0VuZHBvaW50cyA9IFZwY0VuZHBvaW50cy5pbXBvcnRGcm9tRXhwb3J0cyh0aGlzLCAnVnBjRW5kcG9pbnRzJyk7XG4gICAgICAgIGNvbnN0IGNsb3VkTWFwID0gV29ya3Nob3BOZXR3b3JrLmltcG9ydENsb3VkTWFwTmFtZXNwYWNlRnJvbUV4cG9ydHModGhpcywgJ0Nsb3VkTWFwTmFtZXNwYWNlJyk7XG4gICAgICAgIGNvbnN0IG9wZW5TZWFyY2hFeHBvcnRzID0gT3BlblNlYXJjaENvbGxlY3Rpb24uaW1wb3J0RnJvbUV4cG9ydHMoKTtcbiAgICAgICAgY29uc3QgYXNzZXRzQnVja2V0ID0gV29ya3Nob3BBc3NldHMuaW1wb3J0QnVja2V0RnJvbUV4cG9ydHModGhpcywgJ1dvcmtzaG9wQXNzZXRzJyk7XG4gICAgICAgIGNvbnN0IGV2ZW50QnVzRXhwb3J0cyA9IEV2ZW50QnVzUmVzb3VyY2VzLmltcG9ydEZyb21FeHBvcnRzKHRoaXMsICdFdmVudEJ1c1Jlc291cmNlcycpO1xuICAgICAgICBjb25zdCBiYXNlVVJJID0gYCR7U3RhY2sub2YodGhpcykuYWNjb3VudH0uZGtyLmVjci4ke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWA7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZwY0V4cG9ydHMsXG4gICAgICAgICAgICBlY3NFeHBvcnRzLFxuICAgICAgICAgICAgZWtzRXhwb3J0cyxcbiAgICAgICAgICAgIHJkc0V4cG9ydHMsXG4gICAgICAgICAgICBkeW5hbW9kYkV4cG9ydHMsXG4gICAgICAgICAgICB2cGNFbmRwb2ludHMsXG4gICAgICAgICAgICBjbG91ZE1hcCxcbiAgICAgICAgICAgIG9wZW5TZWFyY2hFeHBvcnRzLFxuICAgICAgICAgICAgYXNzZXRzQnVja2V0LFxuICAgICAgICAgICAgZXZlbnRCdXNFeHBvcnRzLFxuICAgICAgICAgICAgYmFzZVVSSSxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZU1pY3Jvc2VydmljZXMocHJvcGVydGllczogTWljcm9zZXJ2aWNlQXBwbGljYXRpb25zUHJvcGVydGllcywgaW1wb3J0czogSW1wb3J0ZWRSZXNvdXJjZXMpIHtcbiAgICAgICAgdGhpcy5taWNyb3NlcnZpY2VzID0gbmV3IE1hcDxzdHJpbmcsIE1pY3Jvc2VydmljZT4oKTtcblxuICAgICAgICBjb25zdCBhbGJFS1NDaGVjayA9IG5ldyBLdWJlcm5ldGVzT2JqZWN0VmFsdWUodGhpcywgJ0FMQkVLUycsIHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGltcG9ydHMuZWtzRXhwb3J0cy5jbHVzdGVyLFxuICAgICAgICAgICAgb2JqZWN0VHlwZTogJ3ZhbGlkYXRpbmd3ZWJob29rY29uZmlndXJhdGlvbnMnLFxuICAgICAgICAgICAgb2JqZWN0TmFtZTogJ2F3cy1sb2FkLWJhbGFuY2VyLXdlYmhvb2snLFxuICAgICAgICAgICAgb2JqZWN0TmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxuICAgICAgICAgICAganNvblBhdGg6ICcud2ViaG9va3NbKl0uY2xpZW50Q29uZmlnLnNlcnZpY2UucGF0aCcsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZvciAoY29uc3QgbmFtZSBvZiBwcm9wZXJ0aWVzLm1pY3Jvc2VydmljZXNQbGFjZW1lbnQua2V5cygpKSB7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvcGVydGllcy5taWNyb3NlcnZpY2VzUGxhY2VtZW50LmdldChuYW1lKTtcbiAgICAgICAgICAgIGxldCBzdmM7XG5cbiAgICAgICAgICAgIGlmIChuYW1lID09IE1pY3Jvc2VydmljZXNOYW1lcy5QYXlGb3JBZG9wdGlvbikge1xuICAgICAgICAgICAgICAgIGlmIChzZXJ2aWNlPy5ob3N0VHlwZSA9PSBIb3N0VHlwZS5FQ1MpIHtcbiAgICAgICAgICAgICAgICAgICAgc3ZjID0gbmV3IFBheUZvckFkb3B0aW9uU2VydmljZSh0aGlzLCBuYW1lLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBob3N0VHlwZTogc2VydmljZS5ob3N0VHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXB1dGVUeXBlOiBzZXJ2aWNlLmNvbXB1dGVUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogaW1wb3J0cy5lY3NFeHBvcnRzLnNlY3VyaXR5R3JvdXAsXG4gICAgICAgICAgICAgICAgICAgICAgICBlY3NDbHVzdGVyOiBpbXBvcnRzLmVjc0V4cG9ydHMuY2x1c3RlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc2FibGVTZXJ2aWNlOiBzZXJ2aWNlLmRpc2FibGVTZXJ2aWNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY3B1OiAxMDI0LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IDIwNDgsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNpcmVkVGFza0NvdW50OiAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcG9zaXRvcnlVUkk6IGAke2ltcG9ydHMuYmFzZVVSSX0vJHtuYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhYmFzZTogaW1wb3J0cy5yZHNFeHBvcnRzLmNsdXN0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWNyZXQ6IGltcG9ydHMucmRzRXhwb3J0cy5hZG1pblNlY3JldCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhYmxlOiBpbXBvcnRzLmR5bmFtb2RiRXhwb3J0cy50YWJsZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWx0aENoZWNrOiAnL2hlYWx0aC9zdGF0dXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdnBjOiBpbXBvcnRzLnZwY0V4cG9ydHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJuZXRUeXBlOiBTdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVMb2FkQmFsYW5jZXI6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbG91ZE1hcE5hbWVzcGFjZTogaW1wb3J0cy5jbG91ZE1hcCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZUNsb3VkV2F0Y2hBZ2VudDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFS1MgaXMgbm90IHN1cHBvcnRlZCBmb3IgJHtuYW1lfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoc3ZjKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWljcm9zZXJ2aWNlcy5zZXQobmFtZSwgc3ZjKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobmFtZSA9PSBNaWNyb3NlcnZpY2VzTmFtZXMuUGV0TGlzdEFkb3B0aW9ucykge1xuICAgICAgICAgICAgICAgIGlmIChzZXJ2aWNlPy5ob3N0VHlwZSA9PSBIb3N0VHlwZS5FQ1MpIHtcbiAgICAgICAgICAgICAgICAgICAgc3ZjID0gbmV3IExpc3RBZG9wdGlvbnNTZXJ2aWNlKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RUeXBlOiBzZXJ2aWNlLmhvc3RUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcHV0ZVR5cGU6IHNlcnZpY2UuY29tcHV0ZVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBpbXBvcnRzLmVjc0V4cG9ydHMuc2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVjc0NsdXN0ZXI6IGltcG9ydHMuZWNzRXhwb3J0cy5jbHVzdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZVNlcnZpY2U6IHNlcnZpY2UuZGlzYWJsZVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcHU6IDEwMjQsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRUYXNrQ291bnQ6IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVwb3NpdG9yeVVSSTogYCR7aW1wb3J0cy5iYXNlVVJJfS8ke25hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGFiYXNlOiBpbXBvcnRzLnJkc0V4cG9ydHMuY2x1c3RlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3JldDogaW1wb3J0cy5yZHNFeHBvcnRzLmFkbWluU2VjcmV0LFxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXG4gICAgICAgICAgICAgICAgICAgICAgICB2cGM6IGltcG9ydHMudnBjRXhwb3J0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZUxvYWRCYWxhbmNlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb3VkTWFwTmFtZXNwYWNlOiBpbXBvcnRzLmNsb3VkTWFwLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVLUyBpcyBub3Qgc3VwcG9ydGVkIGZvciAke25hbWV9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChzdmMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5taWNyb3NlcnZpY2VzLnNldChuYW1lLCBzdmMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChuYW1lID09IE1pY3Jvc2VydmljZXNOYW1lcy5QZXRTZWFyY2gpIHtcbiAgICAgICAgICAgICAgICBpZiAoc2VydmljZT8uaG9zdFR5cGUgPT0gSG9zdFR5cGUuRUNTKSB7XG4gICAgICAgICAgICAgICAgICAgIHN2YyA9IG5ldyBQZXRTZWFyY2hTZXJ2aWNlKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RUeXBlOiBzZXJ2aWNlLmhvc3RUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcHV0ZVR5cGU6IHNlcnZpY2UuY29tcHV0ZVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBpbXBvcnRzLmVjc0V4cG9ydHMuc2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVjc0NsdXN0ZXI6IGltcG9ydHMuZWNzRXhwb3J0cy5jbHVzdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZVNlcnZpY2U6IHNlcnZpY2UuZGlzYWJsZVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcHU6IDEwMjQsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRUYXNrQ291bnQ6IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVwb3NpdG9yeVVSSTogYCR7aW1wb3J0cy5iYXNlVVJJfS8ke25hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGFiYXNlOiBpbXBvcnRzLnJkc0V4cG9ydHMuY2x1c3RlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3JldDogaW1wb3J0cy5yZHNFeHBvcnRzLmFkbWluU2VjcmV0LFxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXG4gICAgICAgICAgICAgICAgICAgICAgICB2cGM6IGltcG9ydHMudnBjRXhwb3J0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZUxvYWRCYWxhbmNlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb3VkTWFwTmFtZXNwYWNlOiBpbXBvcnRzLmNsb3VkTWFwLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGFibGU6IGltcG9ydHMuZHluYW1vZGJFeHBvcnRzLnRhYmxlLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnVja2V0OiBpbXBvcnRzLmFzc2V0c0J1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFS1MgaXMgbm90IHN1cHBvcnRlZCBmb3IgJHtuYW1lfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoc3ZjKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWljcm9zZXJ2aWNlcy5zZXQobmFtZSwgc3ZjKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobmFtZSA9PSBNaWNyb3NlcnZpY2VzTmFtZXMuUGV0Rm9vZCkge1xuICAgICAgICAgICAgICAgIGlmIChzZXJ2aWNlPy5ob3N0VHlwZSA9PSBIb3N0VHlwZS5FQ1MpIHtcbiAgICAgICAgICAgICAgICAgICAgc3ZjID0gbmV3IFBldEZvb2RFQ1NTZXJ2aWNlKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RUeXBlOiBzZXJ2aWNlLmhvc3RUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcHV0ZVR5cGU6IHNlcnZpY2UuY29tcHV0ZVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBpbXBvcnRzLmVjc0V4cG9ydHMuc2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVjc0NsdXN0ZXI6IGltcG9ydHMuZWNzRXhwb3J0cy5jbHVzdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZVNlcnZpY2U6IHNlcnZpY2UuZGlzYWJsZVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcHU6IDEwMjQsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2lyZWRUYXNrQ291bnQ6IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVwb3NpdG9yeVVSSTogYCR7aW1wb3J0cy5iYXNlVVJJfS8ke25hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWx0aENoZWNrOiAnL2hlYWx0aC9zdGF0dXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdnBjOiBpbXBvcnRzLnZwY0V4cG9ydHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJuZXRUeXBlOiBTdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVMb2FkQmFsYW5jZXI6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbG91ZE1hcE5hbWVzcGFjZTogaW1wb3J0cy5jbG91ZE1hcCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBldEZvb2RUYWJsZTogaW1wb3J0cy5keW5hbW9kYkV4cG9ydHMucGV0Rm9vZHNUYWJsZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBldEZvb2RDYXJ0VGFibGU6IGltcG9ydHMuZHluYW1vZGJFeHBvcnRzLnBldEZvb2RzQ2FydFRhYmxlLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWRkaXRpb25hbEVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUEVURk9PRF9FTkFCTEVfSlNPTl9MT0dHSU5HOiAndHJ1ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUEVURk9PRF9PVExQX0VORFBPSU5UOiAnaHR0cDovL2xvY2FsaG9zdDo0MzE3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBBV1NfUkVHSU9OOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXRzQnVja2V0OiBpbXBvcnRzLmFzc2V0c0J1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRhaW5lclBvcnQ6IDgwODAsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVDbG91ZFdhdGNoQWdlbnQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBVc2UgcGlwZWxpbmUgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIGRpcmVjdCBjb2xsZWN0aW9uIGFjY2Vzc1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uKGltcG9ydHMuZWNzRXhwb3J0cy5vcGVuU2VhcmNoUGlwZWxpbmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHsgb3BlblNlYXJjaFBpcGVsaW5lOiBpbXBvcnRzLmVjc0V4cG9ydHMub3BlblNlYXJjaFBpcGVsaW5lIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHsgb3BlblNlYXJjaENvbGxlY3Rpb246IGltcG9ydHMub3BlblNlYXJjaEV4cG9ydHMgfSksXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRUtTIGlzIG5vdCBzdXBwb3J0ZWQgZm9yICR7bmFtZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHN2Yykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1pY3Jvc2VydmljZXMuc2V0KG5hbWUsIHN2Yyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5hbWUgPT0gTWljcm9zZXJ2aWNlc05hbWVzLlBldFNpdGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoc2VydmljZT8uaG9zdFR5cGUgPT0gSG9zdFR5cGUuRUtTKSB7XG4gICAgICAgICAgICAgICAgICAgIHN2YyA9IG5ldyBQZXRTaXRlKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RUeXBlOiBzZXJ2aWNlLmhvc3RUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcHV0ZVR5cGU6IHNlcnZpY2UuY29tcHV0ZVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBpbXBvcnRzLmVrc0V4cG9ydHMuc2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVrc0NsdXN0ZXI6IGltcG9ydHMuZWtzRXhwb3J0cy5jbHVzdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZVNlcnZpY2U6IHNlcnZpY2UuZGlzYWJsZVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVwb3NpdG9yeVVSSTogYCR7aW1wb3J0cy5iYXNlVVJJfS8ke25hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hbmlmZXN0UGF0aDogc2VydmljZS5tYW5pZmVzdFBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICB2cGM6IGltcG9ydHMudnBjRXhwb3J0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpc3RlbmVyUG9ydDogODAsXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFsdGhDaGVjazogJy9oZWFsdGgvc3RhdHVzJyxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN2Yy5ub2RlLmFkZERlcGVuZGVuY3koYWxiRUtTQ2hlY2spO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRUNTIGlzIG5vdCBzdXBwb3J0ZWQgZm9yICR7bmFtZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHN2Yykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1pY3Jvc2VydmljZXMuc2V0KG5hbWUsIHN2Yyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVDYW5hcmllc0FuZExhbWJkYXMocHJvcGVydGllczogTWljcm9zZXJ2aWNlQXBwbGljYXRpb25zUHJvcGVydGllcywgaW1wb3J0czogSW1wb3J0ZWRSZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3QgY2FuYXJ5QXJ0aWZhY3RCdWNrZXQgPSBuZXcgQnVja2V0KHRoaXMsICdDYW5hcnlBcnRpZmFjdHMnLCB7XG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCB0cmFmZmljQ2FuYXJ5O1xuICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgcHJvcGVydGllcy5jYW5hcmllcy5rZXlzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNhbmFyeVByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzLmNhbmFyaWVzLmdldChuYW1lKSBhcyBXb3Jrc2hvcENhbmFyeVByb3BlcnRpZXM7XG5cbiAgICAgICAgICAgIGlmIChuYW1lID09IENhbmFyeU5hbWVzLlBldHNpdGUpIHtcbiAgICAgICAgICAgICAgICB0cmFmZmljQ2FuYXJ5ID0gbmV3IFRyYWZmaWNHZW5lcmF0b3JDYW5hcnkodGhpcywgbmFtZSwge1xuICAgICAgICAgICAgICAgICAgICAuLi5jYW5hcnlQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICBhcnRpZmFjdHNCdWNrZXQ6IGNhbmFyeUFydGlmYWN0QnVja2V0LFxuICAgICAgICAgICAgICAgICAgICB1cmxQYXJhbWV0ZXJOYW1lOiBgJHtQQVJBTUVURVJfU1RPUkVfUFJFRklYfS9wZXRzaXRldXJsYCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChuYW1lID09IENhbmFyeU5hbWVzLkhvdXNlS2VlcGluZykge1xuICAgICAgICAgICAgICAgIG5ldyBIb3VzZUtlZXBpbmdDYW5hcnkodGhpcywgbmFtZSwge1xuICAgICAgICAgICAgICAgICAgICAuLi5jYW5hcnlQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICBhcnRpZmFjdHNCdWNrZXQ6IGNhbmFyeUFydGlmYWN0QnVja2V0LFxuICAgICAgICAgICAgICAgICAgICB1cmxQYXJhbWV0ZXJOYW1lOiBgJHtQQVJBTUVURVJfU1RPUkVfUFJFRklYfS9wZXRzaXRldXJsYCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdHJhZmZpY0NhbmFyeSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUcmFmZmljIGNhbmFyeSBub3QgZm91bmQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBwZXRzaXRlIHRyYWZmaWMgZ2VuZXJhdG9yIGZ1bmN0aW9uXG4gICAgICAgIGxldCBwZXRzaXRlVHJhZmZpY0Z1bmN0aW9uO1xuICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgcHJvcGVydGllcy5sYW1iZGFGdW5jdGlvbnMua2V5cygpKSB7XG4gICAgICAgICAgICBjb25zdCBsYW1iZGFmdW5jdGlvbiA9IHByb3BlcnRpZXMubGFtYmRhRnVuY3Rpb25zLmdldChuYW1lKSBhcyBXb3Jrc2hvcExhbWJkYUZ1bmN0aW9uUHJvcGVydGllcztcblxuICAgICAgICAgICAgaWYgKG5hbWUgPT0gJ3BldHNpdGUtdHJhZmZpYy1nZW5lcmF0b3Itbm9kZScpIHtcbiAgICAgICAgICAgICAgICBwZXRzaXRlVHJhZmZpY0Z1bmN0aW9uID0gbmV3IFBldHNpdGVUcmFmZmljR2VuZXJhdG9yRnVuY3Rpb24odGhpcywgbmFtZSwge1xuICAgICAgICAgICAgICAgICAgICAuLi5sYW1iZGFmdW5jdGlvbixcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghcGV0c2l0ZVRyYWZmaWNGdW5jdGlvbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQZXRzaXRlIHRyYWZmaWMgZ2VuZXJhdG9yIGZ1bmN0aW9uIG5vdCBmb3VuZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBuYW1lIG9mIHByb3BlcnRpZXMubGFtYmRhRnVuY3Rpb25zLmtleXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbGFtYmRhZnVuY3Rpb24gPSBwcm9wZXJ0aWVzLmxhbWJkYUZ1bmN0aW9ucy5nZXQobmFtZSkgYXMgV29ya3Nob3BMYW1iZGFGdW5jdGlvblByb3BlcnRpZXM7XG5cbiAgICAgICAgICAgIGlmIChuYW1lID09IExhbWJkYUZ1bmN0aW9uTmFtZXMuU3RhdHVzVXBkYXRlcikge1xuICAgICAgICAgICAgICAgIG5ldyBTdGF0dXNVcGRhdGVkU2VydmljZSh0aGlzLCBuYW1lLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmxhbWJkYWZ1bmN0aW9uLFxuICAgICAgICAgICAgICAgICAgICB0YWJsZTogaW1wb3J0cy5keW5hbW9kYkV4cG9ydHMudGFibGUsXG4gICAgICAgICAgICAgICAgICAgIHZwY0VuZHBvaW50OiBpbXBvcnRzLnZwY0VuZHBvaW50cy5hcGlHYXRld2F5RW5kcG9pbnQsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobmFtZSA9PSBMYW1iZGFGdW5jdGlvbk5hbWVzLlRyYWZmaWNHZW5lcmF0b3IpIHtcbiAgICAgICAgICAgICAgICBuZXcgVHJhZmZpY0dlbmVyYXRvckZ1bmN0aW9uKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubGFtYmRhZnVuY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgIHBldHNpdGVUcmFmZmljRnVuY3Rpb246IHBldHNpdGVUcmFmZmljRnVuY3Rpb24uZnVuY3Rpb24hLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5hbWUgPT0gTGFtYmRhRnVuY3Rpb25OYW1lcy5QZXRmb29kQ2xlYW51cFByb2Nlc3Nvcikge1xuICAgICAgICAgICAgICAgIG5ldyBQZXRmb29kQ2xlYW51cFByb2Nlc3NvckZ1bmN0aW9uKHRoaXMsIG5hbWUsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubGFtYmRhZnVuY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgIGltYWdlQnVja2V0OiBpbXBvcnRzLmFzc2V0c0J1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgZXZlbnRCcmlkZ2VCdXM6IGltcG9ydHMuZXZlbnRCdXNFeHBvcnRzLmV2ZW50QnVzLFxuICAgICAgICAgICAgICAgICAgICBwZXRmb29kVGFibGU6IGltcG9ydHMuZHluYW1vZGJFeHBvcnRzLnBldEZvb2RzVGFibGUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobmFtZSA9PSBMYW1iZGFGdW5jdGlvbk5hbWVzLlBldGZvb2RJbWFnZUdlbmVyYXRvcikge1xuICAgICAgICAgICAgICAgIG5ldyBQZXRmb29kSW1hZ2VHZW5lcmF0b3JGdW5jdGlvbih0aGlzLCBuYW1lLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmxhbWJkYWZ1bmN0aW9uLFxuICAgICAgICAgICAgICAgICAgICBpbWFnZUJ1Y2tldDogaW1wb3J0cy5hc3NldHNCdWNrZXQsXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50QnJpZGdlQnVzOiBpbXBvcnRzLmV2ZW50QnVzRXhwb3J0cy5ldmVudEJ1cyxcbiAgICAgICAgICAgICAgICAgICAgcGV0Zm9vZFRhYmxlOiBpbXBvcnRzLmR5bmFtb2RiRXhwb3J0cy5wZXRGb29kc1RhYmxlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGNhbmFyeUFydGlmYWN0QnVja2V0LCBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEnLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ1RoaXMgYnVja2V0IGlzIHVzZWQgZm9yIGNhbmFyeSBhcnRpZmFjdHMgYW5kIGRvZXMgbm90IG5lZWQgYWNjZXNzIGxvZ3MnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgXSk7XG4gICAgfVxufVxuIl19