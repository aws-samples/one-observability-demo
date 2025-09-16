/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Arn, ArnFormat, RemovalPolicy, Stack, StackProps, Stage, Duration } from 'aws-cdk-lib';
import { Artifact, Pipeline, PipelineType, RetryMode } from 'aws-cdk-lib/aws-codepipeline';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import {
    EcrBuildAndPublishAction,
    RegistryType,
    S3SourceAction,
    S3Trigger,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { CompositePrincipal, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { LogGroup } from 'aws-cdk-lib/aws-logs';

/**
 * Definition for an application to be built and deployed
 */
export interface ContainerDefinition {
    /** The name of the application */
    name: string;
    /** Path to the Dockerfile for building the application */
    dockerFilePath: string;
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
 * Properties for the Containers Pipeline Stage
 */
export interface ContainersPipelineStageProperties extends StackProps {
    /** S3 source configuration */
    source: S3SourceProperties;
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
        const sourceBucket = Bucket.fromBucketName(this, 'SourceBucket', properties.source.bucketName);

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

        sourceBucket.grantRead(pipelineRole);
        this.pipeline.node.addDependency(pipelineRole);
        this.pipeline.node.addDependency(codeBuildRole);
        this.pipeline.node.addDependency(cloudWatchPolicy);

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
            onFailure: {
                retryMode: RetryMode.FAILED_ACTIONS,
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

        // Create retry mechanism
        this.createRetryMechanism();
    }

    /**
     * Creates a Lambda function and EventBridge rule to retry failed pipeline actions
     */
    private createRetryMechanism(): void {
        const retryLambdaRole = new Role(this, 'RetryLambdaRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [{ managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }],
        });

        retryLambdaRole.addToPolicy(
            new PolicyStatement({
                actions: [
                    'codepipeline:RetryStageExecution',
                    'codepipeline:GetPipelineExecution',
                    'codepipeline:GetPipelineState',
                    'codepipeline:ListPipelineExecutions',
                ],
                resources: [this.pipeline.pipelineArn, `${this.pipeline.pipelineArn}/*`],
            }),
        );

        const lambdaLogs = new LogGroup(this, 'RetryLambdaLogs', {
            removalPolicy: RemovalPolicy.DESTROY,
            retention: 7,
            logGroupName: `/aws/lambda/PipelineRetryFunction`,
        });

        const retryFunction = new Function(this, 'PipelineRetryFunction', {
            runtime: Runtime.PYTHON_3_13,
            handler: 'index.handler',
            role: retryLambdaRole,
            timeout: Duration.minutes(1),
            code: Code.fromAsset('../applications/lambda/pipeline-retry-python'),
            logGroup: lambdaLogs,
        });

        new Rule(this, 'PipelineFailureRule', {
            eventPattern: {
                source: ['aws.codepipeline'],
                detailType: ['CodePipeline Stage Execution State Change'],
                detail: {
                    state: ['FAILED'],
                    pipeline: [this.pipeline.pipelineName],
                    stage: ['build'],
                },
            } as EventPattern,
            targets: [new LambdaFunction(retryFunction)],
        });

        NagSuppressions.addResourceSuppressions(
            retryLambdaRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Lambda needs access to retry pipeline executions',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed policy is acceptable for Lambda',
                    appliesTo: ['Policy::arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
                },
            ],
            true,
        );
    }
}
