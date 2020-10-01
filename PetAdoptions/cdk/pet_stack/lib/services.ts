import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as sns from '@aws-cdk/aws-sns'
import * as sqs from '@aws-cdk/aws-sqs'
import * as subs from '@aws-cdk/aws-sns-subscriptions'
import * as ddb from '@aws-cdk/aws-dynamodb'
import * as s3 from '@aws-cdk/aws-s3'
import * as ddbseeder from 'aws-cdk-dynamodb-seeder'
import * as s3seeder from '@aws-cdk/aws-s3-deployment'
import * as rds from '@aws-cdk/aws-rds';
import * as ssm from '@aws-cdk/aws-ssm';
import * as eks from '@aws-cdk/aws-eks';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';

import { SqlServerSeeder } from 'cdk-sqlserver-seeder'
import { PayForAdoptionService } from './services/pay-for-adoption-service'
import { ListAdoptionsService } from './services/list-adoptions-service'
import { PetSiteService } from './services/pet-site-service'
import { SearchService } from './services/search-service'
import { TrafficGeneratorService } from './services/traffic-generator-service'
import { StatusUpdaterService } from './services/status-updater-service'
import {PetAdoptionsStepFn} from './services/stepfn'
import path = require('path');
import { KubernetesVersion } from '@aws-cdk/aws-eks';
import { RemovalPolicy } from '@aws-cdk/core';

