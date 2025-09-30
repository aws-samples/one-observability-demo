"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDKPipeline = void 0;
/**
 * CDK Pipeline module for the One Observability Workshop.
 *
 * This module defines the main CI/CD pipeline that deploys the workshop infrastructure
 * across multiple stages including core networking, applications, storage, compute, and microservices.
 *
 * @packageDocumentation
 */
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_codepipeline_1 = require("aws-cdk-lib/aws-codepipeline");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const pipelines_1 = require("aws-cdk-lib/pipelines");
const cdk_nag_1 = require("cdk-nag");
const core_1 = require("./stages/core");
const utilities_1 = require("./utils/utilities");
const aws_codepipeline_actions_1 = require("aws-cdk-lib/aws-codepipeline-actions");
const containers_1 = require("./stages/containers");
const storage_1 = require("./stages/storage");
const compute_1 = require("./stages/compute");
const applications_1 = require("./stages/applications");
/**
 * CDK Pipeline stack for the One Observability Workshop.
 *
 * This stack creates a complete CI/CD pipeline that deploys the workshop infrastructure
 * in multiple stages:
 * - Core: Networking, security, and foundational services
 * - Applications: Container-based applications (ECS/EKS)
 * - Backend: Storage (S3, Aurora, DynamoDB) and compute (Lambda, EC2)
 * - Microservices: Sample microservices for the pet store application
 *
 * The pipeline uses AWS CodePipeline with CodeBuild for synthesis and deployment,
 * with proper security controls and artifact management.
 */
