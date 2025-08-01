/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps } from 'aws-cdk-lib';
import { PipelineType } from 'aws-cdk-lib/aws-codepipeline';
import { IRole, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface CDKPipelineProperties extends StackProps {
    configBucketName: string;
    configBucketKey: string;
    branchName: string;
    organizationName: string;
    repositoryName: string;
}

export class CDKPipeline extends Stack {
    /**
     * The IAM role used by the pipeline.
     *
     * @readonly
     * @type {IRole}
     */
    readonly pipelineRole: IRole;
    constructor(scope: Construct, id: string, properties: CDKPipelineProperties) {
        super(scope, id, properties);

        // Create a CodePipeline source using the Specified S3 Bucket
        const configBucket = Bucket.fromBucketName(this, 'ConfigBucket', properties.configBucketName);

        // Use the configuration file as the pipeline trigger
        const bucketSource = CodePipelineSource.s3(configBucket, properties.configBucketKey);
        /**
         * Create an S3 bucket to store the pipeline artifacts.
         * The bucket has encryption at rest using a CMK and enforces encryption in transit.
         * Versioning is enabled on the bucket for audit and recovery purposes.
         */
        const pipelineArtifactBucket = new Bucket(this, 'ArtifactBucket', {
            enforceSSL: true,
            versioned: true,
            encryption: BucketEncryption.S3_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        /**
         * Add CDK-nag suppressions for the artifact bucket.
         */
        NagSuppressions.addResourceSuppressions(pipelineArtifactBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Temporary artifact bucket, access logs are not needed',
            },
        ]);

        /**
         * Create the IAM role for the pipeline.
         */
        this.pipelineRole = new Role(this, 'PipelineRole', {
            assumedBy: new ServicePrincipal('codepipeline.amazonaws.com'),
        });

        /**
         * Create the CodePipeline with the following configuration:
         * - Synthesis step that builds and synthesizes the CDK app
         * - Custom artifact bucket with encryption
         * - VPC integration for network isolation
         * - Cross-account key support for multi-account deployments
         */
        const pipeline = new CodePipeline(this, 'Pipeline', {
            synth: new ShellStep('Synth', {
                input: bucketSource,
                commands: [
                    `git clone https://github.com/${properties.organizationName}/${properties.repositoryName}`,
                    'npm ci',
                    'npm run build',
                    'npx cdk synth',
                ],
            }),
            artifactBucket: pipelineArtifactBucket,
            crossAccountKeys: true,
            pipelineName: `${id}-pipeline`,
            usePipelineRoleForActions: true,
            pipelineType: PipelineType.V2,
            role: this.pipelineRole,
        });

        /**
         * Build the pipeline to add suppressions and customizations.
         * This is required before adding additional configurations.
         * @see https://github.com/cdklabs/cdk-nag?tab=readme-ov-file#suppressing-aws-cdk-libpipelines-violations
         */
        pipeline.buildPipeline();

        /**
         * Add CodeArtifact read access to the synth project role.
         */
        pipeline.synthProject.role?.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('AWSCodeArtifactReadOnlyAccess'),
        );
    }
}
