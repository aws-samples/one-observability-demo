import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodeBuildStep, CodePipeline, CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ImageBuilderStage } from './imageBuilderStage';
import { ImageBuildStep } from './constructs/imageBuiltStep';
import { ServiceStage } from './servicesStage';
import { ApplicationsStage } from './applicationsStage';

export interface CDKPipelineProps extends cdk.StackProps {
    sourceBucketName: string;
    branchName: string;
};

export class CDKPipeline extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CDKPipelineProps) {
        super(scope, id, props);

        const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', props.sourceBucketName);

        const source = CodePipelineSource.s3(sourceBucket,'Repository.zip');

        const synthStep = new CodeBuildStep('SynthStep', {
            input: source,
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

        const pipeline = new CodePipeline(this, 'CodePipeline', {
            pipelineName: 'OneObservabilityWorkshopPipeline',
            synth: synthStep
        });

        const coreStage = new ImageBuilderStage(scope, "Repositories", {});
        pipeline.addStage(coreStage);

        const imageBuildSteps = new Array<CodeBuildStep>();

        coreStage.repoList.forEach((value, key) => {
            imageBuildSteps.push(new ImageBuildStep(key, {
                repositoryName: key,
                repositoryUri: value,
                source: source,
                account: this.account,
                region: this.region,
                branchName: props.branchName,
            }));
        });
        
        const imageWave = pipeline.addWave("ImageBuildWave", {
            post: imageBuildSteps,
        });
        
        const serviceStage = pipeline.addStage(new ServiceStage(scope, "Services", {
            env: { 
                account: process.env.CDK_DEFAULT_ACCOUNT, 
                region: process.env.CDK_DEFAULT_REGION 
            }
        }));

        const applicationStage = pipeline.addStage(new ApplicationsStage(scope, "Applications", {
            env: { 
                account: process.env.CDK_DEFAULT_ACCOUNT, 
                region: process.env.CDK_DEFAULT_REGION 
            }            
        }));
    }
};