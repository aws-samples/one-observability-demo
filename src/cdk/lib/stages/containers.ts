/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Containers pipeline stage for the One Observability Workshop.
 *
 * Builds and publishes Docker images for all microservices in the Core Wave:
 *
 * - **Amazon ECR** repositories with image scanning and immutable tags
 * - **AWS CodePipeline** with parallel CodeBuild actions for fast builds
 * - **Multi-architecture support** (AMD64/ARM64) via {@link EcrBuildAndPublishWithArchitectureAction}
 * - **Source integration** via S3 or AWS CodeConnections (GitHub)
 *
 * Six microservices are built in parallel:
 * - `payforadoption-go` (Go, AMD64) — Payment processing
 * - `petlistadoption-py` (Python, AMD64) — Adoption listing
 * - `petsearch-java` (Java, AMD64) — Pet search with DynamoDB
 * - `petsite-net` (.NET, AMD64) — Web frontend (deployed to EKS)
 * - `petfood-rs` (Rust, AMD64) — Food catalog and cart service
 * - `petfoodagent-strands-py` (Python, ARM64) — AI agent on Bedrock AgentCore
 *
 * @packageDocumentation
 */
import { Arn, ArnFormat, RemovalPolicy, Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Artifact, Pipeline, PipelineType, Result, RetryMode } from 'aws-cdk-lib/aws-codepipeline';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import {
    CodeBuildAction,
    CodeStarConnectionsSourceAction,
    EcrBuildAndPublishAction,
    RegistryType,
    S3SourceAction,
    S3Trigger,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { CompositePrincipal, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BuildSpec, LinuxArmBuildImage, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { ContainerArchitecture } from '../../bin/constants';

/**
 * Properties for EcrBuildAndPublishWithArchAction
 */
export interface EcrBuildAndPublishWithArchitectureActionProperties {
    actionName: string;
    repositoryName: string;
    registryType: RegistryType;
    dockerfileDirectoryPath: string;
    input: Artifact;
    imageTags: string[];
    role: Role;
    architecture: ContainerArchitecture;
}

/**
 * Custom CodeBuildAction for building and publishing Docker images with architecture support
 */
export class EcrBuildAndPublishWithArchitectureAction extends CodeBuildAction {
    constructor(properties: EcrBuildAndPublishWithArchitectureActionProperties) {
        const buildImage =
            properties.architecture === ContainerArchitecture.ARM64
                ? LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0
                : LinuxBuildImage.STANDARD_7_0;

        const platform = properties.architecture === ContainerArchitecture.ARM64 ? 'linux/arm64' : 'linux/amd64';
        const imageTagsString = properties.imageTags.join(' ');

        const project = new PipelineProject(properties.role.stack, `${properties.actionName}-Project`, {
            role: properties.role,
            environment: {
                buildImage,
                privileged: true,
            },
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
                        ],
                    },
                    build: {
                        commands: [
                            `echo Building Docker image with platform ${platform}...`,
                            `cd ${properties.dockerfileDirectoryPath}`,
                            `docker build --platform ${platform} -t $REPOSITORY_URI:${imageTagsString} .`,
                        ],
                    },
                    post_build: {
                        commands: ['echo Pushing Docker image...', `docker push $REPOSITORY_URI:${imageTagsString}`],
                    },
                },
            }),
            environmentVariables: {
                AWS_ACCOUNT_ID: { value: properties.role.stack.account },
                REPOSITORY_URI: {
                    value: `${properties.role.stack.account}.dkr.ecr.${properties.role.stack.region}.amazonaws.com/${properties.repositoryName}`,
                },
            },
        });

        super({
            actionName: properties.actionName,
            project,
            input: properties.input,
        });

        NagSuppressions.addResourceSuppressions(project, [
            {
                id: 'AwsSolutions-CB4',
                reason: 'KMS key not needed for this container build project',
            },
        ]);
    }
}

/**
 * Definition for an application to be built and deployed
 */
export interface ContainerDefinition {
    /** The name of the application */
    name: string;
    /** Path to the Dockerfile for building the application */
    dockerFilePath: string;
    /** Architecture */
    architecture?: ContainerArchitecture;
}

/**
 * Properties for S3 source configuration
 */
export interface S3SourceProperties {
    /** Name of the S3 bucket containing source code */
    bucketName: string;
    /** Key/path to the source code object in S3 */
    bucketKey: string;
}

/**
 * Properties for CodeConnection source configuration
 */
export interface CodeConnectionSourceProperties {
    /** CodeConnection ARN for GitHub integration */
    connectionArn: string;
    /** Organization/owner name */
    organizationName: string;
    /** Repository name */
    repositoryName: string;
    /** Branch name */
    branchName: string;
}

