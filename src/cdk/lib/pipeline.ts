/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';
import { PipelineType } from 'aws-cdk-lib/aws-codepipeline';
import { IRole, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { CodeBuildStep, CodePipeline, CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { CoreStage, CoreStageProperties } from './stages/core';
import { Utilities } from './utils/utilities';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { S3Trigger } from 'aws-cdk-lib/aws-codepipeline-actions';
import { ContainerDefinition, ContainersPipelineStage } from './stages/containers';
import { StorageStage } from './stages/storage';
import { AuroraPostgresEngineVersion } from 'aws-cdk-lib/aws-rds';
import { ComputeStage } from './stages/compute';
import { MicroservicesStage, MicroserviceApplicationsProperties } from './stages/applications';

export interface CDKPipelineProperties extends StackProps {
    configBucketName: string;
    branchName: string;
    organizationName: string;
    repositoryName: string;
    workingFolder: string;
    tags?: { [key: string]: string };
    coreStageProperties?: CoreStageProperties;
    defaultRetentionPeriod?: RetentionDays;
    applicationList: ContainerDefinition[];
    petImagesPaths: string[];
    postgresEngineVersion?: AuroraPostgresEngineVersion;
    microservicesProperties: MicroserviceApplicationsProperties;
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
        const bucketKey = `repo/refs/heads/${properties.branchName}/repo.zip`;

        // Use the configuration file as the pipeline trigger
        const bucketSource = CodePipelineSource.s3(configBucket, bucketKey, {
            trigger: S3Trigger.POLL,
        });
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
         * Grant access to the source bucket for the pipeline role.
         */
        configBucket.grantRead(this.pipelineRole);

        const synthStep = new CodeBuildStep('Synth', {
            input: bucketSource,
            primaryOutputDirectory: `${properties.workingFolder}/cdk.out`,
            installCommands: ['npm i -g aws-cdk'],
            // Using globally installed CDK due to this issue https://github.com/aws/aws-cdk/issues/28519
            commands: ['. ./.env', `cd ${properties.workingFolder}`, 'npm ci', 'npm run build', 'cdk synth --all'],
            buildEnvironment: {
                buildImage: LinuxBuildImage.STANDARD_7_0,
            },
            partialBuildSpec: BuildSpec.fromObject({
                phases: {
                    install: {
                        'runtime-versions': {
                            nodejs: '22.x',
                        },
                    },
                },
            }),
        });
        /**
         * Create the CodePipeline with the following configuration:
         * - Synthesis step that builds and synthesizes the CDK app
         * - Custom artifact bucket with encryption
         * - VPC integration for network isolation
         * - Cross-account key support for multi-account deployments
         */
        const pipeline = new CodePipeline(this, 'Pipeline', {
            synth: synthStep,
            artifactBucket: pipelineArtifactBucket,
            crossAccountKeys: true,
            pipelineName: `${id}-pipeline`,
            usePipelineRoleForActions: true,
            pipelineType: PipelineType.V2,
            role: this.pipelineRole,
            codeBuildDefaults: {
                buildEnvironment: {
                    buildImage: LinuxBuildImage.STANDARD_7_0,
                    privileged: true,
                    environmentVariables: {
                        NODE_VERSION: {
                            value: '22.x',
                        },
                    },
                },
            },
        });

        const coreWave = pipeline.addWave('Core');

        let stageSequence = 1;
        const coreStageTags = {
            ...properties.tags,
            parent: this.stackName,
            sequence: (stageSequence++).toString(),
        };
        const coreProperties = properties.coreStageProperties
            ? { ...properties.coreStageProperties, tags: coreStageTags }
            : { tags: coreStageTags };

        const coreStage = new CoreStage(this, 'Core', coreProperties);
        coreWave.addStage(coreStage);

        const applicationsStageTags = {
            ...properties.tags,
            parent: this.stackName,
            sequence: (stageSequence++).toString(),
        };
        coreWave.addStage(
            new ContainersPipelineStage(this, 'Applications', {
                applicationList: properties.applicationList,
                tags: applicationsStageTags,
                source: {
                    bucketName: properties.configBucketName,
                    bucketKey: bucketKey,
                },
            }),
        );

        const backendWave = pipeline.addWave('Backend');

        const storageStage = new StorageStage(this, 'Storage', {
            assetsProperties: {
                seedPaths: properties.petImagesPaths,
            },
            auroraDatabaseProperties: {
                engineVersion: properties.postgresEngineVersion,
            },
            tags: {
                ...properties.tags,
                parent: this.stackName,
                sequence: (stageSequence++).toString(),
            },
        });

        backendWave.addStage(storageStage);

        const computeStage = new ComputeStage(this, 'Compute', {
            tags: {
                ...properties.tags,
                parent: this.stackName,
                sequence: (stageSequence++).toString(),
            },
        });

        backendWave.addStage(computeStage);

        const microservicesStageTags = {
            ...properties.tags,
            parent: this.stackName,
            sequence: (stageSequence++).toString(),
        };

        pipeline.addStage(
            new MicroservicesStage(this, 'Microservices', {
                ...properties.microservicesProperties,
                tags: microservicesStageTags,
            }),
        );

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

        /**
         * Add CDK-nag suppressions for the pipeline role.
         */
        NagSuppressions.addResourceSuppressions(
            pipeline.pipeline.role,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The pipeline role is not scoped to a specific resource',
                },
            ],
            true,
        );

        /**
         * Add CDK-nag suppressions for the synth project.
         */
        NagSuppressions.addResourceSuppressions(
            pipeline.synthProject,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The pipeline role is not scoped to a specific resource',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS Managed policy is acceptable here',
                    appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AWSCodeArtifactReadOnlyAccess'],
                },
            ],
            true,
        );

        /**
         * Add CDK-nag suppressions for the self-mutation project.
         */
        NagSuppressions.addResourceSuppressions(
            pipeline.selfMutationProject,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Ephemeral Synth Project not limited to specific resource or action',
                },
            ],
            true,
        );

        /**
         * Add stack-level CDK-nag suppressions.
         * Added as stack suppression since path can change based on the context and repo name.
         * Suppression can also be limited by path but must be updated every time the repo changes.
         */
        NagSuppressions.addStackSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Ephemeral Synth Project not limited to specific resource or action',
                },
                {
                    id: 'AwsSolutions-CB4',
                    reason: 'CDK Pipelines uses CMKs with cross account / region. Omitted for simplicity.',
                },
            ],
            true,
        );

        /**
         * Generate PipelineArn Output with the self-mutating Pipeline ARN
         */
        new CfnOutput(this, 'PipelineArn', {
            value: pipeline.pipeline.pipelineArn,
            exportName: 'PipelineArn',
        });

        /**
         * Tag all child resources of the application
         */

        if (properties.tags) {
            Utilities.TagConstruct(this, properties.tags);
        }
    }
}
