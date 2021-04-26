import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ssm from '@aws-cdk/aws-ssm';
import * as eks from '@aws-cdk/aws-eks';
import * as yaml from 'js-yaml';
import { CfnJson, Fn } from '@aws-cdk/core';
import { readFileSync } from 'fs';

export class Applications extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope,id,props);

    const stackName = id;

    const roleArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamClusterAdmin', { parameterName: "/eks/petsite/EKSMasterRoleArn"}).stringValue;
    const targetGroupArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamTargetGroupArn', { parameterName: "/eks/petsite/TargetGroupArn"}).stringValue;
    const oidcProviderUrl = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderUrl', { parameterName: "/eks/petsite/OIDCProviderUrl"}).stringValue;
    const oidcProviderArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderArn', { parameterName: "/eks/petsite/OIDCProviderArn"}).stringValue;

    const cluster = eks.Cluster.fromClusterAttributes(this, 'MyCluster', {
      clusterName: 'PetSite',
      kubectlRoleArn: roleArn,
    });
    // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
    // Thsos might be an issue
    const clusterId = Fn.select(4, Fn.split('/', oidcProviderUrl)) // Remove https:// from the URL as workaround to get ClusterID

    const stack = cdk.Stack.of(this);
    const region = stack.region;

    const app_federatedPrincipal = new iam.FederatedPrincipal(
        oidcProviderArn,
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

    const repositoryURI = "public.ecr.aws/one-observability-workshop";
    const petSiteECRImageURL = `${repositoryURI}/pet-site:latest`


    var deploymentYaml = yaml.safeLoadAll(readFileSync("./resources/k8s_petsite/deployment.yaml","utf8"));


    deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "deployment_Role", { value : `${petstoreserviceaccount.roleArn}` });
    deploymentYaml[2].spec.template.spec.containers[0].image = new CfnJson(this, "deployment_Image", { value : `${petSiteECRImageURL}` });
    deploymentYaml[3].spec.targetGroupARN = new CfnJson(this,"targetgroupArn", { value: `${targetGroupArn}`});


    const deploymentManifest = new eks.KubernetesManifest(this,"petsitedeployment",{
        cluster: cluster,
        manifest: deploymentYaml
    });


    this.createSsmParameters(new Map(Object.entries({
        '/eks/petsite/stackname': stackName
    })));

    this.createOuputs(new Map(Object.entries({
        'PetSiteECRImageURL': petSiteECRImageURL,
        'PetStoreServiceAccountArn': petstoreserviceaccount.roleArn,
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
