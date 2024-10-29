import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export interface CDKPipelineProps extends cdk.StackProps {
    sourceBucketName: string;
    branchName: string;
};

export class CDKPipeline extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CDKPipelineProps) {
        super(scope, id, props);

        const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', props.sourceBucketName);

        const pipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName: 'PetAdoption',
            synth: new ShellStep('SynthStep', {
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
                        'npx cdk synth']
            })
        });
    }
};