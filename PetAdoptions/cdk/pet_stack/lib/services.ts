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
import * as yaml from 'js-yaml';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';

import { SqlServerSeeder } from 'cdk-sqlserver-seeder'
import { PayForAdoptionService } from './services/pay-for-adoption-service'
import { ListAdoptionsService } from './services/list-adoptions-service'
import { PetSiteService } from './services/pet-site-service'
import { SearchService } from './services/search-service'
import { TrafficGeneratorService } from './services/traffic-generator-service'
import { StatusUpdaterService } from './services/status-updater-service'
import { PetAdoptionsStepFn } from './services/stepfn'
import path = require('path');
import { KubernetesVersion } from '@aws-cdk/aws-eks';
import { CfnJson, RemovalPolicy, Fn } from '@aws-cdk/core';
import { readFileSync } from 'fs';

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
        var topic_email = this.node.tryGetContext('snstopic_email');
        if (topic_email == undefined)
        {
            topic_email = "someone@example.com";
        }
        topic_petadoption.addSubscription(new subs.EmailSubscription(topic_email));

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


        var cidrRange = this.node.tryGetContext('vpc_cidr');
        if (cidrRange == undefined)
        {
            cidrRange = "11.0.0.0/16";
        }
        // The VPC where all the microservices will be deployed into
        const theVPC = new ec2.Vpc(this, 'Microservices', {
            cidr: cidrRange,
            natGateways: 1,
            maxAzs: 2
        });

        // Create RDS SQL Server DB instance

        const rdssecuritygroup = new ec2.SecurityGroup(this, 'petadoptionsrdsSG', {
            vpc: theVPC
        });

        rdssecuritygroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(1433), 'allow MSSQL access from the world');

        var rdsUsername = this.node.tryGetContext('rdsusername');
        if (rdsUsername == undefined)
        {
            rdsUsername = "petadmin"
        }
        const instance = new rds.DatabaseInstance(this, 'Instance', {
            engine: rds.DatabaseInstanceEngine.sqlServerWeb({version:rds.SqlServerEngineVersion.VER_15} ),
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
                'ssm:GetParameter',
                'ec2:DescribeVpcs'
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
            instrumentation: 'otel',
            database: instance
        });
        listAdoptionsService.taskDefinition.taskRole?.addManagedPolicy(rdsAccessPolicy);
        listAdoptionsService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        
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
            instrumentation: 'none',
            disableService: true // Only creates a task definition. Doesn't deploy a service or start a task. That's left to the user.     
        })
        trafficGeneratorService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);       
        
        //PetStatusUpdater Lambda Function and APIGW--------------------------------------
        const statusUpdaterService = new StatusUpdaterService(this, 'status-updater-service', {
            tableName: dynamodb_petadoption.tableName
        });        

        var isEKS = 'true';
        if (this.node.tryGetContext('petsite_on_eks') != undefined)
        {
            isEKS = this.node.tryGetContext('petsite_on_eks');
        }

        // Check if PetSite needs to be deployed on an EKS cluster
        if (isEKS === 'true') {
            const region = process.env.AWS_REGION ;
            const asset = new DockerImageAsset(this, 'petsiteecrimage', {
                directory: path.join('../../petsite/', 'petsite')
            });

            const albSG = new ec2.SecurityGroup(this,'ALBSecurityGrouo',{
                vpc: theVPC,
                securityGroupName: 'ALBSecurityGroup',
                allowAllOutbound: true
            });
            albSG.addIngressRule(ec2.Peer.anyIpv4(),ec2.Port.allTraffic());

            // Create ALB and Target Groups
            const alb = new elbv2.ApplicationLoadBalancer(this, 'PetSiteLoadBalancer', {
                vpc: theVPC,
                internetFacing: true,
                securityGroup: albSG
            });

            const targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetSiteTargetGroup', {
                port: 80,
                protocol: elbv2.ApplicationProtocol.HTTP,
                vpc: theVPC,
                targetType: elbv2.TargetType.IP
                
            });

            const listener = alb.addListener('Listener', {
                port: 80,
                open: true,
                defaultTargetGroups: [targetGroup],
            });          

            const clusterAdmin = new iam.Role(this, 'AdminRole', {
                assumedBy: new iam.AccountRootPrincipal()
            });

            const cluster = new eks.Cluster(this, 'petsite', {
                clusterName: 'PetSite',
                kubectlEnabled: true,
                mastersRole: clusterAdmin,
                vpc: theVPC,
                version: KubernetesVersion.V1_17
            });         
            
            const clusterSG = ec2.SecurityGroup.fromSecurityGroupId(this,'ClusterSG',cluster.clusterSecurityGroupId);
            clusterSG.addIngressRule(albSG,ec2.Port.allTraffic(),'Allow traffic from the ALB');
            

            // TODO: Attach trust policy here instead of the bash file. The OIDC is not created unless is referenced (even if not used). This line will force the OIDC Provider registration
            const oidc = cluster.openIdConnectProvider.openIdConnectProviderArn;
            // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
            const clusterId = Fn.select(4, Fn.split('/', cluster.clusterOpenIdConnectIssuerUrl)) // Remove https:// from the URL as workaround to get ClusterID

            // cat > trust.json << EOF
            // {
            //   "Version": "2012-10-17",
            //   "Statement": [
            //     {
            //       "Effect": "Allow",
            //       "Principal": {
            //         "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
            //       },
            //       "Action": "sts:AssumeRoleWithWebIdentity",
            //       "Condition": {
            //         "StringEquals": {
            //           "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
            //         }
            //       }
            //     }
            //   ]
            // }
            // EOF

            const cw_federatedPrincipal = new iam.FederatedPrincipal(
                cluster.openIdConnectProvider.openIdConnectProviderArn,
                {
                    StringEquals: new CfnJson(this, "CW_FederatedPrincipalCondition", {
                        value: {
                            [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud` ]: "sts.amazonaws.com"
                        }
                    })
                }
            ); 
            const cw_trustRelationship = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [ cw_federatedPrincipal ],
                actions: ["sts:AssumeRoleWithWebIdentity"]
            });       

            // Create IAM roles for Service Accounts
            // Cloudwatch Agent SA
            const cwserviceaccount = new iam.Role(this, 'CWServiceAccount', {
//                assumedBy: eksFederatedPrincipal,
                assumedBy: new iam.AccountRootPrincipal(),
                managedPolicies: [ 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'CWServiceAccount-CloudWatchAgentServerPolicy', 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy') 
                ],
            });
            cwserviceaccount.assumeRolePolicy?.addStatements(cw_trustRelationship);

            const xray_federatedPrincipal = new iam.FederatedPrincipal(
                cluster.openIdConnectProvider.openIdConnectProviderArn,
                {
                    StringEquals: new CfnJson(this, "Xray_FederatedPrincipalCondition", {
                        value: {
                            [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud` ]: "sts.amazonaws.com"
                        }
                    })
                }
            ); 
            const xray_trustRelationship = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [ xray_federatedPrincipal ],
                actions: ["sts:AssumeRoleWithWebIdentity"]
            });                         
    
            // X-Ray Agent SA
            const xrayserviceaccount = new iam.Role(this, 'XRayServiceAccount', {
//                assumedBy: eksFederatedPrincipal,
                assumedBy: new iam.AccountRootPrincipal(),
                managedPolicies: [ 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'XRayServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess') 
                ],
            });
            xrayserviceaccount.assumeRolePolicy?.addStatements(xray_trustRelationship);

            const loadbalancer_federatedPrincipal = new iam.FederatedPrincipal(
                cluster.openIdConnectProvider.openIdConnectProviderArn,
                {
                    StringEquals: new CfnJson(this, "LB_FederatedPrincipalCondition", {
                        value: {
                            [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud` ]: "sts.amazonaws.com"
                        }
                    })
                }
            ); 
            const loadBalancer_trustRelationship = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [ loadbalancer_federatedPrincipal ],
                actions: ["sts:AssumeRoleWithWebIdentity"]
            });    

            const loadBalancerPolicyDoc = iam.PolicyDocument.fromJson(JSON.parse(readFileSync("./resources/load_balancer/iam_policy.json","utf8")));
            const loadBalancerPolicy = new iam.ManagedPolicy(this,'LoadBalancerSAPolicy', { document: loadBalancerPolicyDoc });    
            const loadBalancerserviceaccount = new iam.Role(this, 'LoadBalancerServiceAccount', {
//                assumedBy: eksFederatedPrincipal,
                assumedBy: new iam.AccountRootPrincipal(),
                managedPolicies: [loadBalancerPolicy]
            });
            
            loadBalancerserviceaccount.assumeRolePolicy?.addStatements(loadBalancer_trustRelationship);
                      

            const app_federatedPrincipal = new iam.FederatedPrincipal(
                cluster.openIdConnectProvider.openIdConnectProviderArn,
                {
                    StringEquals: new CfnJson(this, "App_FederatedPrincipalCondition", {
                        value: {
                            [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud` ]: "sts.amazonaws.com"
                        }
                    })
                }
            ); 
            const app_trustRelationship = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [ app_federatedPrincipal ],
                actions: ["sts:AssumeRoleWithWebIdentity"]
            }) 
            // FrontEnd SA (SSM, SQS, SNS)
            const petstoreserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
