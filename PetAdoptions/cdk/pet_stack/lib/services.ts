import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as sns from '@aws-cdk/aws-sns'
import * as sqs from '@aws-cdk/aws-sqs'
import * as subs from '@aws-cdk/aws-sns-subscriptions'
import * as ddb from '@aws-cdk/aws-dynamodb'
import * as s3 from '@aws-cdk/aws-s3'
import * as s3seeder from '@aws-cdk/aws-s3-deployment'
import * as rds from '@aws-cdk/aws-rds';
import * as ssm from '@aws-cdk/aws-ssm';
import * as eks from '@aws-cdk/aws-eks';
import * as yaml from 'js-yaml';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as cloud9 from '@aws-cdk/aws-cloud9';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';

import { PayForAdoptionService } from './services/pay-for-adoption-service'
import { ListAdoptionsService } from './services/list-adoptions-service'
import { SearchService } from './services/search-service'
import { TrafficGeneratorService } from './services/traffic-generator-service'
import { StatusUpdaterService } from './services/status-updater-service'
import { PetAdoptionsStepFn } from './services/stepfn'
import { KubernetesVersion } from '@aws-cdk/aws-eks';
import { CfnJson, RemovalPolicy, Fn, Duration } from '@aws-cdk/core';
import { readFileSync } from 'fs';
import 'ts-replace-all'


