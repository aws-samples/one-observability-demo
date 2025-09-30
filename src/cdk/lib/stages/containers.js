"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainersStack = exports.ContainersPipelineStage = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codepipeline_1 = require("aws-cdk-lib/aws-codepipeline");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const cdk_nag_1 = require("cdk-nag");
const aws_codepipeline_actions_1 = require("aws-cdk-lib/aws-codepipeline-actions");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
/**
 * CDK Stage for the Containers Pipeline
 */
class ContainersPipelineStage extends aws_cdk_lib_1.Stage {
    /**
     * Creates a new Containers Pipeline Stage
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stage
     */
    constructor(scope, id, properties) {
        super(scope, id);
        new ContainersStack(this, 'ContainersStack', properties);
    }
}
exports.ContainersPipelineStage = ContainersPipelineStage;
/**
 * Stack containing the containers build pipeline and ECR repositories
 */
class ContainersStack extends aws_cdk_lib_1.Stack {
    /**
     * Creates a new Containers Stack
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stack
     * @throws Error when source or applicationList properties are missing
     */
    constructor(scope, id, properties) {
        super(scope, id, properties);
        /** Map of application names to their ECR repositories */
        this.applicationRepositories = new Map();
        if (!properties?.source || !properties?.applicationList) {
            throw new Error('Source and applicationList are required');
        }
        const pipelineRole = new aws_iam_1.Role(this, 'PipelineRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('codepipeline.amazonaws.com'),
        });
        const codeBuildRole = new aws_iam_1.Role(this, 'CodeBuildRole', {
            assumedBy: new aws_iam_1.CompositePrincipal(new aws_iam_1.ServicePrincipal('codebuild.amazonaws.com'), pipelineRole),
        });
        // Create ECR repositories for each application
        for (const app of properties.applicationList) {
            const repository = new aws_ecr_1.Repository(this, `${app.name}Repository`, {
                repositoryName: app.name.toLowerCase(),
                imageScanOnPush: true,
                emptyOnDelete: true,
                imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
                removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            });
            repository.grantPullPush(codeBuildRole);
            cdk_nag_1.NagSuppressions.addResourceSuppressions(repository, [
                {
                    id: 'AwsSolutions-ECR1',
                    reason: 'This is a sample application, so no access logging is required',
                },
            ]);
            this.applicationRepositories.set(app.name, repository);
        }
        const artifactBucket = new aws_s3_1.Bucket(this, 'ContainersPipelineArtifact', {
            enforceSSL: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
        });
        // Create CodePipeline
        this.pipeline = new aws_codepipeline_1.Pipeline(this, 'ContainersPipeline', {
            restartExecutionOnUpdate: true,
            pipelineType: aws_codepipeline_1.PipelineType.V2,
            usePipelineRoleForActions: true,
            role: pipelineRole,
            pipelineName: `${this.stackName}-pipeline`,
            artifactBucket: artifactBucket,
        });
        const sourceOutput = new aws_codepipeline_1.Artifact();
        const sourceBucket = aws_s3_1.Bucket.fromBucketName(this, 'SourceBucket', properties.source.bucketName);
        const pipelineLogArn = aws_cdk_lib_1.Arn.format({
            service: 'logs',
            resource: 'log-group',
            resourceName: '/aws/codepipeline/*',
            arnFormat: aws_cdk_lib_1.ArnFormat.COLON_RESOURCE_NAME,
            account: this.account,
            region: this.region,
            partition: 'aws',
        }, aws_cdk_lib_1.Stack.of(this));
        const cloudWatchPolicy = new aws_iam_1.Policy(this, 'CloudwatchPolicy', {
            statements: [
                new aws_iam_1.PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [pipelineLogArn],
                }),
            ],
            roles: [pipelineRole, codeBuildRole],
        });
        sourceBucket.grantRead(pipelineRole);
        // Ensure CloudWatch policy is attached before pipeline actions
        this.pipeline.node.addDependency(cloudWatchPolicy);
        const sourceAction = new aws_codepipeline_actions_1.S3SourceAction({
            actionName: 'Source',
            bucket: sourceBucket,
            bucketKey: properties.source.bucketKey,
            output: sourceOutput,
            trigger: aws_codepipeline_actions_1.S3Trigger.POLL,
        });
        this.pipeline.addStage({
            stageName: 'Source',
            actions: [sourceAction],
        });
        // Create build steps for each application (parallel execution)
        const buildSteps = properties.applicationList.map((app) => {
            const repository = this.applicationRepositories.get(app.name);
            return new aws_codepipeline_actions_1.EcrBuildAndPublishAction({
                actionName: `Build-${app.name}`,
                repositoryName: repository.repositoryName,
                registryType: aws_codepipeline_actions_1.RegistryType.PRIVATE,
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
                retryMode: aws_codepipeline_1.RetryMode.FAILED_ACTIONS,
                result: aws_codepipeline_1.Result.RETRY,
            },
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.pipeline.artifactBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Artifact Bucket for application pipeline, access logs not needed',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions([codeBuildRole, this.pipeline.role], [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Allow access to repositories and Artifact bucket',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(cloudWatchPolicy, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Allow access to Cloudwatch Log Groups for pipeline execution',
            },
        ], true);
    }
}
exports.ContainersStack = ContainersStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvbnRhaW5lcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7OztFQUdFO0FBQ0YsNkNBQXNGO0FBQ3RGLG1FQUFtRztBQUNuRyxpREFBZ0U7QUFFaEUscUNBQTBDO0FBQzFDLG1GQUs4QztBQUM5QywrQ0FBK0Q7QUFDL0QsaURBQTBHO0FBZ0MxRzs7R0FFRztBQUNILE1BQWEsdUJBQXdCLFNBQVEsbUJBQUs7SUFDOUM7Ozs7O09BS0c7SUFDSCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQThDO1FBQ3BGLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsSUFBSSxlQUFlLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQzdELENBQUM7Q0FDSjtBQVhELDBEQVdDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLGVBQWdCLFNBQVEsbUJBQUs7SUFNdEM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUE4QztRQUNwRixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQWJqQyx5REFBeUQ7UUFDbEQsNEJBQXVCLEdBQTRCLElBQUksR0FBRyxFQUFzQixDQUFDO1FBY3BGLElBQUksQ0FBQyxVQUFVLEVBQUUsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLGVBQWUsRUFBRSxDQUFDO1lBQ3RELE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxjQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNoRCxTQUFTLEVBQUUsSUFBSSwwQkFBZ0IsQ0FBQyw0QkFBNEIsQ0FBQztTQUNoRSxDQUFDLENBQUM7UUFFSCxNQUFNLGFBQWEsR0FBRyxJQUFJLGNBQUksQ0FBQyxJQUFJLEVB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RUFBRSxVQUFVO1lBQ25CLFNBQVMsRUFBRTtnQkFDUCxTQUFTLEVBQUUsNEJBQVMsQ0FBQyxjQUFjO2dCQUNuQyxNQUFNLEVBQUUseUJBQU0sQ0FBQyxLQUFLO2FBQ3ZCO1NBQ0osQ0FBQyxDQUFDO1FBRUgseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDbkMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLEVBQzVCO1lBQ0k7Z0JBQ0ksRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLGtFQUFrRTthQUM3RTtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFFRix5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUNuQztZQUNJO2dCQUNJLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxrREFBa0Q7YUFDN0Q7U0FDSixFQUNELElBQUksQ0FDUCxDQUFDO1FBRUYseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDbkMsZ0JBQWdCLEVBQ2hCO1lBQ0k7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLDhEQUE4RDthQUN6RTtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7SUFDTixDQUFDO0NBQ0o7QUF4S0QsMENBd0tDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQgeyBBcm4sIEFybkZvcm1hdCwgUmVtb3ZhbFBvbGljeSwgU3RhY2ssIFN0YWNrUHJvcHMsIFN0YWdlIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQXJ0aWZhY3QsIFBpcGVsaW5lLCBQaXBlbGluZVR5cGUsIFJlc3VsdCwgUmV0cnlNb2RlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZSc7XG5pbXBvcnQgeyBSZXBvc2l0b3J5LCBUYWdNdXRhYmlsaXR5IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHtcbiAgICBFY3JCdWlsZEFuZFB1Ymxpc2hBY3Rpb24sXG4gICAgUmVnaXN0cnlUeXBlLFxuICAgIFMzU291cmNlQWN0aW9uLFxuICAgIFMzVHJpZ2dlcixcbn0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZS1hY3Rpb25zJztcbmltcG9ydCB7IEJsb2NrUHVibGljQWNjZXNzLCBCdWNrZXQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0IHsgQ29tcG9zaXRlUHJpbmNpcGFsLCBQb2xpY3ksIFBvbGljeVN0YXRlbWVudCwgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuXG4vKipcbiAqIERlZmluaXRpb24gZm9yIGFuIGFwcGxpY2F0aW9uIHRvIGJlIGJ1aWx0IGFuZCBkZXBsb3llZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnRhaW5lckRlZmluaXRpb24ge1xuICAgIC8qKiBUaGUgbmFtZSBvZiB0aGUgYXBwbGljYXRpb24gKi9cbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgLyoqIFBhdGggdG8gdGhlIERvY2tlcmZpbGUgZm9yIGJ1aWxkaW5nIHRoZSBhcHBsaWNhdGlvbiAqL1xuICAgIGRvY2tlckZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgUzMgc291cmNlIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTM1NvdXJjZVByb3BlcnRpZXMge1xuICAgIC8qKiBOYW1lIG9mIHRoZSBTMyBidWNrZXQgY29udGFpbmluZyBzb3VyY2UgY29kZSAqL1xuICAgIGJ1Y2tldE5hbWU6IHN0cmluZztcbiAgICAvKiogS2V5L3BhdGggdG8gdGhlIHNvdXJjZSBjb2RlIG9iamVjdCBpbiBTMyAqL1xuICAgIGJ1Y2tldEtleTogc3RyaW5nO1xufVxuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIHRoZSBDb250YWluZXJzIFBpcGVsaW5lIFN0YWdlXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGFpbmVyc1BpcGVsaW5lU3RhZ2VQcm9wZXJ0aWVzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gICAgLyoqIFMzIHNvdXJjZSBjb25maWd1cmF0aW9uICovXG4gICAgc291cmNlOiBTM1NvdXJjZVByb3BlcnRpZXM7XG4gICAgLyoqIExpc3Qgb2YgYXBwbGljYXRpb25zIHRvIGJ1aWxkIGFuZCBkZXBsb3kgKi9cbiAgICBhcHBsaWNhdGlvbkxpc3Q6IENvbnRhaW5lckRlZmluaXRpb25bXTtcbn1cblxuLyoqXG4gKiBDREsgU3RhZ2UgZm9yIHRoZSBDb250YWluZXJzIFBpcGVsaW5lXG4gKi9cbmV4cG9ydCBjbGFzcyBDb250YWluZXJzUGlwZWxpbmVTdGFnZSBleHRlbmRzIFN0YWdlIHtcbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IENvbnRhaW5lcnMgUGlwZWxpbmUgU3RhZ2VcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgc2NvcGUgaW4gd2hpY2ggdG8gZGVmaW5lIHRoaXMgY29uc3RydWN0XG4gICAgICogQHBhcmFtIGlkIC0gVGhlIHNjb3BlZCBjb25zdHJ1Y3QgSURcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIHN0YWdlXG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllcz86IENvbnRhaW5lcnNQaXBlbGluZVN0YWdlUHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgICAgICBuZXcgQ29udGFpbmVyc1N0YWNrKHRoaXMsICdDb250YWluZXJzU3RhY2snLCBwcm9wZXJ0aWVzKTtcbiAgICB9XG59XG5cbi8qKlxuICogU3RhY2sgY29udGFpbmluZyB0aGUgY29udGFpbmVycyBidWlsZCBwaXBlbGluZSBhbmQgRUNSIHJlcG9zaXRvcmllc1xuICovXG5leHBvcnQgY2xhc3MgQ29udGFpbmVyc1N0YWNrIGV4dGVuZHMgU3RhY2sge1xuICAgIC8qKiBNYXAgb2YgYXBwbGljYXRpb24gbmFtZXMgdG8gdGhlaXIgRUNSIHJlcG9zaXRvcmllcyAqL1xuICAgIHB1YmxpYyBhcHBsaWNhdGlvblJlcG9zaXRvcmllczogTWFwPHN0cmluZywgUmVwb3NpdG9yeT4gPSBuZXcgTWFwPHN0cmluZywgUmVwb3NpdG9yeT4oKTtcbiAgICAvKiogVGhlIENvZGVQaXBlbGluZSBmb3IgYnVpbGRpbmcgYXBwbGljYXRpb25zICovXG4gICAgcHVibGljIHBpcGVsaW5lOiBQaXBlbGluZTtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgQ29udGFpbmVycyBTdGFja1xuICAgICAqIEBwYXJhbSBzY29wZSAtIFRoZSBzY29wZSBpbiB3aGljaCB0byBkZWZpbmUgdGhpcyBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgc2NvcGVkIGNvbnN0cnVjdCBJRFxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgc3RhY2tcbiAgICAgKiBAdGhyb3dzIEVycm9yIHdoZW4gc291cmNlIG9yIGFwcGxpY2F0aW9uTGlzdCBwcm9wZXJ0aWVzIGFyZSBtaXNzaW5nXG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllcz86IENvbnRhaW5lcnNQaXBlbGluZVN0YWdlUHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQsIHByb3BlcnRpZXMpO1xuXG4gICAgICAgIGlmICghcHJvcGVydGllcz8uc291cmNlIHx8ICFwcm9wZXJ0aWVzPy5hcHBsaWNhdGlvbkxpc3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU291cmNlIGFuZCBhcHBsaWNhdGlvbkxpc3QgYXJlIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwaXBlbGluZVJvbGUgPSBuZXcgUm9sZSh0aGlzLCAnUGlwZWxpbmVSb2xlJywge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbCgnY29kZXBpcGVsaW5lLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgY29kZUJ1aWxkUm9sZSA9IG5ldyBSb2xlKHRoaXMsICdDb2RlQnVpbGRSb2xlJywge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgQ29tcG9zaXRlUHJpbmNpcGFsKG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdjb2RlYnVpbGQuYW1hem9uYXdzLmNvbScpLCBwaXBlbGluZVJvbGUpLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgRUNSIHJlcG9zaXRvcmllcyBmb3IgZWFjaCBhcHBsaWNhdGlvblxuICAgICAgICBmb3IgKGNvbnN0IGFwcCBvZiBwcm9wZXJ0aWVzLmFwcGxpY2F0aW9uTGlzdCkge1xuICAgICAgICAgICAgY29uc3QgcmVwb3NpdG9yeSA9IG5ldyBSZXBvc2l0b3J5KHRoaXMsIGAke2FwcC5uYW1lfVJlcG9zaXRvcnlgLCB7XG4gICAgICAgICAgICAgICAgcmVwb3NpdG9yeU5hbWU6IGFwcC5uYW1lLnRvTG93ZXJDYXNlKCksXG4gICAgICAgICAgICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgICAgICAgICAgICAgaW1hZ2VUYWdNdXRhYmlsaXR5OiBUYWdNdXRhYmlsaXR5Lk1VVEFCTEUsXG4gICAgICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJlcG9zaXRvcnkuZ3JhbnRQdWxsUHVzaChjb2RlQnVpbGRSb2xlKTtcbiAgICAgICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhyZXBvc2l0b3J5LCBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1FQ1IxJyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnVGhpcyBpcyBhIHNhbXBsZSBhcHBsaWNhdGlvbiwgc28gbm8gYWNjZXNzIGxvZ2dpbmcgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdKTtcblxuICAgICAgICAgICAgdGhpcy5hcHBsaWNhdGlvblJlcG9zaXRvcmllcy5zZXQoYXBwLm5hbWUsIHJlcG9zaXRvcnkpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXJ0aWZhY3RCdWNrZXQgPSBuZXcgQnVja2V0KHRoaXMsICdDb250YWluZXJzUGlwZWxpbmVBcnRpZmFjdCcsIHtcbiAgICAgICAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBCbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDb2RlUGlwZWxpbmVcbiAgICAgICAgdGhpcy5waXBlbGluZSA9IG5ldyBQaXBlbGluZSh0aGlzLCAnQ29udGFpbmVyc1BpcGVsaW5lJywge1xuICAgICAgICAgICAgcmVzdGFydEV4ZWN1dGlvbk9uVXBkYXRlOiB0cnVlLFxuICAgICAgICAgICAgcGlwZWxpbmVUeXBlOiBQaXBlbGluZVR5cGUuVjIsXG4gICAgICAgICAgICB1c2VQaXBlbGluZVJvbGVGb3JBY3Rpb25zOiB0cnVlLFxuICAgICAgICAgICAgcm9sZTogcGlwZWxpbmVSb2xlLFxuICAgICAgICAgICAgcGlwZWxpbmVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tcGlwZWxpbmVgLFxuICAgICAgICAgICAgYXJ0aWZhY3RCdWNrZXQ6IGFydGlmYWN0QnVja2V0LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzb3VyY2VPdXRwdXQgPSBuZXcgQXJ0aWZhY3QoKTtcbiAgICAgICAgY29uc3Qgc291cmNlQnVja2V0ID0gQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsICdTb3VyY2VCdWNrZXQnLCBwcm9wZXJ0aWVzLnNvdXJjZS5idWNrZXROYW1lKTtcblxuICAgICAgICBjb25zdCBwaXBlbGluZUxvZ0FybiA9IEFybi5mb3JtYXQoXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgc2VydmljZTogJ2xvZ3MnLFxuICAgICAgICAgICAgICAgIHJlc291cmNlOiAnbG9nLWdyb3VwJyxcbiAgICAgICAgICAgICAgICByZXNvdXJjZU5hbWU6ICcvYXdzL2NvZGVwaXBlbGluZS8qJyxcbiAgICAgICAgICAgICAgICBhcm5Gb3JtYXQ6IEFybkZvcm1hdC5DT0xPTl9SRVNPVVJDRV9OQU1FLFxuICAgICAgICAgICAgICAgIGFjY291bnQ6IHRoaXMuYWNjb3VudCxcbiAgICAgICAgICAgICAgICByZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgICAgICAgICAgIHBhcnRpdGlvbjogJ2F3cycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgU3RhY2sub2YodGhpcyksXG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgY2xvdWRXYXRjaFBvbGljeSA9IG5ldyBQb2xpY3kodGhpcywgJ0Nsb3Vkd2F0Y2hQb2xpY3knLCB7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnbG9nczpDcmVhdGVMb2dHcm91cCcsICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtwaXBlbGluZUxvZ0Fybl0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcm9sZXM6IFtwaXBlbGluZVJvbGUsIGNvZGVCdWlsZFJvbGVdLFxuICAgICAgICB9KTtcblxuICAgICAgICBzb3VyY2VCdWNrZXQuZ3JhbnRSZWFkKHBpcGVsaW5lUm9sZSk7XG5cbiAgICAgICAgLy8gRW5zdXJlIENsb3VkV2F0Y2ggcG9saWN5IGlzIGF0dGFjaGVkIGJlZm9yZSBwaXBlbGluZSBhY3Rpb25zXG4gICAgICAgIHRoaXMucGlwZWxpbmUubm9kZS5hZGREZXBlbmRlbmN5KGNsb3VkV2F0Y2hQb2xpY3kpO1xuXG4gICAgICAgIGNvbnN0IHNvdXJjZUFjdGlvbiA9IG5ldyBTM1NvdXJjZUFjdGlvbih7XG4gICAgICAgICAgICBhY3Rpb25OYW1lOiAnU291cmNlJyxcbiAgICAgICAgICAgIGJ1Y2tldDogc291cmNlQnVja2V0LFxuICAgICAgICAgICAgYnVja2V0S2V5OiBwcm9wZXJ0aWVzLnNvdXJjZS5idWNrZXRLZXksXG4gICAgICAgICAgICBvdXRwdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICAgIHRyaWdnZXI6IFMzVHJpZ2dlci5QT0xMLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnBpcGVsaW5lLmFkZFN0YWdlKHtcbiAgICAgICAgICAgIHN0YWdlTmFtZTogJ1NvdXJjZScsXG4gICAgICAgICAgICBhY3Rpb25zOiBbc291cmNlQWN0aW9uXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGJ1aWxkIHN0ZXBzIGZvciBlYWNoIGFwcGxpY2F0aW9uIChwYXJhbGxlbCBleGVjdXRpb24pXG4gICAgICAgIGNvbnN0IGJ1aWxkU3RlcHMgPSBwcm9wZXJ0aWVzLmFwcGxpY2F0aW9uTGlzdC5tYXAoKGFwcCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVwb3NpdG9yeSA9IHRoaXMuYXBwbGljYXRpb25SZXBvc2l0b3JpZXMuZ2V0KGFwcC5uYW1lKSE7XG5cbiAgICAgICAgICAgIHJldHVybiBuZXcgRWNyQnVpbGRBbmRQdWJsaXNoQWN0aW9uKHtcbiAgICAgICAgICAgICAgICBhY3Rpb25OYW1lOiBgQnVpbGQtJHthcHAubmFtZX1gLFxuICAgICAgICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiByZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICAgICAgICAgIHJlZ2lzdHJ5VHlwZTogUmVnaXN0cnlUeXBlLlBSSVZBVEUsXG4gICAgICAgICAgICAgICAgZG9ja2VyZmlsZURpcmVjdG9yeVBhdGg6IGFwcC5kb2NrZXJGaWxlUGF0aCxcbiAgICAgICAgICAgICAgICBpbnB1dDogc291cmNlT3V0cHV0LFxuICAgICAgICAgICAgICAgIGltYWdlVGFnczogWydsYXRlc3QnXSxcbiAgICAgICAgICAgICAgICByb2xlOiBjb2RlQnVpbGRSb2xlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBidWlsZCBzdGFnZSB3aXRoIGFsbCBzdGVwcyBydW5uaW5nIGluIHBhcmFsbGVsXG4gICAgICAgIHRoaXMucGlwZWxpbmUuYWRkU3RhZ2Uoe1xuICAgICAgICAgICAgc3RhZ2VOYW1lOiAnYnVpbGQnLFxuICAgICAgICAgICAgYWN0aW9uczogYnVpbGRTdGVwcyxcbiAgICAgICAgICAgIG9uRmFpbHVyZToge1xuICAgICAgICAgICAgICAgIHJldHJ5TW9kZTogUmV0cnlNb2RlLkZBSUxFRF9BQ1RJT05TLFxuICAgICAgICAgICAgICAgIHJlc3VsdDogUmVzdWx0LlJFVFJZLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgdGhpcy5waXBlbGluZS5hcnRpZmFjdEJ1Y2tldCxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxJyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnQXJ0aWZhY3QgQnVja2V0IGZvciBhcHBsaWNhdGlvbiBwaXBlbGluZSwgYWNjZXNzIGxvZ3Mgbm90IG5lZWRlZCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIFtjb2RlQnVpbGRSb2xlLCB0aGlzLnBpcGVsaW5lLnJvbGVdLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0FsbG93IGFjY2VzcyB0byByZXBvc2l0b3JpZXMgYW5kIEFydGlmYWN0IGJ1Y2tldCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hQb2xpY3ksXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnQWxsb3cgYWNjZXNzIHRvIENsb3Vkd2F0Y2ggTG9nIEdyb3VwcyBmb3IgcGlwZWxpbmUgZXhlY3V0aW9uJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG4gICAgfVxufVxuIl19