export class Services extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const stackName = id;

        // Create SQS resource to send Pet adoption messages to
        const sqsQueue = new sqs.Queue(this, 'sqs_petadoption', {
            visibilityTimeout: cdk.Duration.seconds(300)
        });

        // Create SNS and an email topic to send notifications to
        const topic_petadoption = new sns.Topic(this, 'topic_petadoption');
        topic_petadoption.addSubscription(new subs.EmailSubscription(this.node.tryGetContext('snstopic_email')));

        // Creates an S3 bucket to store pet images
        const s3_observabilitypetadoptions = new s3.Bucket(this, 's3bucket_petadoption', {
            publicReadAccess: false
        });

        // Creates the DynamoDB table for Petadoption data
        const dynamodb_petadoption = new ddb.Table(this, 'ddb_petadoption', {
            partitionKey: {
                name: 'pettype',
                type: ddb.AttributeType.STRING
            },
            sortKey: {
                name: 'petid',
                type: ddb.AttributeType.STRING
            },
            removalPolicy:  RemovalPolicy.DESTROY
        });
        
        dynamodb_petadoption.metricConsumedReadCapacityUnits().createAlarm(this, 'ReadCapacityUnitsLimit-BasicAlarm', {
          threshold: 240,
          evaluationPeriods: 2,
          period: cdk.Duration.minutes(1),
          alarmName: `${dynamodb_petadoption.tableName}-ReadCapacityUnitsLimit-BasicAlarm`,
        });
        
        dynamodb_petadoption.metricConsumedReadCapacityUnits().createAlarm(this, 'WriteCapacityUnitsLimit-BasicAlarm', {
          threshold: 240,
          evaluationPeriods: 2,
          period: cdk.Duration.minutes(1),
          alarmName: `${dynamodb_petadoption.tableName}-WriteCapacityUnitsLimit-BasicAlarm`,
        });

        // Seeds the petadoptions dynamodb table with all data required
        new ddbseeder.Seeder(this, "ddb_seeder_petadoption", {
            table: dynamodb_petadoption,
            setup: require("../resources/seed-data.json"),
            teardown: require("../resources/delete-seed-data.json"),
            refreshOnUpdate: true  // runs setup and teardown on every update, default false
        });

        // Seeds the S3 bucket with pet images
        new s3seeder.BucketDeployment(this, "s3seeder_petadoption", {
            destinationBucket: s3_observabilitypetadoptions,
            sources: [s3seeder.Source.asset('./resources/kitten.zip'), s3seeder.Source.asset('./resources/puppies.zip'), s3seeder.Source.asset('./resources/bunnies.zip')]
        });


        // The VPC where all the microservices will be deployed into
        const theVPC = new ec2.Vpc(this, 'Microservices', {
            cidr: this.node.tryGetContext('vpc_cidr'),
            natGateways: 1,
            maxAzs: 2
        });

        // Create RDS SQL Server DB instance

        const rdssecuritygroup = new ec2.SecurityGroup(this, 'petadoptionsrdsSG', {
            vpc: theVPC
        });

        rdssecuritygroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(1433), 'allow MSSQL access from the world');

        const rdsUsername = this.node.tryGetContext('rdsusername');
        const instance = new rds.DatabaseInstance(this, 'Instance', {
            engine: rds.DatabaseInstanceEngine.sqlServerWeb({version:rds.SqlServerEngineVersion.VER_15} ),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
            credentials:{username:rdsUsername},
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            deletionProtection: false,
            vpc: theVPC,
            licenseModel: rds.LicenseModel.LICENSE_INCLUDED,
            securityGroups: [rdssecuritygroup]
        });

        var sqlSeeder = new SqlServerSeeder(this, "sql-seeder", {
            vpc: theVPC,
            database: instance,
            port: 1433,
            createScriptPath: "resources/rds_sqlserver.sql",
            memorySize: 512
        })

        const readSSMParamsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:GetParametersByPath',
                'ssm:GetParameters',
                'ssm:GetParameter'
            ],
            resources: ['*']
        });

        const rdsAccessPolicy = iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonRDSFullAccess', 'arn:aws:iam::aws:policy/AmazonRDSFullAccess');

        // PayForAdoption service definitions-----------------------------------------------------------------------
        const payForAdoptionService = new PayForAdoptionService(this, 'pay-for-adoption-service', {
            cluster: new ecs.Cluster(this, "PayForAdoption", {
                vpc: theVPC,
                containerInsights: true
            }),
            logGroupName: "/ecs/PayForAdoption",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            database: instance
        });
        payForAdoptionService.taskDefinition.taskRole?.addManagedPolicy(rdsAccessPolicy);
        payForAdoptionService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        // PetListAdoptions service definitions-----------------------------------------------------------------------
        const listAdoptionsService = new ListAdoptionsService(this, 'list-adoptions-service', {
            cluster: new ecs.Cluster(this, "PetListAdoptions", {
                vpc: theVPC,
                containerInsights: true
            }),
            logGroupName: "/ecs/PetListAdoptions",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            database: instance
        });
        listAdoptionsService.taskDefinition.taskRole?.addManagedPolicy(rdsAccessPolicy);
        listAdoptionsService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        const isEKS = this.node.tryGetContext('petsite_on_eks');

        // Check if PetSite needs to be deployed on an EKS cluster
        if (isEKS === 'true') {
            const asset = new DockerImageAsset(this, 'petsiteecrimage', {
                directory: path.join('../../petsite/', 'petsite')
            });

            const clusterAdmin = new iam.Role(this, 'AdminRole', {
                assumedBy: new iam.AccountRootPrincipal()
            });

            const cluster = new eks.Cluster(this, 'petsite', {
                clusterName: 'PetSite',
                kubectlEnabled: true,
                mastersRole: clusterAdmin,
                vpc: theVPC,
                version: KubernetesVersion.V1_16
            });

            sqlSeeder.node.addDependency(cluster);

            this.createOuputs(new Map(Object.entries({
                'PetSiteECRImageURL': asset.imageUri
            })));
        }
        else {
            // PetSite service definitions-----------------------------------------------------------------------
            const petSiteService = new PetSiteService(this, 'pet-site-service', {
                cluster: new ecs.Cluster(this, "PetSite", {
                    vpc: theVPC,
                    containerInsights: true
                }),
                logGroupName: "/ecs/PetSite",
                cpu: 1024,
                memoryLimitMiB: 2048,
                healthCheck: '/health/status'
            })
            petSiteService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

            this.createSsmParameters(new Map(Object.entries({
                '/petstore/petsiteurl': `http://${petSiteService.service.loadBalancer.loadBalancerDnsName}`
            })));
        }

        // PetSearch service definitions-----------------------------------------------------------------------
        const searchService = new SearchService(this, 'search-service', {
            cluster: new ecs.Cluster(this, "PetSearch", {
                vpc: theVPC,
                containerInsights: true
            }),
            logGroupName: "/ecs/PetSearch",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status'
        })
        searchService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        // Traffic Generator task definition.
        const trafficGeneratorService = new TrafficGeneratorService(this, 'traffic-generator-service', {
            logGroupName: "/ecs/PetTrafficGenerator",
            cpu: 256,
            memoryLimitMiB: 512,
            disableXRay: true,
            disableService: true // Only creates a task definition. Doesn't deploy a service or start a task. That's left to the user.     
        })
        trafficGeneratorService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        //PetStatusUpdater Lambda Function and APIGW--------------------------------------
        const statusUpdaterService = new StatusUpdaterService(this, 'status-updater-service', {
            tableName: dynamodb_petadoption.tableName
        });

        const petAdoptionsStepFn = new PetAdoptionsStepFn(this,'StepFn');

        this.createSsmParameters(new Map(Object.entries({
            '/petstore/petadoptionsstepfnarn': petAdoptionsStepFn.stepFn.stateMachineArn,
            '/petstore/updateadoptionstatusurl': statusUpdaterService.api.url,
            '/petstore/queueurl': sqsQueue.queueUrl,
            '/petstore/snsarn': topic_petadoption.topicArn,
            '/petstore/dynamodbtablename': dynamodb_petadoption.tableName,
            '/petstore/s3bucketname': s3_observabilitypetadoptions.bucketName,
            '/petstore/searchapiurl': `http://${searchService.service.loadBalancer.loadBalancerDnsName}/api/search?`,
            '/petstore/petlistadoptionsurl': `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
            '/petstore/paymentapiurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/completeadoption`,
            '/petstore/cleanupadoptionsurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/cleanupadoptions`,
            '/petstore/rdssecretarn': `${instance.secret?.secretArn}`,
            '/petstore/rdsendpoint': instance.dbInstanceEndpointAddress,
            '/petstore/stackname': stackName
        })));

        this.createOuputs(new Map(Object.entries({
            'QueueURL': sqsQueue.queueUrl,
            'UpdateAdoptionStatusurl': statusUpdaterService.api.url,
            'SNSTopicARN': topic_petadoption.topicArn,
            'RDSServerName': instance.dbInstanceEndpointAddress
        })));
    }

    private createSsmParameters(params: Map<string, string>) {
        params.forEach((value, key) => {
            //const id = key.replace('/', '_');
            new ssm.StringParameter(this, key, { parameterName: key, stringValue: value });
        });
    }

    private createOuputs(params: Map<string, string>) {
        params.forEach((value, key) => {
            new cdk.CfnOutput(this, key, { value: value })
        });
    }
}
