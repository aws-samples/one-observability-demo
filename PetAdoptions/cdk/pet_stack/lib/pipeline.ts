import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ServiceStage } from './servicesStage';

export interface CDKPipelineProps extends cdk.StackProps {
    sourceBucketName: string;
    branchName: string;
};

export class CDKPipeline extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CDKPipelineProps) {
        super(scope, id, props);

        const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', props.sourceBucketName);

        const synthStep = new CodeBuildStep('SynthStep', {
            input: CodePipelineSource.s3(sourceBucket,'Repository.zip'),
            env: {
                'SOURCE_BUCKET_NAME':props.sourceBucketName,
                'GITHUB_BRANCH':props.branchName
            },
            commands: [
                    `cd one-observability-demo-${props.branchName}/PetAdoptions/cdk/pet_stack`,
                    'npm install',
                    'npm ci', 
                    'npm run build', 
                    'npx cdk synth'],
            rolePolicyStatements: [
                        new PolicyStatement({
                          actions: [
                            'logs:CreateLogGroup',
                            'logs:CreateLogStream',
                            'logs:PutLogEvents',
                            'secretsmanager:*',
                            'lambda:*',
                            's3:*',
                            'ec2:DescribeAvailabilityZones',
                          ],
                          resources: ['*'],
                        }),
                      ],
            primaryOutputDirectory: `one-observability-demo-${props.branchName}/PetAdoptions/cdk/pet_stack/cdk.out`
            });

        const pipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName: 'PetAdoption',
            synth: synthStep
        });

        const serviceStage = pipeline.addStage(new ServiceStage(this, "Services", {
            env: { 
                account: process.env.CDK_DEFAULT_ACCOUNT, 
                region: process.env.CDK_DEFAULT_REGION 
            }
        }));
    }
};