/**
 * Properties for the Containers Pipeline Stage
 */
export interface ContainersPipelineStageProperties extends StackProps {
    /** S3 source configuration (used when CodeConnection is not available) */
    source?: S3SourceProperties;
    /** CodeConnection source configuration */
    codeConnectionSource?: CodeConnectionSourceProperties;
    /** List of applications to build and deploy */
    applicationList: ContainerDefinition[];
}

/**
 * CDK Stage for the Containers Pipeline
 */
export class ContainersPipelineStage extends Stage {
    /**
     * Creates a new Containers Pipeline Stage
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stage
     */
    constructor(scope: Construct, id: string, properties?: ContainersPipelineStageProperties) {
        super(scope, id);
        new ContainersStack(this, 'ContainersStack', properties);
    }
}

/**
 * Stack containing the containers build pipeline and ECR repositories
 */
export class ContainersStack extends Stack {
    /** Map of application names to their ECR repositories */
    public applicationRepositories: Map<string, Repository> = new Map<string, Repository>();
    /** The CodePipeline for building applications */
    public pipeline: Pipeline;

    /**
     * Creates a new Containers Stack
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stack
     * @throws Error when source or applicationList properties are missing
     */
    constructor(scope: Construct, id: string, properties?: ContainersPipelineStageProperties) {
        super(scope, id, properties);

        if (!properties?.applicationList) {
            throw new Error('ApplicationList is required');
        }

        if (!properties?.source && !properties?.codeConnectionSource) {
            throw new Error('Either S3 source or CodeConnection source is required');
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

        const artifactBucket = new Bucket(this, 'ContainersPipelineArtifact', {
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        // Create CodePipeline
        this.pipeline = new Pipeline(this, 'ContainersPipeline', {
            restartExecutionOnUpdate: true,
            pipelineType: PipelineType.V2,
            usePipelineRoleForActions: true,
            role: pipelineRole,
            pipelineName: `${this.stackName}-pipeline`,
            artifactBucket: artifactBucket,
        });

        const sourceOutput = new Artifact();

        const pipelineLogArn = Arn.format(
            {
                service: 'logs',
                resource: 'log-group',
                resourceName: '/aws/codepipeline/*',
                arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                account: this.account,
                region: this.region,
                partition: 'aws',
            },
            Stack.of(this),
        );

        const cloudWatchPolicy = new Policy(this, 'CloudwatchPolicy', {
            statements: [
                new PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [pipelineLogArn],
                }),
            ],
            roles: [pipelineRole, codeBuildRole],
        });

        // Determine source action based on available configuration
        let sourceAction;

        if (properties.codeConnectionSource) {
            // Use CodeConnection as source
            sourceAction = new CodeStarConnectionsSourceAction({
                actionName: 'Source',
                owner: properties.codeConnectionSource.organizationName,
                repo: properties.codeConnectionSource.repositoryName,
                branch: properties.codeConnectionSource.branchName,
                connectionArn: properties.codeConnectionSource.connectionArn,
                output: sourceOutput,
            });
        } else if (properties.source) {
            // Fallback to S3 source
            const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', properties.source.bucketName);
            sourceBucket.grantRead(pipelineRole);

            sourceAction = new S3SourceAction({
                actionName: 'Source',
                bucket: sourceBucket,
                bucketKey: properties.source.bucketKey,
                output: sourceOutput,
                trigger: S3Trigger.POLL,
            });
        } else {
            throw new Error('No valid source configuration provided');
        }

        // Ensure CloudWatch policy is attached before pipeline actions
        this.pipeline.node.addDependency(cloudWatchPolicy);

        this.pipeline.addStage({
            stageName: 'Source',
            actions: [sourceAction],
        });

        // Create build steps for all applications (parallel execution)
        const buildSteps = properties.applicationList.map((app) => {
            const repository = this.applicationRepositories.get(app.name)!;

            if (app.architecture === ContainerArchitecture.ARM64) {
                return new EcrBuildAndPublishWithArchitectureAction({
                    actionName: `Build-${app.name}`,
                    repositoryName: repository.repositoryName,
                    registryType: RegistryType.PRIVATE,
                    dockerfileDirectoryPath: app.dockerFilePath,
                    input: sourceOutput,
                    imageTags: ['latest'],
                    role: codeBuildRole,
                    architecture: ContainerArchitecture.ARM64,
                });
            }

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
            stageName: 'Build',
            actions: buildSteps,
            onFailure: {
                retryMode: RetryMode.FAILED_ACTIONS,
                result: Result.RETRY,
            },
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

        NagSuppressions.addResourceSuppressions(
            cloudWatchPolicy,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Allow access to Cloudwatch Log Groups for pipeline execution',
                },
            ],
            true,
        );
    }
}
