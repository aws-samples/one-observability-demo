/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { RemovalPolicy, Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Artifact, Pipeline, PipelineType } from 'aws-cdk-lib/aws-codepipeline';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import {
    EcrBuildAndPublishAction,
    RegistryType,
    S3SourceAction,
    S3Trigger,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { CompositePrincipal, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export interface ApplicationDefinition {
    name: string;
    dockerFilePath: string;
}

export interface S3SourceProperties {
    bucketName: string;
    bucketKey: string;
}

export interface ApplicationsPipelineStageProperties extends StackProps {
    source: S3SourceProperties;
    applicationList: ApplicationDefinition[];
}

export class ApplicationsPipelineStage extends Stage {
    constructor(scope: Construct, id: string, properties?: ApplicationsPipelineStageProperties) {
        super(scope, id);
        new ApplicationsStack(this, 'ApplicationsStack', properties);
    }
}

export class ApplicationsStack extends Stack {
    public applicationRepositories: Map<string, Repository> = new Map<string, Repository>();
    public pipeline: Pipeline;

    constructor(scope: Construct, id: string, properties?: ApplicationsPipelineStageProperties) {
        super(scope, id, properties);

        if (!properties?.source || !properties?.applicationList) {
            throw new Error('Source and applicationList are required');
        }

        const pipelineRole = new Role(this, 'PipelineRole', {
            assumedBy: new ServicePrincipal('codepipeline.amazonaws.com'),
        });

        const codeBuildRole = new Role(this, 'CodeBuildRole', {
            assumedBy: new CompositePrincipal(new ServicePrincipal('codebuild.amazonaws.com'), pipelineRole),
        });

        // Create ECR repositories for each application
        for (const app of properties.applicationList) {
            const repository = new Repository(this, `${app.name}Repository`, {
                repositoryName: app.name.toLowerCase(),
                imageScanOnPush: true,
                emptyOnDelete: true,
                imageTagMutability: TagMutability.MUTABLE,
                removalPolicy: RemovalPolicy.DESTROY,
            });

            repository.grantPullPush(codeBuildRole);
            NagSuppressions.addResourceSuppressions(repository, [
                {
                    id: 'AwsSolutions-ECR1',
                    reason: 'This is a sample application, so no access logging is required',
                },
            ]);

            this.applicationRepositories.set(app.name, repository);
        }

        // Create CodePipeline
        this.pipeline = new Pipeline(this, 'ApplicationsPipeline', {
            restartExecutionOnUpdate: true,
            pipelineType: PipelineType.V2,
            usePipelineRoleForActions: true,
            role: pipelineRole,
        });

        const sourceOutput = new Artifact();
        const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', properties.source.bucketName);

        sourceBucket.grantRead(pipelineRole);

        const sourceAction = new S3SourceAction({
            actionName: 'Source',
            bucket: sourceBucket,
            bucketKey: properties.source.bucketKey,
            output: sourceOutput,
            trigger: S3Trigger.POLL,
        });

        this.pipeline.addStage({
            stageName: 'Source',
            actions: [sourceAction],
        });

        // Create build steps for each application (parallel execution)
        const buildSteps = properties.applicationList.map((app) => {
            const repository = this.applicationRepositories.get(app.name)!;

            return new EcrBuildAndPublishAction({
                actionName: `Build-${app.name}`,
                repositoryName: repository.repositoryName,
                registryType: RegistryType.PRIVATE,
                dockerfileDirectoryPath: app.dockerFilePath,
                input: sourceOutput,
                imageTags: ['latest'],
                role: codeBuildRole,
            });
        });

        // Add build stage with all steps running in parallel
        this.pipeline.addStage({
            stageName: 'build',
            actions: buildSteps,
        });

        NagSuppressions.addResourceSuppressions(
            this.pipeline.artifactBucket,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Artifact Bucket for application pipeline, access logs not needed',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            [codeBuildRole, this.pipeline.role],
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Allow access to repositories and Artifact bucket',
                },
            ],
            true,
        );
    }
}
