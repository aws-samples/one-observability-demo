import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as yaml from 'js-yaml';
import { CfnJson } from 'aws-cdk-lib';
import { EksApplication, EksApplicationProps } from './eks-application'
import { readFileSync } from 'fs';
import { Construct } from 'constructs'

export interface PetAdoptionsHistoryProps extends EksApplicationProps {
    rdsSecretArn:      string,
    targetGroupArn:    string,
    otelConfigMapPath: string,
}

export class PetAdoptionsHistory extends EksApplication {

  constructor(scope: Construct, id: string, props: PetAdoptionsHistoryProps) {
    super(scope, id, props);

    const petadoptionhistoryserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
//        assumedBy: eksFederatedPrincipal,
        assumedBy: new iam.AccountRootPrincipal(),
        managedPolicies: [
            iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetAdoptionHistoryServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'),
            iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetAdoptionHistoryServiceAccount-AmazonPrometheusRemoteWriteAccess', 'arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess')
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

    // otel collector config
    var otelConfigMapManifest = readFileSync(props.otelConfigMapPath,"utf8");
    var otelConfigMapYaml = yaml.loadAll(otelConfigMapManifest) as Record<string,any>[];
    otelConfigMapYaml[0].data["otel-config.yaml"] = otelConfigMapYaml[0].data["otel-config.yaml"].replace(/{{AWS_REGION}}/g, props.region);

    const otelConfigDeploymentManifest = new eks.KubernetesManifest(this,"otelConfigDeployment",{
        cluster: props.cluster,
        manifest: otelConfigMapYaml
    });

    // deployment manifest
    var manifest = readFileSync(props.kubernetesManifestPath,"utf8");
    var deploymentYaml = yaml.loadAll(manifest) as Record<string,any>[];

    deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = petadoptionhistoryserviceaccount.roleArn;
    deploymentYaml[2].spec.template.spec.containers[0].image = props.imageUri;
    deploymentYaml[2].spec.template.spec.containers[0].env[1].value = props.region;
    deploymentYaml[2].spec.template.spec.containers[0].env[3].value = `ClusterName=${props.cluster.clusterName}`;
    deploymentYaml[2].spec.template.spec.containers[0].env[5].value = props.region;
    deploymentYaml[2].spec.template.spec.containers[1].env[0].value = props.region;
    deploymentYaml[3].spec.targetGroupARN = props.targetGroupArn;

    const deploymentManifest = new eks.KubernetesManifest(this,"petsitedeployment",{
        cluster: props.cluster,
        manifest: deploymentYaml
    });
  }

}