class CDKPipeline extends aws_cdk_lib_1.Stack {
    /**
     * Creates a new CDK Pipeline stack.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the pipeline
     */
    constructor(scope, id, properties) {
        super(scope, id, properties);
        // Create a CodePipeline source using the Specified S3 Bucket
        const configBucket = aws_s3_1.Bucket.fromBucketName(this, 'ConfigBucket', properties.configBucketName);
        const bucketKey = `repo/refs/heads/${properties.branchName}/repo.zip`;
        // Use the configuration file as the pipeline trigger
        const bucketSource = pipelines_1.CodePipelineSource.s3(configBucket, bucketKey, {
            trigger: aws_codepipeline_actions_1.S3Trigger.POLL,
        });
        /**
         * Create an S3 bucket to store the pipeline artifacts.
         * The bucket has encryption at rest using a CMK and enforces encryption in transit.
         * Versioning is enabled on the bucket for audit and recovery purposes.
         */
        const pipelineArtifactBucket = new aws_s3_1.Bucket(this, 'ArtifactBucket', {
            enforceSSL: true,
            versioned: true,
            encryption: aws_s3_1.BucketEncryption.S3_MANAGED,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        /**
         * Add CDK-nag suppressions for the artifact bucket.
         */
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pipelineArtifactBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Temporary artifact bucket, access logs are not needed',
            },
        ]);
        /**
         * Create the IAM role for the pipeline.
         */
        this.pipelineRole = new aws_iam_1.Role(this, 'PipelineRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('codepipeline.amazonaws.com'),
        });
        /**
         * Grant access to the source bucket for the pipeline role.
         */
        configBucket.grantRead(this.pipelineRole);
        const synthStep = new pipelines_1.CodeBuildStep('Synth', {
            input: bucketSource,
            primaryOutputDirectory: `${properties.workingFolder}/cdk.out`,
            installCommands: ['npm i -g aws-cdk'],
            // Using globally installed CDK due to this issue https://github.com/aws/aws-cdk/issues/28519
            commands: [`cd ${properties.workingFolder}`, 'npm ci', 'npm run build', 'cdk synth --all'],
            buildEnvironment: {
                buildImage: aws_codebuild_1.LinuxBuildImage.STANDARD_7_0,
            },
            partialBuildSpec: aws_codebuild_1.BuildSpec.fromObject({
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
        const pipeline = new pipelines_1.CodePipeline(this, 'Pipeline', {
            synth: synthStep,
            artifactBucket: pipelineArtifactBucket,
            crossAccountKeys: true,
            pipelineName: `${id}-pipeline`,
            usePipelineRoleForActions: true,
            pipelineType: aws_codepipeline_1.PipelineType.V2,
            role: this.pipelineRole,
            codeBuildDefaults: {
                buildEnvironment: {
                    buildImage: aws_codebuild_1.LinuxBuildImage.STANDARD_7_0,
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
        const coreStage = new core_1.CoreStage(this, 'Core', coreProperties);
        coreWave.addStage(coreStage);
        const applicationsStageTags = {
            ...properties.tags,
            parent: this.stackName,
            sequence: (stageSequence++).toString(),
        };
        coreWave.addStage(new containers_1.ContainersPipelineStage(this, 'Applications', {
            applicationList: properties.applicationList,
            tags: applicationsStageTags,
            source: {
                bucketName: properties.configBucketName,
                bucketKey: bucketKey,
            },
            env: properties.env,
        }));
        const backendWave = pipeline.addWave('Backend');
        const storageStage = new storage_1.StorageStage(this, 'Storage', {
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
            env: properties.env,
        });
        backendWave.addStage(storageStage, {
            post: [storageStage.getDDBSeedingStep(this, configBucket), storageStage.getRDSSeedingStep(this)],
        });
        const computeStage = new compute_1.ComputeStage(this, 'Compute', {
            tags: {
                ...properties.tags,
                parent: this.stackName,
                sequence: (stageSequence++).toString(),
            },
            env: properties.env,
        });
        backendWave.addStage(computeStage);
        const microservicesStageTags = {
            ...properties.tags,
            parent: this.stackName,
            sequence: (stageSequence++).toString(),
        };
        pipeline.addStage(new applications_1.MicroservicesStage(this, 'Microservices', {
            ...properties.microservicesProperties,
            tags: microservicesStageTags,
            env: properties.env,
        }));
        /**
         * Build the pipeline to add suppressions and customizations.
         * This is required before adding additional configurations.
         * @see https://github.com/cdklabs/cdk-nag?tab=readme-ov-file#suppressing-aws-cdk-libpipelines-violations
         */
        pipeline.buildPipeline();
        /**
         * Grant access to describe Prefix lists
         */
        if (pipeline.synthProject.role) {
            new aws_iam_1.Policy(this, 'CloudFormationPolicy', {
                statements: [
                    new aws_iam_1.PolicyStatement({
                        actions: [
                            'cloudformation:DescribeStacks',
                            'cloudformation:ListResources',
                            'ec2:DescribeManagedPrefixLists',
                            'ec2:GetManagedPrefixListEntries',
                        ],
                        resources: ['*'],
                    }),
                ],
                roles: [pipeline.synthProject.role],
            });
        }
        /**
         * Add CDK-nag suppressions for the pipeline role.
         */
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pipeline.pipeline.role, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'The pipeline role is not scoped to a specific resource',
            },
        ], true);
        /**
         * Add CDK-nag suppressions for the synth project.
         */
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pipeline.synthProject, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'The pipeline role is not scoped to a specific resource',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWS Managed policy is acceptable here',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AWSCodeArtifactReadOnlyAccess'],
            },
        ], true);
        /**
         * Add CDK-nag suppressions for the self-mutation project.
         */
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pipeline.selfMutationProject, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Ephemeral Synth Project not limited to specific resource or action',
            },
        ], true);
        /**
         * Add stack-level CDK-nag suppressions.
         * Added as stack suppression since path can change based on the context and repo name.
         * Suppression can also be limited by path but must be updated every time the repo changes.
         */
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Ephemeral Synth Project not limited to specific resource or action',
            },
            {
                id: 'AwsSolutions-CB4',
                reason: 'CDK Pipelines uses CMKs with cross account / region. Omitted for simplicity.',
            },
        ], true);
        /**
         * Generate PipelineArn Output with the self-mutating Pipeline ARN
         */
        new aws_cdk_lib_1.CfnOutput(this, 'PipelineArn', {
            value: pipeline.pipeline.pipelineArn,
            exportName: 'PipelineArn',
        });
        /**
         * Tag all child resources of the application
         */
        if (properties.tags) {
            utilities_1.Utilities.TagConstruct(this, properties.tags);
        }
    }
}
exports.CDKPipeline = CDKPipeline;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGlwZWxpbmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwaXBlbGluZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztFQUdFOzs7QUFFRjs7Ozs7OztHQU9HO0FBRUgsNkNBQTBFO0FBQzFFLDZEQUF1RTtBQUN2RSxtRUFBNEQ7QUFDNUQsaURBQTZGO0FBQzdGLCtDQUFpRjtBQUNqRixxREFBd0Y7QUFDeEYscUNBQTBDO0FBRTFDLHdDQUErRDtBQUMvRCxpREFBOEM7QUFFOUMsbUZBQWlFO0FBQ2pFLG9EQUFtRjtBQUNuRiw4Q0FBZ0Q7QUFFaEQsOENBQWdEO0FBQ2hELHdEQUErRjtBQW1DL0Y7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsTUFBYSxXQUFZLFNBQVEsbUJBQUs7SUFPbEM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUFpQztRQUN2RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUU3Qiw2REFBNkQ7UUFDN0QsTUFBTSxZQUFZLEdBQUcsZUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQzlGLE1BQU0sU0FBUyxHQUFHLG1CQUFtQixVQUFVLENBQUMsVUFBVSxXQUFXLENBQUM7UUFFdEUscURBQXFEO1FBQ3JELE1BQU0sWUFBWSxHQUFHLDhCQUFrQixDQUFDLEVBQUUsQ0FBQyxZQUFZLEVBQUUsU0FBUyxFQUFFO1lBQ2hFLE9BQU8sRUFBRSxvQ0FBUyxDQUFDLElBQUk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0g7Ozs7V0FJRztRQUNILE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxlQUFNLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzlELFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFNBQVMsRUFBRSxJQUFJO1lBQ2YsVUFBVSxFQUFFLHlCQUFnQixDQUFDLFVBQVU7WUFDdkMsaUJBQWlCLEVBQUUsMEJBQWlCLENBQUMsU0FBUztZQUM5QyxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1lBQ3BDLGlCQUFpQixFQUFFLElBQUk7U0FDMUIsQ0FBQyxDQUFDO1FBRUg7O1dBRUc7UUFDSCx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLHNCQUFzQixFQUFFO1lBQzVEO2dCQUNJLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSx1REFBdUQ7YUFDbEU7U0FDSixDQUFDLENBQUM7UUFFSDs7V0FFRztRQUNILElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxjQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMvQyxTQUFTLEVBQUUsSUFBSSwwQkFBZ0IsQ0FBQyw0QkFBNEIsQ0FBQztTQUNoRSxDQUFDLENBQUM7UUFFSDs7V0FFRztRQUNILFlBQVksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRTFDLE1BQU0sU0FBUyxHQUFHLElBQUkseUJBQWEsQ0FBQyxPQUFPLEVBQUU7WUFDekMsS0FBSyxFQUFFLFlBQVk7WUFDbkIsc0JBQXNCLEVBQUUsR0FBRyxVQUFVLENBQUMsYUFBYSxVQUFVO1lBQzdELGVBQWUsRUFBRSxDQUFDLGtCQUFrQixDQUFDO1lBQ3JDLDZGQUE2RjtZQUM3RixRQUFRLEVBQUUsQ0FBQyxNQUFNLFVBQVUsQ0FBQyxhQUFhLEVBQUUsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLGlCQUFpQixDQUFDO1lBQzFGLGdCQUFnQixFQUFFO2dCQUNkLFVBQVUsRUFBRSwrQkFBZSxDQUFDLFlBQVk7YUFDM0M7WUFDRCxnQkFBZ0IsRUFBRSx5QkFBUyxDQUFDLFVBQVUsQ0FBQztnQkFDbkMsTUFBTSxFQUFFO29CQUNKLE9BQU8sRUFBRTt3QkFDTCxrQkFBa0IsRUFBRTs0QkFDaEIsTUFBTSxFQUFFLE1BQU07eUJBQ2pCO3FCQUNKO2lCQUNKO2FBQ0osQ0FBQztTQUNMLENBQUMsQ0FBQztRQUNIOzs7Ozs7V0FNRztRQUNILE1BQU0sUUFBUSxHQUFHLElBQUksd0JBQVksQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ2hELEtBQUssRUFBRSxTQUFTO1lBQ2hCLGNBQWMsRUFBRSxzQkFBc0I7WUFDdEMsZ0JBQWdCLEVBQUUsSUFBSTtZQUN0QixZQUFZLEVBQUUsR0FBRyxFQUFFLFdBQVc7WUFDOUIseUJBQXlCLEVBQUUsSUFBSTtZQUMvQixZQUFZLEVBQUUsK0JBQVksQ0FBQyxFQUFFO1lBQzdCLElBQUksRUFBRSxJQUFJLENBQUMsWUFBWTtZQUN2QixpQkFBaUIsRUFBRTtnQkFDZixnQkFBZ0IsRUFBRTtvQkFDZCxVQUFVLEVBQUUsK0JBQWUsQ0FBQyxZQUFZO29CQUN4QyxVQUFVLEVBQUUsSUFBSTtvQkFDaEIsb0JBQW9CLEVBQUU7d0JBQ2xCLFlBQVksRUFBRTs0QkFDVixLQUFLLEVBQUUsTUFBTTt5QkFDaEI7cUJBQ0o7aUJBQ0o7YUFDSjtTQUNKLENBQUMsQ0FBQztRQUVILE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFMUMsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO1FBQ3RCLE1BQU0sYUFBYSxHQUFHO1lBQ2xCLEdBQUcsVUFBVSxDQUFDLElBQUk7WUFDbEIsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3RCLFFBQVEsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFO1NBQ3pDLENBQUM7UUFDRixNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsbUJBQW1CO1lBQ2pELENBQUMsQ0FBQyxFQUFFLEdBQUcsVUFBVSxDQUFDLG1CQUFtQixFQUFFLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDNUQsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxDQUFDO1FBRTlCLE1BQU0sU0FBUyxHQUFHLElBQUksZ0JBQVMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQzlELFFBQVEsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFN0IsTUFBTSxxQkFBcUIsR0FBRztZQUMxQixHQUFHLFVBQVUsQ0FBQyxJQUFJO1lBQ2xCLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUztZQUN0QixRQUFRLEVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRTtTQUN6QyxDQUFDO1FBQ0YsUUFBUSxDQUFDLFFBQVEsQ0FDYixJQUFJLG9DQUF1QixDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDOUMsZUFBZSxFQUFFLFVBQVUsQ0FBQyxlQUFlO1lBQzNDLElBQUksRUFBRSxxQkFBcUI7WUFDM0IsTUFBTSxFQUFFO2dCQUNKLFVBQVUsRUFBRSxVQUFVLENBQUMsZ0JBQWdCO2dCQUN2QyxTQUFTLEVBQUUsU0FBUzthQUN2QjtZQUNELEdBQUcsRUFBRSxVQUFVLENBQUMsR0FBRztTQUN0QixDQUFDLENBQ0wsQ0FBQztRQUVGLE1BQU0sV0FBVyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFaEQsTUFBTSxZQUFZLEdBQUcsSUFBSSxzQkFBWSxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDbkQsZ0JBQWdCLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLFVBQVUsQ0FBQyxjQUFjO2FBQ3ZDO1lBQ0Qsd0JBQXdCLEVBQUU7Z0JBQ3RCLGFBQWEsRUFBRSxVQUFVLENBQUMscUJBQXFCO2FBQ2xEO1lBQ0QsSUFBSSxFQUFFO2dCQUNGLEdBQUcsVUFBVSxDQUFDLElBQUk7Z0JBQ2xCLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDdEIsUUFBUSxFQUFFLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUU7YUFDekM7WUFDRCxHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUc7U0FDdEIsQ0FBQyxDQUFDO1FBRUgsV0FBVyxDQUFDLFFBQVEsQ0FBQyxZQUFZLEVBQUU7WUFDL0IsSUFBSSxFQUFFLENBQUMsWUFBWSxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxZQUFZLENBQUMsRUFBRSxZQUFZLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDbkcsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLEdBQUcsSUFBSSxzQkFBWSxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDbkQsSUFBSSxFQUFFO2dCQUNGLEdBQUcsVUFBVSxDQUFDLElBQUk7Z0JBQ2xCLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDdEIsUUFBUSxFQUFFLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUU7YUFDekM7WUFDRCxHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUc7U0FDdEIsQ0FBQyxDQUFDO1FBRUgsV0FBVyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUVuQyxNQUFNLHNCQUFzQixHQUFHO1lBQzNCLEdBQUcsVUFBVSxDQUFDLElBQUk7WUFDbEIsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3RCLFFBQVEsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFO1NBQ3pDLENBQUM7UUFFRixRQUFRLENBQUMsUUFBUSxDQUNiLElBQUksaUNBQWtCLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUMxQyxHQUFHLFVBQVUsQ0FBQyx1QkFBdUI7WUFDckMsSUFBSSxFQUFFLHNCQUFzQjtZQUM1QixHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUc7U0FDdEIsQ0FBQyxDQUNMLENBQUM7UUFFRjs7OztXQUlHO1FBQ0gsUUFBUSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXpCOztXQUVHO1FBQ0gsSUFBSSxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzdCLElBQUksZ0JBQU0sQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7Z0JBQ3JDLFVBQVUsRUFBRTtvQkFDUixJQUFJLHlCQUFlLENBQUM7d0JBQ2hCLE9BQU8sRUFBRTs0QkFDTCwrQkFBK0I7NEJBQy9CLDhCQUE4Qjs0QkFDOUIsZ0NBQWdDOzRCQUNoQyxpQ0FBaUM7eUJBQ3BDO3dCQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztxQkFDbkIsQ0FBQztpQkFDTDtnQkFDRCxLQUFLLEVBQUUsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQzthQUN0QyxDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQ7O1dBRUc7UUFDSCx5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksRUFDdEI7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsd0RBQXdEO2FBQ25FO1NBQ0osRUFDRCxJQUFJLENBQ1AsQ0FBQztRQUVGOztXQUVHO1FBQ0gseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDbkMsUUFBUSxDQUFDLFlBQVksRUFDckI7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsd0RBQXdEO2FBQ25FO1lBQ0Q7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHVDQUF1QztnQkFDL0MsU0FBUyxFQUFFLENBQUMsNEVBQTRFLENBQUM7YUFDNUY7U0FDSixFQUNELElBQUksQ0FDUCxDQUFDO1FBRUY7O1dBRUc7UUFDSCx5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxRQUFRLENBQUMsbUJBQW1CLEVBQzVCO1lBQ0k7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUMvRTtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFFRjs7OztXQUlHO1FBQ0gseUJBQWUsQ0FBQyxvQkFBb0IsQ0FDaEMsSUFBSSxFQUNKO1lBQ0k7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUMvRTtZQUNEO2dCQUNJLEVBQUUsRUFBRSxrQkFBa0I7Z0JBQ3RCLE1BQU0sRUFBRSw4RUFBOEU7YUFDekY7U0FDSixFQUNELElBQUksQ0FDUCxDQUFDO1FBRUY7O1dBRUc7UUFDSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUMvQixLQUFLLEVBQUUsUUFBUSxDQUFDLFFBQVEsQ0FBQyxXQUFXO1lBQ3BDLFVBQVUsRUFBRSxhQUFhO1NBQzVCLENBQUMsQ0FBQztRQUVIOztXQUVHO1FBRUgsSUFBSSxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbEIscUJBQVMsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsRCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBeFNELGtDQXdTQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuXG4vKipcbiAqIENESyBQaXBlbGluZSBtb2R1bGUgZm9yIHRoZSBPbmUgT2JzZXJ2YWJpbGl0eSBXb3Jrc2hvcC5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWZpbmVzIHRoZSBtYWluIENJL0NEIHBpcGVsaW5lIHRoYXQgZGVwbG95cyB0aGUgd29ya3Nob3AgaW5mcmFzdHJ1Y3R1cmVcbiAqIGFjcm9zcyBtdWx0aXBsZSBzdGFnZXMgaW5jbHVkaW5nIGNvcmUgbmV0d29ya2luZywgYXBwbGljYXRpb25zLCBzdG9yYWdlLCBjb21wdXRlLCBhbmQgbWljcm9zZXJ2aWNlcy5cbiAqXG4gKiBAcGFja2FnZURvY3VtZW50YXRpb25cbiAqL1xuXG5pbXBvcnQgeyBDZm5PdXRwdXQsIFJlbW92YWxQb2xpY3ksIFN0YWNrLCBTdGFja1Byb3BzIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQnVpbGRTcGVjLCBMaW51eEJ1aWxkSW1hZ2UgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCB7IFBpcGVsaW5lVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlcGlwZWxpbmUnO1xuaW1wb3J0IHsgSVJvbGUsIFBvbGljeSwgUG9saWN5U3RhdGVtZW50LCBSb2xlLCBTZXJ2aWNlUHJpbmNpcGFsIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBCbG9ja1B1YmxpY0FjY2VzcywgQnVja2V0LCBCdWNrZXRFbmNyeXB0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IENvZGVCdWlsZFN0ZXAsIENvZGVQaXBlbGluZSwgQ29kZVBpcGVsaW5lU291cmNlIH0gZnJvbSAnYXdzLWNkay1saWIvcGlwZWxpbmVzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBDb3JlU3RhZ2UsIENvcmVTdGFnZVByb3BlcnRpZXMgfSBmcm9tICcuL3N0YWdlcy9jb3JlJztcbmltcG9ydCB7IFV0aWxpdGllcyB9IGZyb20gJy4vdXRpbHMvdXRpbGl0aWVzJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBTM1RyaWdnZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lLWFjdGlvbnMnO1xuaW1wb3J0IHsgQ29udGFpbmVyRGVmaW5pdGlvbiwgQ29udGFpbmVyc1BpcGVsaW5lU3RhZ2UgfSBmcm9tICcuL3N0YWdlcy9jb250YWluZXJzJztcbmltcG9ydCB7IFN0b3JhZ2VTdGFnZSB9IGZyb20gJy4vc3RhZ2VzL3N0b3JhZ2UnO1xuaW1wb3J0IHsgQXVyb3JhUG9zdGdyZXNFbmdpbmVWZXJzaW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XG5pbXBvcnQgeyBDb21wdXRlU3RhZ2UgfSBmcm9tICcuL3N0YWdlcy9jb21wdXRlJztcbmltcG9ydCB7IE1pY3Jvc2VydmljZXNTdGFnZSwgTWljcm9zZXJ2aWNlQXBwbGljYXRpb25zUHJvcGVydGllcyB9IGZyb20gJy4vc3RhZ2VzL2FwcGxpY2F0aW9ucyc7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgY29uZmlndXJpbmcgdGhlIENESyBQaXBlbGluZSBzdGFjay5cbiAqXG4gKiBUaGlzIGludGVyZmFjZSBleHRlbmRzIFN0YWNrUHJvcHMgYW5kIGluY2x1ZGVzIGFsbCBuZWNlc3NhcnkgY29uZmlndXJhdGlvblxuICogZm9yIGRlcGxveWluZyB0aGUgT25lIE9ic2VydmFiaWxpdHkgV29ya3Nob3AgaW5mcmFzdHJ1Y3R1cmUgcGlwZWxpbmUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ0RLUGlwZWxpbmVQcm9wZXJ0aWVzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gICAgLyoqIFMzIGJ1Y2tldCBuYW1lIGNvbnRhaW5pbmcgdGhlIHNvdXJjZSBjb2RlIHJlcG9zaXRvcnkgKi9cbiAgICBjb25maWdCdWNrZXROYW1lOiBzdHJpbmc7XG4gICAgLyoqIEdpdCBicmFuY2ggbmFtZSB0byBkZXBsb3kgZnJvbSAqL1xuICAgIGJyYW5jaE5hbWU6IHN0cmluZztcbiAgICAvKiogT3JnYW5pemF0aW9uIG5hbWUgZm9yIHJlc291cmNlIG5hbWluZyAqL1xuICAgIG9yZ2FuaXphdGlvbk5hbWU6IHN0cmluZztcbiAgICAvKiogUmVwb3NpdG9yeSBuYW1lIGZvciB0aGUgc291cmNlIGNvZGUgKi9cbiAgICByZXBvc2l0b3J5TmFtZTogc3RyaW5nO1xuICAgIC8qKiBXb3JraW5nIGZvbGRlciBwYXRoIHdpdGhpbiB0aGUgcmVwb3NpdG9yeSAqL1xuICAgIHdvcmtpbmdGb2xkZXI6IHN0cmluZztcbiAgICAvKiogT3B0aW9uYWwgdGFncyB0byBhcHBseSB0byBhbGwgcmVzb3VyY2VzICovXG4gICAgdGFncz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG4gICAgLyoqIE9wdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBjb3JlIGluZnJhc3RydWN0dXJlIHN0YWdlICovXG4gICAgY29yZVN0YWdlUHJvcGVydGllcz86IENvcmVTdGFnZVByb3BlcnRpZXM7XG4gICAgLyoqIERlZmF1bHQgbG9nIHJldGVudGlvbiBwZXJpb2QgZm9yIENsb3VkV2F0Y2ggbG9ncyAqL1xuICAgIGRlZmF1bHRSZXRlbnRpb25QZXJpb2Q/OiBSZXRlbnRpb25EYXlzO1xuICAgIC8qKiBMaXN0IG9mIGNvbnRhaW5lciBhcHBsaWNhdGlvbiBkZWZpbml0aW9ucyB0byBkZXBsb3kgKi9cbiAgICBhcHBsaWNhdGlvbkxpc3Q6IENvbnRhaW5lckRlZmluaXRpb25bXTtcbiAgICAvKiogUGF0aHMgdG8gcGV0IHN0b3JlIGltYWdlcyBmb3Igc2VlZGluZyB0aGUgYXBwbGljYXRpb24gKi9cbiAgICBwZXRJbWFnZXNQYXRoczogc3RyaW5nW107XG4gICAgLyoqIFBvc3RncmVTUUwgZW5naW5lIHZlcnNpb24gZm9yIEF1cm9yYSBkYXRhYmFzZSAqL1xuICAgIHBvc3RncmVzRW5naW5lVmVyc2lvbj86IEF1cm9yYVBvc3RncmVzRW5naW5lVmVyc2lvbjtcbiAgICAvKiogUHJvcGVydGllcyBmb3IgbWljcm9zZXJ2aWNlcyBkZXBsb3ltZW50IHN0YWdlICovXG4gICAgbWljcm9zZXJ2aWNlc1Byb3BlcnRpZXM6IE1pY3Jvc2VydmljZUFwcGxpY2F0aW9uc1Byb3BlcnRpZXM7XG59XG5cbi8qKlxuICogQ0RLIFBpcGVsaW5lIHN0YWNrIGZvciB0aGUgT25lIE9ic2VydmFiaWxpdHkgV29ya3Nob3AuXG4gKlxuICogVGhpcyBzdGFjayBjcmVhdGVzIGEgY29tcGxldGUgQ0kvQ0QgcGlwZWxpbmUgdGhhdCBkZXBsb3lzIHRoZSB3b3Jrc2hvcCBpbmZyYXN0cnVjdHVyZVxuICogaW4gbXVsdGlwbGUgc3RhZ2VzOlxuICogLSBDb3JlOiBOZXR3b3JraW5nLCBzZWN1cml0eSwgYW5kIGZvdW5kYXRpb25hbCBzZXJ2aWNlc1xuICogLSBBcHBsaWNhdGlvbnM6IENvbnRhaW5lci1iYXNlZCBhcHBsaWNhdGlvbnMgKEVDUy9FS1MpXG4gKiAtIEJhY2tlbmQ6IFN0b3JhZ2UgKFMzLCBBdXJvcmEsIER5bmFtb0RCKSBhbmQgY29tcHV0ZSAoTGFtYmRhLCBFQzIpXG4gKiAtIE1pY3Jvc2VydmljZXM6IFNhbXBsZSBtaWNyb3NlcnZpY2VzIGZvciB0aGUgcGV0IHN0b3JlIGFwcGxpY2F0aW9uXG4gKlxuICogVGhlIHBpcGVsaW5lIHVzZXMgQVdTIENvZGVQaXBlbGluZSB3aXRoIENvZGVCdWlsZCBmb3Igc3ludGhlc2lzIGFuZCBkZXBsb3ltZW50LFxuICogd2l0aCBwcm9wZXIgc2VjdXJpdHkgY29udHJvbHMgYW5kIGFydGlmYWN0IG1hbmFnZW1lbnQuXG4gKi9cbmV4cG9ydCBjbGFzcyBDREtQaXBlbGluZSBleHRlbmRzIFN0YWNrIHtcbiAgICAvKipcbiAgICAgKiBUaGUgSUFNIHJvbGUgdXNlZCBieSB0aGUgcGlwZWxpbmUgZm9yIGV4ZWN1dGluZyBwaXBlbGluZSBhY3Rpb25zLlxuICAgICAqIFRoaXMgcm9sZSBoYXMgcGVybWlzc2lvbnMgdG8gYWNjZXNzIHRoZSBzb3VyY2UgUzMgYnVja2V0IGFuZCBvdGhlciByZXF1aXJlZCByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcmVhZG9ubHkgcGlwZWxpbmVSb2xlOiBJUm9sZTtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgQ0RLIFBpcGVsaW5lIHN0YWNrLlxuICAgICAqXG4gICAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgY29uc3RydWN0IGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIHBpcGVsaW5lXG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllczogQ0RLUGlwZWxpbmVQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcGVydGllcyk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgQ29kZVBpcGVsaW5lIHNvdXJjZSB1c2luZyB0aGUgU3BlY2lmaWVkIFMzIEJ1Y2tldFxuICAgICAgICBjb25zdCBjb25maWdCdWNrZXQgPSBCdWNrZXQuZnJvbUJ1Y2tldE5hbWUodGhpcywgJ0NvbmZpZ0J1Y2tldCcsIHByb3BlcnRpZXMuY29uZmlnQnVja2V0TmFtZSk7XG4gICAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IGByZXBvL3JlZnMvaGVhZHMvJHtwcm9wZXJ0aWVzLmJyYW5jaE5hbWV9L3JlcG8uemlwYDtcblxuICAgICAgICAvLyBVc2UgdGhlIGNvbmZpZ3VyYXRpb24gZmlsZSBhcyB0aGUgcGlwZWxpbmUgdHJpZ2dlclxuICAgICAgICBjb25zdCBidWNrZXRTb3VyY2UgPSBDb2RlUGlwZWxpbmVTb3VyY2UuczMoY29uZmlnQnVja2V0LCBidWNrZXRLZXksIHtcbiAgICAgICAgICAgIHRyaWdnZXI6IFMzVHJpZ2dlci5QT0xMLFxuICAgICAgICB9KTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIENyZWF0ZSBhbiBTMyBidWNrZXQgdG8gc3RvcmUgdGhlIHBpcGVsaW5lIGFydGlmYWN0cy5cbiAgICAgICAgICogVGhlIGJ1Y2tldCBoYXMgZW5jcnlwdGlvbiBhdCByZXN0IHVzaW5nIGEgQ01LIGFuZCBlbmZvcmNlcyBlbmNyeXB0aW9uIGluIHRyYW5zaXQuXG4gICAgICAgICAqIFZlcnNpb25pbmcgaXMgZW5hYmxlZCBvbiB0aGUgYnVja2V0IGZvciBhdWRpdCBhbmQgcmVjb3ZlcnkgcHVycG9zZXMuXG4gICAgICAgICAqL1xuICAgICAgICBjb25zdCBwaXBlbGluZUFydGlmYWN0QnVja2V0ID0gbmV3IEJ1Y2tldCh0aGlzLCAnQXJ0aWZhY3RCdWNrZXQnLCB7XG4gICAgICAgICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgICAgICAgZW5jcnlwdGlvbjogQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IEJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQWRkIENESy1uYWcgc3VwcHJlc3Npb25zIGZvciB0aGUgYXJ0aWZhY3QgYnVja2V0LlxuICAgICAgICAgKi9cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHBpcGVsaW5lQXJ0aWZhY3RCdWNrZXQsIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMScsXG4gICAgICAgICAgICAgICAgcmVhc29uOiAnVGVtcG9yYXJ5IGFydGlmYWN0IGJ1Y2tldCwgYWNjZXNzIGxvZ3MgYXJlIG5vdCBuZWVkZWQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgXSk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENyZWF0ZSB0aGUgSUFNIHJvbGUgZm9yIHRoZSBwaXBlbGluZS5cbiAgICAgICAgICovXG4gICAgICAgIHRoaXMucGlwZWxpbmVSb2xlID0gbmV3IFJvbGUodGhpcywgJ1BpcGVsaW5lUm9sZScsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoJ2NvZGVwaXBlbGluZS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHcmFudCBhY2Nlc3MgdG8gdGhlIHNvdXJjZSBidWNrZXQgZm9yIHRoZSBwaXBlbGluZSByb2xlLlxuICAgICAgICAgKi9cbiAgICAgICAgY29uZmlnQnVja2V0LmdyYW50UmVhZCh0aGlzLnBpcGVsaW5lUm9sZSk7XG5cbiAgICAgICAgY29uc3Qgc3ludGhTdGVwID0gbmV3IENvZGVCdWlsZFN0ZXAoJ1N5bnRoJywge1xuICAgICAgICAgICAgaW5wdXQ6IGJ1Y2tldFNvdXJjZSxcbiAgICAgICAgICAgIHByaW1hcnlPdXRwdXREaXJlY3Rvcnk6IGAke3Byb3BlcnRpZXMud29ya2luZ0ZvbGRlcn0vY2RrLm91dGAsXG4gICAgICAgICAgICBpbnN0YWxsQ29tbWFuZHM6IFsnbnBtIGkgLWcgYXdzLWNkayddLFxuICAgICAgICAgICAgLy8gVXNpbmcgZ2xvYmFsbHkgaW5zdGFsbGVkIENESyBkdWUgdG8gdGhpcyBpc3N1ZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzI4NTE5XG4gICAgICAgICAgICBjb21tYW5kczogW2BjZCAke3Byb3BlcnRpZXMud29ya2luZ0ZvbGRlcn1gLCAnbnBtIGNpJywgJ25wbSBydW4gYnVpbGQnLCAnY2RrIHN5bnRoIC0tYWxsJ10sXG4gICAgICAgICAgICBidWlsZEVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgYnVpbGRJbWFnZTogTGludXhCdWlsZEltYWdlLlNUQU5EQVJEXzdfMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYXJ0aWFsQnVpbGRTcGVjOiBCdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgICAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbGw6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdydW50aW1lLXZlcnNpb25zJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVqczogJzIyLngnLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSksXG4gICAgICAgIH0pO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ3JlYXRlIHRoZSBDb2RlUGlwZWxpbmUgd2l0aCB0aGUgZm9sbG93aW5nIGNvbmZpZ3VyYXRpb246XG4gICAgICAgICAqIC0gU3ludGhlc2lzIHN0ZXAgdGhhdCBidWlsZHMgYW5kIHN5bnRoZXNpemVzIHRoZSBDREsgYXBwXG4gICAgICAgICAqIC0gQ3VzdG9tIGFydGlmYWN0IGJ1Y2tldCB3aXRoIGVuY3J5cHRpb25cbiAgICAgICAgICogLSBWUEMgaW50ZWdyYXRpb24gZm9yIG5ldHdvcmsgaXNvbGF0aW9uXG4gICAgICAgICAqIC0gQ3Jvc3MtYWNjb3VudCBrZXkgc3VwcG9ydCBmb3IgbXVsdGktYWNjb3VudCBkZXBsb3ltZW50c1xuICAgICAgICAgKi9cbiAgICAgICAgY29uc3QgcGlwZWxpbmUgPSBuZXcgQ29kZVBpcGVsaW5lKHRoaXMsICdQaXBlbGluZScsIHtcbiAgICAgICAgICAgIHN5bnRoOiBzeW50aFN0ZXAsXG4gICAgICAgICAgICBhcnRpZmFjdEJ1Y2tldDogcGlwZWxpbmVBcnRpZmFjdEJ1Y2tldCxcbiAgICAgICAgICAgIGNyb3NzQWNjb3VudEtleXM6IHRydWUsXG4gICAgICAgICAgICBwaXBlbGluZU5hbWU6IGAke2lkfS1waXBlbGluZWAsXG4gICAgICAgICAgICB1c2VQaXBlbGluZVJvbGVGb3JBY3Rpb25zOiB0cnVlLFxuICAgICAgICAgICAgcGlwZWxpbmVUeXBlOiBQaXBlbGluZVR5cGUuVjIsXG4gICAgICAgICAgICByb2xlOiB0aGlzLnBpcGVsaW5lUm9sZSxcbiAgICAgICAgICAgIGNvZGVCdWlsZERlZmF1bHRzOiB7XG4gICAgICAgICAgICAgICAgYnVpbGRFbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgICAgICBidWlsZEltYWdlOiBMaW51eEJ1aWxkSW1hZ2UuU1RBTkRBUkRfN18wLFxuICAgICAgICAgICAgICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgTk9ERV9WRVJTSU9OOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6ICcyMi54JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGNvcmVXYXZlID0gcGlwZWxpbmUuYWRkV2F2ZSgnQ29yZScpO1xuXG4gICAgICAgIGxldCBzdGFnZVNlcXVlbmNlID0gMTtcbiAgICAgICAgY29uc3QgY29yZVN0YWdlVGFncyA9IHtcbiAgICAgICAgICAgIC4uLnByb3BlcnRpZXMudGFncyxcbiAgICAgICAgICAgIHBhcmVudDogdGhpcy5zdGFja05hbWUsXG4gICAgICAgICAgICBzZXF1ZW5jZTogKHN0YWdlU2VxdWVuY2UrKykudG9TdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgY29yZVByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzLmNvcmVTdGFnZVByb3BlcnRpZXNcbiAgICAgICAgICAgID8geyAuLi5wcm9wZXJ0aWVzLmNvcmVTdGFnZVByb3BlcnRpZXMsIHRhZ3M6IGNvcmVTdGFnZVRhZ3MgfVxuICAgICAgICAgICAgOiB7IHRhZ3M6IGNvcmVTdGFnZVRhZ3MgfTtcblxuICAgICAgICBjb25zdCBjb3JlU3RhZ2UgPSBuZXcgQ29yZVN0YWdlKHRoaXMsICdDb3JlJywgY29yZVByb3BlcnRpZXMpO1xuICAgICAgICBjb3JlV2F2ZS5hZGRTdGFnZShjb3JlU3RhZ2UpO1xuXG4gICAgICAgIGNvbnN0IGFwcGxpY2F0aW9uc1N0YWdlVGFncyA9IHtcbiAgICAgICAgICAgIC4uLnByb3BlcnRpZXMudGFncyxcbiAgICAgICAgICAgIHBhcmVudDogdGhpcy5zdGFja05hbWUsXG4gICAgICAgICAgICBzZXF1ZW5jZTogKHN0YWdlU2VxdWVuY2UrKykudG9TdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29yZVdhdmUuYWRkU3RhZ2UoXG4gICAgICAgICAgICBuZXcgQ29udGFpbmVyc1BpcGVsaW5lU3RhZ2UodGhpcywgJ0FwcGxpY2F0aW9ucycsIHtcbiAgICAgICAgICAgICAgICBhcHBsaWNhdGlvbkxpc3Q6IHByb3BlcnRpZXMuYXBwbGljYXRpb25MaXN0LFxuICAgICAgICAgICAgICAgIHRhZ3M6IGFwcGxpY2F0aW9uc1N0YWdlVGFncyxcbiAgICAgICAgICAgICAgICBzb3VyY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgYnVja2V0TmFtZTogcHJvcGVydGllcy5jb25maWdCdWNrZXROYW1lLFxuICAgICAgICAgICAgICAgICAgICBidWNrZXRLZXk6IGJ1Y2tldEtleSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGVudjogcHJvcGVydGllcy5lbnYsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBiYWNrZW5kV2F2ZSA9IHBpcGVsaW5lLmFkZFdhdmUoJ0JhY2tlbmQnKTtcblxuICAgICAgICBjb25zdCBzdG9yYWdlU3RhZ2UgPSBuZXcgU3RvcmFnZVN0YWdlKHRoaXMsICdTdG9yYWdlJywge1xuICAgICAgICAgICAgYXNzZXRzUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIHNlZWRQYXRoczogcHJvcGVydGllcy5wZXRJbWFnZXNQYXRocyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhdXJvcmFEYXRhYmFzZVByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBlbmdpbmVWZXJzaW9uOiBwcm9wZXJ0aWVzLnBvc3RncmVzRW5naW5lVmVyc2lvbixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgLi4ucHJvcGVydGllcy50YWdzLFxuICAgICAgICAgICAgICAgIHBhcmVudDogdGhpcy5zdGFja05hbWUsXG4gICAgICAgICAgICAgICAgc2VxdWVuY2U6IChzdGFnZVNlcXVlbmNlKyspLnRvU3RyaW5nKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZW52OiBwcm9wZXJ0aWVzLmVudixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmFja2VuZFdhdmUuYWRkU3RhZ2Uoc3RvcmFnZVN0YWdlLCB7XG4gICAgICAgICAgICBwb3N0OiBbc3RvcmFnZVN0YWdlLmdldEREQlNlZWRpbmdTdGVwKHRoaXMsIGNvbmZpZ0J1Y2tldCksIHN0b3JhZ2VTdGFnZS5nZXRSRFNTZWVkaW5nU3RlcCh0aGlzKV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGNvbXB1dGVTdGFnZSA9IG5ldyBDb21wdXRlU3RhZ2UodGhpcywgJ0NvbXB1dGUnLCB7XG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgLi4ucHJvcGVydGllcy50YWdzLFxuICAgICAgICAgICAgICAgIHBhcmVudDogdGhpcy5zdGFja05hbWUsXG4gICAgICAgICAgICAgICAgc2VxdWVuY2U6IChzdGFnZVNlcXVlbmNlKyspLnRvU3RyaW5nKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZW52OiBwcm9wZXJ0aWVzLmVudixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmFja2VuZFdhdmUuYWRkU3RhZ2UoY29tcHV0ZVN0YWdlKTtcblxuICAgICAgICBjb25zdCBtaWNyb3NlcnZpY2VzU3RhZ2VUYWdzID0ge1xuICAgICAgICAgICAgLi4ucHJvcGVydGllcy50YWdzLFxuICAgICAgICAgICAgcGFyZW50OiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgICAgICAgIHNlcXVlbmNlOiAoc3RhZ2VTZXF1ZW5jZSsrKS50b1N0cmluZygpLFxuICAgICAgICB9O1xuXG4gICAgICAgIHBpcGVsaW5lLmFkZFN0YWdlKFxuICAgICAgICAgICAgbmV3IE1pY3Jvc2VydmljZXNTdGFnZSh0aGlzLCAnTWljcm9zZXJ2aWNlcycsIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wZXJ0aWVzLm1pY3Jvc2VydmljZXNQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgIHRhZ3M6IG1pY3Jvc2VydmljZXNTdGFnZVRhZ3MsXG4gICAgICAgICAgICAgICAgZW52OiBwcm9wZXJ0aWVzLmVudixcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBCdWlsZCB0aGUgcGlwZWxpbmUgdG8gYWRkIHN1cHByZXNzaW9ucyBhbmQgY3VzdG9taXphdGlvbnMuXG4gICAgICAgICAqIFRoaXMgaXMgcmVxdWlyZWQgYmVmb3JlIGFkZGluZyBhZGRpdGlvbmFsIGNvbmZpZ3VyYXRpb25zLlxuICAgICAgICAgKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9jZGtsYWJzL2Nkay1uYWc/dGFiPXJlYWRtZS1vdi1maWxlI3N1cHByZXNzaW5nLWF3cy1jZGstbGlicGlwZWxpbmVzLXZpb2xhdGlvbnNcbiAgICAgICAgICovXG4gICAgICAgIHBpcGVsaW5lLmJ1aWxkUGlwZWxpbmUoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogR3JhbnQgYWNjZXNzIHRvIGRlc2NyaWJlIFByZWZpeCBsaXN0c1xuICAgICAgICAgKi9cbiAgICAgICAgaWYgKHBpcGVsaW5lLnN5bnRoUHJvamVjdC5yb2xlKSB7XG4gICAgICAgICAgICBuZXcgUG9saWN5KHRoaXMsICdDbG91ZEZvcm1hdGlvblBvbGljeScsIHtcbiAgICAgICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkxpc3RSZXNvdXJjZXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlYzI6RGVzY3JpYmVNYW5hZ2VkUHJlZml4TGlzdHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlYzI6R2V0TWFuYWdlZFByZWZpeExpc3RFbnRyaWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJvbGVzOiBbcGlwZWxpbmUuc3ludGhQcm9qZWN0LnJvbGVdLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogQWRkIENESy1uYWcgc3VwcHJlc3Npb25zIGZvciB0aGUgcGlwZWxpbmUgcm9sZS5cbiAgICAgICAgICovXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHBpcGVsaW5lLnBpcGVsaW5lLnJvbGUsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnVGhlIHBpcGVsaW5lIHJvbGUgaXMgbm90IHNjb3BlZCB0byBhIHNwZWNpZmljIHJlc291cmNlJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFkZCBDREstbmFnIHN1cHByZXNzaW9ucyBmb3IgdGhlIHN5bnRoIHByb2plY3QuXG4gICAgICAgICAqL1xuICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICBwaXBlbGluZS5zeW50aFByb2plY3QsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnVGhlIHBpcGVsaW5lIHJvbGUgaXMgbm90IHNjb3BlZCB0byBhIHNwZWNpZmljIHJlc291cmNlJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0FXUyBNYW5hZ2VkIHBvbGljeSBpcyBhY2NlcHRhYmxlIGhlcmUnLFxuICAgICAgICAgICAgICAgICAgICBhcHBsaWVzVG86IFsnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvQVdTQ29kZUFydGlmYWN0UmVhZE9ubHlBY2Nlc3MnXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFkZCBDREstbmFnIHN1cHByZXNzaW9ucyBmb3IgdGhlIHNlbGYtbXV0YXRpb24gcHJvamVjdC5cbiAgICAgICAgICovXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHBpcGVsaW5lLnNlbGZNdXRhdGlvblByb2plY3QsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnRXBoZW1lcmFsIFN5bnRoIFByb2plY3Qgbm90IGxpbWl0ZWQgdG8gc3BlY2lmaWMgcmVzb3VyY2Ugb3IgYWN0aW9uJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFkZCBzdGFjay1sZXZlbCBDREstbmFnIHN1cHByZXNzaW9ucy5cbiAgICAgICAgICogQWRkZWQgYXMgc3RhY2sgc3VwcHJlc3Npb24gc2luY2UgcGF0aCBjYW4gY2hhbmdlIGJhc2VkIG9uIHRoZSBjb250ZXh0IGFuZCByZXBvIG5hbWUuXG4gICAgICAgICAqIFN1cHByZXNzaW9uIGNhbiBhbHNvIGJlIGxpbWl0ZWQgYnkgcGF0aCBidXQgbXVzdCBiZSB1cGRhdGVkIGV2ZXJ5IHRpbWUgdGhlIHJlcG8gY2hhbmdlcy5cbiAgICAgICAgICovXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnRXBoZW1lcmFsIFN5bnRoIFByb2plY3Qgbm90IGxpbWl0ZWQgdG8gc3BlY2lmaWMgcmVzb3VyY2Ugb3IgYWN0aW9uJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0I0JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnQ0RLIFBpcGVsaW5lcyB1c2VzIENNS3Mgd2l0aCBjcm9zcyBhY2NvdW50IC8gcmVnaW9uLiBPbWl0dGVkIGZvciBzaW1wbGljaXR5LicsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHZW5lcmF0ZSBQaXBlbGluZUFybiBPdXRwdXQgd2l0aCB0aGUgc2VsZi1tdXRhdGluZyBQaXBlbGluZSBBUk5cbiAgICAgICAgICovXG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ1BpcGVsaW5lQXJuJywge1xuICAgICAgICAgICAgdmFsdWU6IHBpcGVsaW5lLnBpcGVsaW5lLnBpcGVsaW5lQXJuLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogJ1BpcGVsaW5lQXJuJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRhZyBhbGwgY2hpbGQgcmVzb3VyY2VzIG9mIHRoZSBhcHBsaWNhdGlvblxuICAgICAgICAgKi9cblxuICAgICAgICBpZiAocHJvcGVydGllcy50YWdzKSB7XG4gICAgICAgICAgICBVdGlsaXRpZXMuVGFnQ29uc3RydWN0KHRoaXMsIHByb3BlcnRpZXMudGFncyk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=