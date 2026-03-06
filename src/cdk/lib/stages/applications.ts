/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RemovalPolicy, Stack, StackProps, Stage, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { Utilities } from '../utils/utilities';
import { WorkshopNetwork } from '../constructs/network';
import { WorkshopEcs } from '../constructs/ecs';
import { Microservice, MicroservicesNames } from '../constructs/microservice';
import {
    ComputeType,
    CUSTOM_ENABLE_SLO,
    CUSTOM_ENABLE_WAF,
    ENABLE_OPENSEARCH,
    ENABLE_PET_FOOD_AGENT,
    HostType,
    PARAMETER_STORE_PREFIX,
} from '../../bin/environment';
import {
    CloudWatchAgentTraceMode,
    ECS_CLUSTER_NAME_EXPORT_NAME,
    ECS_SECURITY_GROUP_ID_EXPORT_NAME,
} from '../../bin/constants';
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
import { SubnetType, SecurityGroup, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { OpenSearchCollection } from '../constructs/opensearch-collection';
import { WorkshopAssets } from '../constructs/assets';
import { EventBusResources } from '../constructs/eventbus';
import { QueueResources } from '../constructs/queue';
import { PetFoodECSService } from '../microservices/petfood';
import { CanaryNames, WorkshopCanaryProperties } from '../constructs/canary';
import { TrafficGeneratorFunction } from '../serverless/functions/traffic-generator/traffic-generator';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { HouseKeepingCanary } from '../serverless/canaries/housekeeping/housekeeping';
import { TrafficGeneratorCanary } from '../serverless/canaries/traffic-generator/traffic-generator';
import { NagSuppressions } from 'cdk-nag';
import { PetfoodCleanupProcessorFunction } from '../serverless/functions/petfood/cleanup-processor';
import { PetfoodImageGeneratorFunction } from '../serverless/functions/petfood/image-generator';
import { PetfoodStockProcessorFunction } from '../serverless/functions/petfood/stock-processor';
import { UserCreatorFunction } from '../serverless/functions/user-creator/user-creator';
import { KubernetesObjectValue } from 'aws-cdk-lib/aws-eks';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { PetFoodAgentConstruct } from '../microservices/petfood-agent';
import { GlobalWaf, RegionalWaf } from '../constructs/waf';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { DynamoDBWriteTestConstruct } from '../serverless/functions/dynamo-capacity/dynamo-database-write-test-construct';

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
    queueExports: any;
    baseURI: string;
    regionalAclArn?: string;
    globalAclArn?: string;
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
        // Import ECS exports with conditional OpenSearch pipeline handling
        const ecsExports = ENABLE_OPENSEARCH
            ? WorkshopEcs.importFromExports(this, 'WorkshopEcs', vpcExports)
            : this.importEcsExportsWithoutOpenSearch(vpcExports);
        const eksExports = WorkshopEks.importFromExports(this, 'WorkshopEks');
        const rdsExports = AuroraDatabase.importFromExports(this, 'AuroraDatabase');
        const dynamodbExports = DynamoDatabase.importFromExports(this, 'DynamoDatabase');
        const vpcEndpoints = VpcEndpoints.importFromExports(this, 'VpcEndpoints');
        const cloudMap = WorkshopNetwork.importCloudMapNamespaceFromExports(this, 'CloudMapNamespace');

        // Import OpenSearch exports only if OpenSearch is enabled
        const openSearchExports = ENABLE_OPENSEARCH ? OpenSearchCollection.importFromExports() : undefined;
        const assetsBucket = WorkshopAssets.importBucketFromExports(this, 'WorkshopAssets');
        const eventBusExports = EventBusResources.importFromExports(this, 'EventBusResources');
        const queueExports = QueueResources.importFromExports(this, 'QueueResources');
        const baseURI = `${Stack.of(this).account}.dkr.ecr.${Stack.of(this).region}.amazonaws.com`;
        const regionalAclArn = CUSTOM_ENABLE_WAF ? RegionalWaf.regionalAclArnFromParameter() : undefined;
        const globalAclArn = CUSTOM_ENABLE_WAF ? GlobalWaf.globalAclArnFromParameter() : undefined;

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
            queueExports,
            baseURI,
            regionalAclArn,
            globalAclArn,
        };
    }

    /**
     * Import ECS exports without trying to import OpenSearch pipeline exports
     * This is used when OpenSearch is disabled to avoid CloudFormation import errors
     */
    private importEcsExportsWithoutOpenSearch(vpc: any) {
        const clusterName = Fn.importValue(ECS_CLUSTER_NAME_EXPORT_NAME);
        const securityGroupId = Fn.importValue(ECS_SECURITY_GROUP_ID_EXPORT_NAME);

        const cluster = Cluster.fromClusterAttributes(this, 'ImportedEcsCluster', {
            clusterName: clusterName,
            vpc: vpc,
        });

        const securityGroup = SecurityGroup.fromSecurityGroupId(this, 'ImportedEcsSecurityGroup', securityGroupId);

        return {
            cluster,
            securityGroup,
            openSearchPipeline: undefined, // No OpenSearch pipeline when disabled
        };
    }

    private createMicroservices(properties: MicroserviceApplicationsProperties, imports: ImportedResources) {
        this.microservices = new Map<string, Microservice>();

        const albEKSCheck = new KubernetesObjectValue(this, 'ALBEKS', {
            cluster: imports.eksExports.cluster,
            objectType: 'validatingwebhookconfigurations',
            objectName: 'aws-load-balancer-webhook',
            objectNamespace: 'kube-system',
            jsonPath: '.webhooks[*].clientConfig.service.path',
        });

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
                        queue: imports.queueExports.queue,
                        healthCheck: '/health/status',
                        vpc: imports.vpcExports,
                        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                        containerPort: 8080,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        enableCloudWatchAgent: true,
                        cloudWatchAgentTraceMode: CloudWatchAgentTraceMode.OTLP,
                        additionalEnvironment: {
                            PAYFORADOPTION_SERVICE_NAME: 'payforadoption-api-go',
                        },
                        enableSLO: CUSTOM_ENABLE_SLO,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                    if (imports.regionalAclArn && svc.loadBalancedService?.loadBalancer.loadBalancerArn) {
                        new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                            resourceArn: svc.loadBalancedService?.loadBalancer.loadBalancerArn,
                            webAclArn: imports.regionalAclArn,
                        });
                    }
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
                        containerPort: 8080,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        enableCloudWatchAgent: true,
                        additionalEnvironment: {
                            PORT: '8080',
                            PYTHONPATH:
                                '/otel-auto-instrumentation-python/opentelemetry/instrumentation/auto_instrumentation:/app:/otel-auto-instrumentation-python',
                            OTEL_RESOURCE_ATTRIBUTES:
                                'service.name=petlistadoptions-api-py,deployment.environment=ecs:PetsiteECS-cluster',
                            OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
                            OTEL_METRICS_EXPORTER: 'none',
                            OTEL_LOGS_EXPORTER: 'none',
                            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
                            OTEL_AWS_APPLICATION_SIGNALS_EXPORTER_ENDPOINT: 'http://localhost:4316/v1/metrics',
                            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4316/v1/traces',
                            OTEL_TRACES_SAMPLER: 'xray',
                            OTEL_TRACES_SAMPLER_ARG: 'endpoint=http://localhost:2000',
                            OTEL_PROPAGATORS: 'xray',
                            OTEL_PYTHON_CONFIGURATOR: 'aws_configurator',
                            OTEL_PYTHON_DISTRO: 'aws_distro',
                        },
                        enableSLO: CUSTOM_ENABLE_SLO,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                    if (imports.regionalAclArn && svc.loadBalancedService?.loadBalancer.loadBalancerArn) {
                        new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                            resourceArn: svc.loadBalancedService?.loadBalancer.loadBalancerArn,
                            webAclArn: imports.regionalAclArn,
                        });
                    }
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
                        containerPort: 8080,
                        createLoadBalancer: true,
                        cloudMapNamespace: imports.cloudMap,
                        enableCloudWatchAgent: false,
                        table: imports.dynamodbExports.table,
                        bucket: imports.assetsBucket,
                        additionalEnvironment: {
                            OTEL_SERVICE_NAME: 'petsearch-api-java',
                            OTEL_RESOURCE_ATTRIBUTES:
                                'service.name=petsearch-api-java,deployment.environment=ecs:PetsiteECS-cluster',
                        },
                        enableSLO: CUSTOM_ENABLE_SLO,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                    if (imports.regionalAclArn && svc.loadBalancedService?.loadBalancer.loadBalancerArn) {
                        new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                            resourceArn: svc.loadBalancedService?.loadBalancer.loadBalancerArn,
                            webAclArn: imports.regionalAclArn,
                        });
                    }
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
                            PETFOOD_SERVICE_NAME: 'petfood-api-rs',
                            PETFOOD_OTLP_ENDPOINT: 'http://localhost:4317',
                            AWS_REGION: Stack.of(this).region,
                            OTEL_RESOURCE_ATTRIBUTES:
                                'service.name=petfood-rs-api,deployment.environment=ecs:PetsiteECS-cluster',
                        },
                        assetsBucket: imports.assetsBucket,
                        containerPort: 8080,
                        enableCloudWatchAgent: true,
                        cloudWatchAgentTraceMode: CloudWatchAgentTraceMode.OTLP,
                        // Use pipeline if available, otherwise fall back to direct collection access
                        ...(() => {
                            if (imports.ecsExports.openSearchPipeline) {
                                return { openSearchPipeline: imports.ecsExports.openSearchPipeline };
                            } else if (imports.openSearchExports) {
                                return { openSearchCollection: imports.openSearchExports };
                            } else {
                                return {};
                            }
                        })(),
                        enableSLO: CUSTOM_ENABLE_SLO,
                    });
                } else {
                    throw new Error(`EKS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                    if (imports.regionalAclArn && svc.loadBalancedService?.loadBalancer.loadBalancerArn) {
                        new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                            resourceArn: svc.loadBalancedService?.loadBalancer.loadBalancerArn,
                            webAclArn: imports.regionalAclArn,
                        });
                    }
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
                        containerPort: 8080,
                        healthCheck: '/health/status',
                        globalWebACLArn: CUSTOM_ENABLE_WAF ? imports.globalAclArn : undefined,
                        enableSLO: CUSTOM_ENABLE_SLO,
                    });
                    svc.node.addDependency(albEKSCheck);
                } else {
                    throw new Error(`ECS is not supported for ${name}`);
                }
                if (svc) {
                    this.microservices.set(name, svc);
                    if (imports.regionalAclArn && svc.loadBalancer.loadBalancerArn) {
                        new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                            resourceArn: svc.loadBalancer.loadBalancerArn,
                            webAclArn: imports.regionalAclArn,
                        });
                    }
                }
            }

            if (name == MicroservicesNames.PetFoodAgent && ENABLE_PET_FOOD_AGENT) {
                new PetFoodAgentConstruct(this, 'PetFoodAgent', {
                    ecrRepositoryUri: `${imports.baseURI}/${name}`,
                    vpc: imports.vpcExports,
                    securityGroups: [imports.ecsExports.securityGroup],
                });
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
                    urlParameterName: `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`,
                });
            }
            if (name == CanaryNames.HouseKeeping) {
                new HouseKeepingCanary(this, name, {
                    ...canaryProperties,
                    artifactsBucket: canaryArtifactBucket,
                    urlParameterName: `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`,
                });
            }
        }

        if (!trafficCanary) {
            throw new Error('Traffic canary not found');
        }

        for (const name of properties.lambdaFunctions.keys()) {
            const lambdafunction = properties.lambdaFunctions.get(name) as WorkshopLambdaFunctionProperties;

            if (name == LambdaFunctionNames.StatusUpdater) {
                const svc = new StatusUpdatedService(this, name, {
                    ...lambdafunction,
                    table: imports.dynamodbExports.table,
                    vpcEndpoint: imports.vpcEndpoints.apiGatewayEndpoint,
                });

                if (imports.regionalAclArn && svc.api.deploymentStage.stageArn) {
                    new CfnWebACLAssociation(this, `${name}-regional-waf`, {
                        resourceArn: svc.api.deploymentStage.stageArn,
                        webAclArn: imports.regionalAclArn,
                    });
                }
            }
            if (name == LambdaFunctionNames.TrafficGenerator) {
                new TrafficGeneratorFunction(this, name, {
                    ...lambdafunction,
                });
            }
            if (name == LambdaFunctionNames.PetfoodCleanupProcessor) {
                new PetfoodCleanupProcessorFunction(this, name, {
                    ...lambdafunction,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petFoodsTable,
                });
            }
            if (name == LambdaFunctionNames.PetfoodImageGenerator) {
                new PetfoodImageGeneratorFunction(this, name, {
                    ...lambdafunction,
                    imageBucket: imports.assetsBucket,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petFoodsTable,
                });
            }
            if (name == LambdaFunctionNames.PetfoodStockProcessor) {
                new PetfoodStockProcessorFunction(this, name, {
                    ...lambdafunction,
                    eventBridgeBus: imports.eventBusExports.eventBus,
                    petfoodTable: imports.dynamodbExports.petFoodsTable,
                });
            }
            if (name == LambdaFunctionNames.UserCreator) {
                new UserCreatorFunction(this, name, {
                    ...lambdafunction,
                    databaseSecret: imports.rdsExports.adminSecret,
                    secretParameterName: `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.RDS_SECRET_ARN_NAME}`,
                    sqsQueue: imports.queueExports.queue,
                    vpc: imports.vpcExports,
                    vpcSubnets: {
                        subnetGroupName: 'Private',
                    },
                    securityGroups: [
                        this.createUserCreatorSecurityGroup(imports.vpcExports, imports.rdsExports.securityGroup),
                    ],
                });
            }
            if (name == LambdaFunctionNames.DynamoCapacityTest) {
                new DynamoDBWriteTestConstruct(this, name, {
                    ...lambdafunction,
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

    private createUserCreatorSecurityGroup(vpc: any, rdsSecurityGroup: any): any {
        // Create security group for Lambda to access RDS
        const lambdaSecurityGroup = new SecurityGroup(this, 'UserCreatorLambdaSecurityGroup', {
            vpc: vpc,
            description: 'Security group for User Creator Lambda function',
        });

        // Allow Lambda to access RDS by adding ingress rule to RDS security group
        rdsSecurityGroup.addIngressRule(lambdaSecurityGroup, Port.POSTGRES, 'User Creator Lambda access');

        // Allow outbound HTTPS access for AWS API calls
        lambdaSecurityGroup.addEgressRule(Peer.anyIpv4(), Port.tcp(443), 'HTTPS outbound for AWS API calls');

        return lambdaSecurityGroup;
    }
}