export class Services extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        var isEventEngine = 'false';
        if (this.node.tryGetContext('is_event_engine') != undefined)
        {
            isEventEngine = this.node.tryGetContext('is_event_engine');
        }

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

        // Create RDS Aurora PG cluster
        const rdssecuritygroup = new ec2.SecurityGroup(this, 'petadoptionsrdsSG', {
            vpc: theVPC
        });

        rdssecuritygroup.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Aurora PG access from within the VPC CIDR range');

        var rdsUsername = this.node.tryGetContext('rdsusername');
        if (rdsUsername == undefined)
        {
            rdsUsername = "petadmin"
        }

        const auroraCluster = new rds.ServerlessCluster(this, 'Database', {
            engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
            parameterGroup: rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
            vpc: theVPC,
            securityGroups: [rdssecuritygroup],
            defaultDatabaseName: 'adoptions',
            scaling: {
                autoPause: Duration.minutes(60),
                minCapacity: rds.AuroraCapacityUnit.ACU_2,
                maxCapacity: rds.AuroraCapacityUnit.ACU_8,
            }
        });

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


        const ddbSeedPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:BatchWriteItem',
                'dynamodb:ListTables',
                "dynamodb:Scan",
                "dynamodb:Query"
            ],
            resources: ['*']
        });

        const repositoryURI = "public.ecr.aws/one-observability-workshop";

        const stack = cdk.Stack.of(this);
        const region = stack.region;

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
            // build locally
            //repositoryURI: repositoryURI,
            database: auroraCluster,
            desiredTaskCount : 2,
            region: region
        });
        payForAdoptionService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        payForAdoptionService.taskDefinition.taskRole?.addToPrincipalPolicy(ddbSeedPolicy);


        const ecsPetListAdoptionCluster = new ecs.Cluster(this, "PetListAdoptions", {
            vpc: theVPC,
            containerInsights: true
        });
        // PetListAdoptions service definitions-----------------------------------------------------------------------
        const listAdoptionsService = new ListAdoptionsService(this, 'list-adoptions-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetListAdoptions",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            instrumentation: 'otel',
            // build locally
            //repositoryURI: repositoryURI,
            database: auroraCluster,
            desiredTaskCount: 2,
            region: region
        });
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
            //repositoryURI: repositoryURI,
            healthCheck: '/health/status',
            desiredTaskCount: 2,
            instrumentation: 'otel',
            region: region
        })
        searchService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        // Traffic Generator task definition.
        const trafficGeneratorService = new TrafficGeneratorService(this, 'traffic-generator-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetTrafficGenerator",
            cpu: 256,
            memoryLimitMiB: 512,
            instrumentation: 'none',
            //repositoryURI: repositoryURI,
            desiredTaskCount: 1,
            region: region
        })
        trafficGeneratorService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);

        //PetStatusUpdater Lambda Function and APIGW--------------------------------------
        const statusUpdaterService = new StatusUpdaterService(this, 'status-updater-service', {
            tableName: dynamodb_petadoption.tableName
        });


        const albSG = new ec2.SecurityGroup(this,'ALBSecurityGroup',{
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
        trafficGeneratorService.node.addDependency(alb);

        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetSiteTargetGroup', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            vpc: theVPC,
            targetType: elbv2.TargetType.IP

        });

        new ssm.StringParameter(this,"putParamTargetGroupArn",{
            stringValue: targetGroup.targetGroupArn,
            parameterName: '/eks/petsite/TargetGroupArn'
          })

        const listener = alb.addListener('Listener', {
            port: 80,
            open: true,
            defaultTargetGroups: [targetGroup],
        });

        const clusterAdmin = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });

        new ssm.StringParameter(this,"putParam",{
            stringValue: clusterAdmin.roleArn,
            parameterName: '/eks/petsite/EKSMasterRoleArn'
          })

        const cluster = new eks.Cluster(this, 'petsite', {
            clusterName: 'PetSite',
            mastersRole: clusterAdmin,
            vpc: theVPC,
            defaultCapacity: 2,
            defaultCapacityInstance: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
            version: KubernetesVersion.V1_19
        });

        const clusterSG = ec2.SecurityGroup.fromSecurityGroupId(this,'ClusterSG',cluster.clusterSecurityGroupId);
        clusterSG.addIngressRule(albSG,ec2.Port.allTraffic(),'Allow traffic from the ALB');
        clusterSG.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock),ec2.Port.tcp(443),'Allow local access to k8s api');


        // Add SSM Permissions to the node role
        cluster.defaultNodegroup?.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));

        // From https://github.com/aws-samples/ssm-agent-daemonset-installer
        var ssmAgentSetup = yaml.safeLoadAll(readFileSync("./resources/setup-ssm-agent.yaml","utf8"));

        const ssmAgentSetupManifest = new eks.KubernetesManifest(this,"ssmAgentdeployment",{
            cluster: cluster,
            manifest: ssmAgentSetup
        });



        // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
        const clusterId = Fn.select(4, Fn.split('/', cluster.clusterOpenIdConnectIssuerUrl)) // Remove https:// from the URL as workaround to get ClusterID

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

        // Fix for EKS Dashboard access

        const dashboardRoleYaml = yaml.safeLoadAll(readFileSync("./resources/dashboard.yaml","utf8"));

        const dashboardRoleArn = this.node.tryGetContext('dashboard_role_arn');
        if((dashboardRoleArn != undefined)&&(dashboardRoleArn.length > 0)) {
            const role = iam.Role.fromRoleArn(this, "DashboardRoleArn",dashboardRoleArn,{mutable:false});
            cluster.awsAuth.addRoleMapping(role,{groups:["dashboard-view"]});
        }

        if (isEventEngine === 'true')
        {
            var c9role = undefined
            var c9InstanceProfile = undefined
            var c9env = undefined


            c9env = new cloud9.CfnEnvironmentEC2(this,"CloudEnv",{
                ownerArn: "arn:aws:iam::" + stack.account +":assumed-role/TeamRole/MasterKey",
                instanceType: "t2.micro",
                name: "observabilityworkshop",
                subnetId: theVPC.publicSubnets[0].subnetId
            });

            c9role = new iam.Role(this,'cloud9InstanceRole', {
                assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")],
                roleName: "observabilityworkshop-admin"
            });

            c9InstanceProfile = new iam.CfnInstanceProfile(this,'cloud9InstanceProfile', {
                roles: [c9role.roleName],
                instanceProfileName: "observabilityworkshop-profile"
            })

            const teamRole = iam.Role.fromRoleArn(this,'TeamRole',"arn:aws:iam::" + stack.account +":role/TeamRole");
            cluster.awsAuth.addRoleMapping(teamRole,{groups:["dashboard-view"]});

            if (c9role!=undefined)
                cluster.awsAuth.addMastersRole(c9role)

            if (c9env!=undefined)
                cluster.node.addDependency(c9env)

        }

        const eksAdminArn = this.node.tryGetContext('admin_role');
        if ((eksAdminArn!=undefined)&&(eksAdminArn.length > 0)) {
            const role = iam.Role.fromRoleArn(this,"ekdAdminRoleArn",eksAdminArn,{mutable:false});
            cluster.awsAuth.addMastersRole(role)
        }

        const dahshboardManifest = new eks.KubernetesManifest(this,"k8sdashboardrbac",{
            cluster: cluster,
            manifest: dashboardRoleYaml
        });


        var xRayYaml = yaml.safeLoadAll(readFileSync("./resources/k8s_petsite/xray-daemon-config.yaml","utf8"));

        xRayYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "xray_Role", { value : `${xrayserviceaccount.roleArn}` });

        const xrayManifest = new eks.KubernetesManifest(this,"xraydeployment",{
            cluster: cluster,
            manifest: xRayYaml
        });

        var loadBalancerServiceAccountYaml  = yaml.safeLoadAll(readFileSync("./resources/load_balancer/service_account.yaml","utf8"));
        loadBalancerServiceAccountYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "loadBalancer_Role", { value : `${loadBalancerserviceaccount.roleArn}` });

        const loadBalancerServiceAccount = new eks.KubernetesManifest(this, "loadBalancerServiceAccount",{
            cluster: cluster,
            manifest: loadBalancerServiceAccountYaml
        });

        const waitForLBServiceAccount = new eks.KubernetesObjectValue(this,'LBServiceAccount',{
            cluster: cluster,
            objectName: "alb-ingress-controller",
            objectType: "serviceaccount",
            objectNamespace: "kube-system",
            jsonPath: "@"
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
        awsLoadBalancerManifest.node.addDependency(waitForLBServiceAccount);

        // NOTE: amazon-cloudwatch namespace is created here!!
        var fluentbitYaml = yaml.safeLoadAll(readFileSync("./resources/cwagent-fluent-bit-quickstart.yaml","utf8"));
        fluentbitYaml[1].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "fluentbit_Role", { value : `${cwserviceaccount.roleArn}` });

        fluentbitYaml[4].data["cwagentconfig.json"] = JSON.stringify({
            agent: {
                region: region  },
            logs: {
                metrics_collected: {
                    kubernetes: {
                        cluster_name: "PetSite",
                        metrics_collection_interval: 60
                    }
                },
                force_flush_interval: 5

                }

            });

        fluentbitYaml[6].data["cluster.name"] = "PetSite";
        fluentbitYaml[6].data["logs.region"] = region;
        fluentbitYaml[7].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "cloudwatch_Role", { value : `${cwserviceaccount.roleArn}` });


        const fluentbitManifest = new eks.KubernetesManifest(this,"cloudwatcheployment",{
            cluster: cluster,
            manifest: fluentbitYaml
        });

        var prometheusYaml = yaml.safeLoadAll(readFileSync("./resources/prometheus-eks.yaml","utf8"));

        prometheusYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "prometheus_Role", { value : `${cwserviceaccount.roleArn}` });

        const prometheusManifest = new eks.KubernetesManifest(this,"prometheusdeployment",{
            cluster: cluster,
            manifest: prometheusYaml
        });

        prometheusManifest.node.addDependency(fluentbitManifest); // Namespace creation dependency



        var dashboardBody = readFileSync("./resources/cw_dashboard_fluent_bit.json","utf-8");
        dashboardBody = dashboardBody.replaceAll("{{YOUR_CLUSTER_NAME}}","PetSite");
        dashboardBody = dashboardBody.replaceAll("{{YOUR_AWS_REGION}}",region);

        const fluentBitDashboard = new cloudwatch.CfnDashboard(this, "FluentBitDashboard", {
            dashboardName: "EKS_FluentBit_Dashboard",
            dashboardBody: dashboardBody
        });


        this.createOuputs(new Map(Object.entries({
            'CWServiceAccountArn': cwserviceaccount.roleArn,
            'XRayServiceAccountArn': xrayserviceaccount.roleArn,
            'OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            'OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            'PetSiteUrl': `http://${alb.loadBalancerDnsName}`
        })));


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
            '/petstore/rdssecretarn': `${auroraCluster.secret?.secretArn}`,
            '/petstore/rdsendpoint': auroraCluster.clusterEndpoint.hostname,
            '/petstore/stackname': stackName,
            '/petstore/petsiteurl': `http://${alb.loadBalancerDnsName}`,
            '/eks/petsite/OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            '/eks/petsite/OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            '/petstore/errormode1':"false"
        })));

        this.createOuputs(new Map(Object.entries({
            'QueueURL': sqsQueue.queueUrl,
            'UpdateAdoptionStatusurl': statusUpdaterService.api.url,
            'SNSTopicARN': topic_petadoption.topicArn,
            'RDSServerName': auroraCluster.clusterEndpoint.hostname
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