//                assumedBy: eksFederatedPrincipal,
                  assumedBy: new iam.AccountRootPrincipal(),
              managedPolicies: [ 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSSMFullAccess', 'arn:aws:iam::aws:policy/AmazonSSMFullAccess'), 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSQSFullAccess', 'arn:aws:iam::aws:policy/AmazonSQSFullAccess'), 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSNSFullAccess', 'arn:aws:iam::aws:policy/AmazonSNSFullAccess'), 
                    iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
                ],
            });
            petstoreserviceaccount.assumeRolePolicy?.addStatements(app_trustRelationship);


            const startStepFnExecutionPolicy = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'states:StartExecution'
                ],
                resources: ['*']
              });

            petstoreserviceaccount.addToPrincipalPolicy(startStepFnExecutionPolicy);
            
            // Fix for EKS Dashboard access

            const dashboardRoleYaml = yaml.safeLoadAll(readFileSync("./resources/dashboard.yaml","utf8"));

            const dashboardRoleArn = this.node.tryGetContext('dashboard_role_arn');
            if((dashboardRoleArn != undefined)&&(dashboardRoleArn.length > 0)) {
                const role = iam.Role.fromRoleArn(this, "DashboardRoleArn",dashboardRoleArn,{mutable:false});
                cluster.awsAuth.addRoleMapping(role,{groups:["dashboard-view"]});
            }
            
            const dahshboardManifest = new eks.KubernetesManifest(this,"k8sdashboardrbac",{
                cluster: cluster,
                manifest: dashboardRoleYaml
            });
            
            
            var xRayJson = JSON.parse(readFileSync("../../petsite/petsite/kubernetes/xray-daemon/xray-daemon-config.json","utf8"));
            
            xRayJson.items[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "xray_Role", { value : `${xrayserviceaccount.roleArn}` });            
            
            const xrayManifest = new eks.KubernetesManifest(this,"xraydeployment",{
                cluster: cluster,
                manifest: [xRayJson]
            });            

            var loadBalancerServiceAccountYaml  = yaml.safeLoadAll(readFileSync("./resources/load_balancer/service_account.yaml","utf8"));
            loadBalancerServiceAccountYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "loadBalancer_Role", { value : `${loadBalancerserviceaccount.roleArn}` });

            const loadBalancerServiceAccount = new eks.KubernetesManifest(this, "loadBalancerServiceAccount",{
                cluster: cluster,
                manifest: loadBalancerServiceAccountYaml
            });
            
            const loadBalancerCRDYaml = yaml.safeLoadAll(readFileSync("./resources/load_balancer/crds.yaml","utf8"));
            const loadBalancerCRDManifest = new eks.KubernetesManifest(this,"loadBalancerCRD",{
                cluster: cluster,
                manifest: loadBalancerCRDYaml
            });        
            
            const awsLoadBalancerManifest = new eks.HelmChart(this, "AWSLoadBalancerController", {
               cluster: cluster,
               chart: "aws-load-balancer-controller",
               repository: "https://aws.github.io/eks-charts",
               namespace: "kube-system",
               values: {
                clusterName:"PetSite",
                serviceAccount:{
                    create: false,
                    name: "alb-ingress-controller"
                },
                wait: true
               }
            });
            awsLoadBalancerManifest.node.addDependency(loadBalancerCRDManifest);  
            awsLoadBalancerManifest.node.addDependency(loadBalancerServiceAccount);         
            
            var deploymentJson = JSON.parse(readFileSync("../../petsite/petsite/kubernetes/deployment.json","utf8"));
            
            deploymentJson.items[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "deployment_Role", { value : `${petstoreserviceaccount.roleArn}` });
            deploymentJson.items[2].spec.template.spec.containers[0].image = new CfnJson(this, "deployment_Image", { value : `${asset.imageUri}` });
            deploymentJson.items[2].spec.template.spec.containers[0].env = [
                  {
                    "name": "AWS_XRAY_DAEMON_ADDRESS",
                    "value": "xray-service.default:2000"
                  },
                  {
                    "name": "SEARCH_API_URL",
                    "value": new CfnJson(this, "deployment_EnvSearch", { value: `http://${searchService.service.loadBalancer.loadBalancerDnsName}/api/search?`})
                  },
                  {
                    "name": "UPDATE_ADOPTION_STATUS_URL",
                    "value": new CfnJson(this, "deployment_EnvUpdate", { value: `${statusUpdaterService.api.url}`})
                  },
                  {
                    "name": "PAYMENT_API_URL",
                    "value": new CfnJson(this, "deployment_EnvApi", { value: `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/completeadoption`})
                  },
                  {
                    "name": "QUEUE_URL",
                    "value": new CfnJson(this, "deployment_EnvQueue", { value: `${sqsQueue.queueUrl}` })
                  },
                  {
                    "name": "SNS_ARN",
                    "value": new CfnJson(this, "deployment_EnvSns", { value: `topic_petadoption.topicArn` })
                  },
                  {
                    "name": "PET_LIST_ADOPTION_URL",
                    "value": new CfnJson(this, "deployment_EnvPetlist", { value: `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/api/adoptionlist/` })
                  },
                  {
                    "name": "CLEANUP_ADOPTIONS_URL",
                    "value":  new CfnJson(this, "deployment_EnvAdopt", { value: `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/cleanupadoptions` })
                  }
            ];
            deploymentJson.items[3].spec.targetGroupARN = new CfnJson(this,"targetgroupArn", { value: `${targetGroup.targetGroupArn}`});
            

            const deploymentManifest = new eks.KubernetesManifest(this,"petsitedeployment",{
                cluster: cluster,
                manifest: [deploymentJson]
            });
            deploymentManifest.node.addDependency(xrayManifest);
            deploymentManifest.node.addDependency(awsLoadBalancerManifest);


            
            var prometheusJson = JSON.parse(readFileSync("./resources/prometheus-eks.json","utf8"));
            
            prometheusJson.items[1].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "prometheus_Role", { value : `${cwserviceaccount.roleArn}` });            
            
            const prometheusManifest = new eks.KubernetesManifest(this,"prometheusdeployment",{
                cluster: cluster,
                manifest: [prometheusJson]
            });        
            

            
            var fluentdJson = JSON.parse(readFileSync("./resources/cwagent-fluentd-quickstart.json","utf8"));
            fluentdJson.items[1].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "cloudwatch_Role", { value : `${cwserviceaccount.roleArn}` });     
            fluentdJson.items[2].data = {
                "cluster.name" : "Petsite",
                "logs.region" : region
            };
            

            fluentdJson.items[3].data["cwagentconfig.json"] = JSON.stringify({
                agent: {
                    region: region  },
                logs: {  
                    metrics_collected: {
                        kubernetes: {
                            cluster_name: "Petsite",
                            metrics_collection_interval: 60
                        }
                    },
                    force_flush_interval: 5
                    
                    }
                
                });
            
            const fluentdManifest = new eks.KubernetesManifest(this,"cloudwatcheployment",{
                cluster: cluster,
                manifest: [fluentdJson]
            });       
            
            

            sqlSeeder.node.addDependency(cluster);

            this.createSsmParameters(new Map(Object.entries({
                '/petstore/petsiteurl': `http://${alb.loadBalancerDnsName}`
            })));

            this.createOuputs(new Map(Object.entries({
                'PetSiteECRImageURL': asset.imageUri,
                'CWServiceAccountArn': cwserviceaccount.roleArn,
                'XRayServiceAccountArn': xrayserviceaccount.roleArn,
                'PetStoreServiceAccountArn': petstoreserviceaccount.roleArn,
                'OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
                'PetSiteUrl': `http://${alb.loadBalancerDnsName}` 
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
