import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as yaml from 'js-yaml';
import { CfnJson } from 'aws-cdk-lib';
import { EksApplication, EksApplicationProps } from './eks-application'
import { readFileSync } from 'fs';
import { Construct } from 'constructs'

export interface PetAdoptionsHistoryProps extends EksApplicationProps {
    rdsSecretArn:   string,
    targetGroupArn: string,
}

export class PetAdoptionsHistory extends EksApplication {

  constructor(scope: Construct, id: string, props: PetAdoptionsHistoryProps) {
    super(scope, id, props);

    const petadoptionhistoryserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
//        assumedBy: eksFederatedPrincipal,
        assumedBy: new iam.AccountRootPrincipal(),
        managedPolicies: [
            iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetAdoptionHistoryServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
        ],
    });
    petadoptionhistoryserviceaccount.assumeRolePolicy?.addStatements(props.app_trustRelationship);

    const readSSMParamsPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "ssm:GetParametersByPath",
            "ssm:GetParameters",
            "ssm:GetParameter",
            "ec2:DescribeVpcs"
        ],
        resources: ['*']
    });
    petadoptionhistoryserviceaccount.addToPolicy(readSSMParamsPolicy);

    const ddbSeedPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "dynamodb:BatchWriteItem",
            "dynamodb:ListTables",
            "dynamodb:Scan",
            "dynamodb:Query"
        ],
        resources: ['*']
    });
    petadoptionhistoryserviceaccount.addToPolicy(ddbSeedPolicy);

    const rdsSecretPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "secretsmanager:GetSecretValue"
        ],
        resources: [props.rdsSecretArn]
    });
    petadoptionhistoryserviceaccount.addToPolicy(rdsSecretPolicy);

    const awsOtelPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
			"logs:PutLogEvents",
			"logs:CreateLogGroup",
			"logs:CreateLogStream",
			"logs:DescribeLogStreams",
			"logs:DescribeLogGroups",
			"xray:PutTraceSegments",
			"xray:PutTelemetryRecords",
			"xray:GetSamplingRules",
			"xray:GetSamplingTargets",
			"xray:GetSamplingStatisticSummaries",
			"ssm:GetParameters"
        ],
        resources: ['*']
    });
    petadoptionhistoryserviceaccount.addToPolicy(awsOtelPolicy);

    var manifest = readFileSync(props.kubernetesManifestPath,"utf8");
    var deploymentYaml = yaml.loadAll(manifest) as Record<string,any>[];

    deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "deployment_Role", { value : petadoptionhistoryserviceaccount.roleArn });
    deploymentYaml[3].spec.template.spec.containers[0].image = new CfnJson(this, "deployment_Image", { value : props.imageUri });
    deploymentYaml[3].spec.template.spec.containers[0].env[1].value = new CfnJson(this, "aws_region", { value: props.region });
    deploymentYaml[3].spec.template.spec.containers[0].env[3].value = new CfnJson(this, "cluster_name", { value: `ClusterName=${props.cluster.clusterName}` });
    deploymentYaml[3].spec.template.spec.containers[0].env[5].value = new CfnJson(this, "s3_region", { value: props.region });
    deploymentYaml[3].spec.template.spec.containers[1].env[0].value = new CfnJson(this, "otel_region", { value: props.region });
    deploymentYaml[4].spec.targetGroupARN = new CfnJson(this, "targetgroupArn", { value: props.targetGroupArn });

    const deploymentManifest = new eks.KubernetesManifest(this,"petsitedeployment",{
        cluster: props.cluster,
        manifest: deploymentYaml
    });
  }

}
