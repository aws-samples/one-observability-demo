"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopEcs = void 0;
/**
 * Amazon ECS cluster construct for the One Observability Workshop.
 *
 * This module provides a CDK construct for creating and managing an Amazon ECS cluster
 * with EC2 capacity providers, auto scaling groups, and enhanced container insights.
 * The cluster is configured for optimal observability and monitoring capabilities.
 *
 * @packageDocumentation
 */
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const aws_autoscaling_1 = require("aws-cdk-lib/aws-autoscaling");
const cdk_nag_1 = require("cdk-nag");
const constants_1 = require("../../bin/constants");
const opensearch_pipeline_1 = require("./opensearch-pipeline");
/**
 * A CDK construct that creates an Amazon ECS cluster with EC2 capacity.
 *
 * This construct sets up:
 * - ECS cluster with enhanced container insights
 * - Auto Scaling Group with ECS-optimized AMI
 * - Security group for cluster resources
 * - Capacity provider for efficient resource management
 * - CloudFormation exports for cross-stack references
 *
 * The cluster is configured with best practices for security, monitoring,
 * and cost optimization.
 */
class WorkshopEcs extends constructs_1.Construct {
    /**
     * Creates a new WorkshopEcs construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the ECS cluster
     */
    constructor(scope, id, properties) {
        super(scope, id);
        // Store the pipeline reference for use by ECS services
        this.openSearchPipeline = properties.openSearchPipeline;
        this.securityGroup = new aws_ec2_1.SecurityGroup(this, 'SecurityGroup', {
            vpc: properties.vpc,
            description: 'Security group for ECS cluster resources',
            allowAllOutbound: true,
            securityGroupName: `${id}-ecs-security-group`,
        });
        this.cluster = new aws_ecs_1.Cluster(this, 'Cluster', {
            containerInsightsV2: aws_ecs_1.ContainerInsights.ENHANCED,
            vpc: properties.vpc,
            clusterName: `${id}-cluster`,
        });
        this.autoScalingGroup = new aws_autoscaling_1.AutoScalingGroup(this, 'AutoScalingGroup', {
            vpc: properties.vpc,
            machineImage: aws_ecs_1.EcsOptimizedImage.amazonLinux2023(),
            minCapacity: properties.ecsEc2Capacity || 0,
            maxCapacity: properties.ecsEc2Capacity || 2,
            desiredCapacity: properties.ecsEc2Capacity || 2,
            instanceType: properties.ecsEc2InstanceType
                ? new aws_ec2_1.InstanceType(properties.ecsEc2InstanceType)
                : aws_ec2_1.InstanceType.of(aws_ec2_1.InstanceClass.T3, aws_ec2_1.InstanceSize.MEDIUM),
            blockDevices: [
                {
                    deviceName: '/dev/xvda',
                    volume: aws_autoscaling_1.BlockDeviceVolume.ebs(30, { encrypted: true }),
                },
            ],
            notifications: [
                {
                    topic: properties.topic,
                    scalingEvents: aws_autoscaling_1.ScalingEvents.ALL,
                },
            ],
            autoScalingGroupName: `${id}-ecs-asg`,
        });
        this.cluster.addAsgCapacityProvider(new aws_ecs_1.AsgCapacityProvider(this, 'AsgCapacityProvider', {
            autoScalingGroup: this.autoScalingGroup,
        }));
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.autoScalingGroup, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Autoscaling group needs access to all ECS tasks',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.cluster, [
            {
                id: 'AwsSolutions-ECS4',
                reason: 'Containers insights v2 is enabled, false positive',
            },
        ]);
        this.createExports();
    }
    /**
     * Creates CloudFormation exports for the ECS cluster resources.
     * These exports allow other stacks to reference the cluster.
     */
    createExports() {
        new aws_cdk_lib_1.CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            exportName: constants_1.ECS_CLUSTER_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'ClusterName', {
            value: this.cluster.clusterName,
            exportName: constants_1.ECS_CLUSTER_NAME_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'SecurityGroupId', {
            value: this.securityGroup.securityGroupId,
            exportName: constants_1.ECS_SECURITY_GROUP_ID_EXPORT_NAME,
        });
    }
    /**
     * Imports an ECS cluster from CloudFormation exports.
     *
     * This static method allows other stacks to reference an ECS cluster
     * that was created by this construct and exported via CloudFormation.
     *
     * @param scope - The construct scope where the cluster will be imported
     * @param id - The construct identifier for the imported resources
     * @param vpc - The VPC where the cluster is deployed
     * @returns Object containing the imported cluster, security group, and optional pipeline
     */
    static importFromExports(scope, id, vpc) {
        const clusterName = aws_cdk_lib_1.Fn.importValue(constants_1.ECS_CLUSTER_NAME_EXPORT_NAME);
        const securityGroupId = aws_cdk_lib_1.Fn.importValue(constants_1.ECS_SECURITY_GROUP_ID_EXPORT_NAME);
        const cluster = aws_ecs_1.Cluster.fromClusterAttributes(scope, `${id}-Cluster`, {
            clusterName: clusterName,
            vpc: vpc,
        });
        const securityGroup = aws_ec2_1.SecurityGroup.fromSecurityGroupId(scope, `${id}-SecurityGroup`, securityGroupId);
        // Import OpenSearch pipeline information if available
        // This provides backward compatibility - if pipeline exports don't exist, 
        // the import will gracefully handle the missing values
        let openSearchPipeline;
        try {
            const pipelineImports = opensearch_pipeline_1.OpenSearchPipeline.importFromExports();
            openSearchPipeline = {
                pipelineEndpoint: pipelineImports.pipelineEndpoint,
                pipelineArn: pipelineImports.pipelineArn,
                pipelineRoleArn: pipelineImports.pipelineRoleArn,
            };
        }
        catch (error) {
            // Pipeline exports don't exist - this is fine for backward compatibility
            openSearchPipeline = undefined;
        }
        return { cluster, securityGroup, openSearchPipeline };
    }
}
exports.WorkshopEcs = WorkshopEcs;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0VBR0U7OztBQUVGOzs7Ozs7OztHQVFHO0FBRUgsMkNBQXVDO0FBQ3ZDLDZDQUE0QztBQUM1QyxpREFBbUg7QUFDbkgsaURBQXFIO0FBQ3JILGlFQUFpRztBQUVqRyxxQ0FBMEM7QUFDMUMsbURBSTZCO0FBQzdCLCtEQUEyRDtBQWtCM0Q7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsTUFBYSxXQUFZLFNBQVEsc0JBQVM7SUFVdEM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUF5QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLHVEQUF1RDtRQUN2RCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsVUFBVSxDQUFDLGtCQUFrQixDQUFDO1FBRXhELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSx1QkFBYSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDMUQsR0FBRyxFQUFFLFVBQVUsQ0FBQyxHQUFHO1lBQ25CLFdBQVcsRUFBRSwwQ0FBMEM7WUFDdkQsZ0JBQWdCLEVBQUUsSUFBSTtZQUN0QixpQkFBaUIsRUFBRSxHQUFHLEVBQUUscUJBQXFCO1NBQ2hELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxpQkFBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDeEMsbUJBQW1CLEVBQUUsMkJBQWlCLENBQUMsUUFBUTtZQUMvQyxHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUc7WUFDbkIsV0FBVyxFQUFFLEdBQUcsRUFBRSxVQUFVO1NBQy9CLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLGtDQUFnQixDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUNuRSxHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUc7WUFDbkIsWUFB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QUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRXZHLHNEQUFzRDtRQUN0RCwyRUFBMkU7UUFDM0UsdURBQXVEO1FBQ3ZELElBQUksa0JBQTBHLENBQUM7UUFFL0csSUFBSSxDQUFDO1lBQ0QsTUFBTSxlQUFlLEdBQUcsd0NBQWtCLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUMvRCxrQkFBa0IsR0FBRztnQkFDakIsZ0JBQWdCLEVBQUUsZUFBZSxDQUFDLGdCQUFnQjtnQkFDbEQsV0FBVyxFQUFFLGVBQWUsQ0FBQyxXQUFXO2dCQUN4QyxlQUFlLEVBQUUsZUFBZSxDQUFDLGVBQWU7YUFDbkQsQ0FBQztRQUNOLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IseUVBQXlFO1lBQ3pFLGtCQUFrQixHQUFHLFNBQVMsQ0FBQztRQUNuQyxDQUFDO1FBRUQsT0FBTyxFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQztJQUMxRCxDQUFDO0NBQ0o7QUF6SkQsa0NBeUpDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5cbi8qKlxuICogQW1hem9uIEVDUyBjbHVzdGVyIGNvbnN0cnVjdCBmb3IgdGhlIE9uZSBPYnNlcnZhYmlsaXR5IFdvcmtzaG9wLlxuICpcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGEgQ0RLIGNvbnN0cnVjdCBmb3IgY3JlYXRpbmcgYW5kIG1hbmFnaW5nIGFuIEFtYXpvbiBFQ1MgY2x1c3RlclxuICogd2l0aCBFQzIgY2FwYWNpdHkgcHJvdmlkZXJzLCBhdXRvIHNjYWxpbmcgZ3JvdXBzLCBhbmQgZW5oYW5jZWQgY29udGFpbmVyIGluc2lnaHRzLlxuICogVGhlIGNsdXN0ZXIgaXMgY29uZmlndXJlZCBmb3Igb3B0aW1hbCBvYnNlcnZhYmlsaXR5IGFuZCBtb25pdG9yaW5nIGNhcGFiaWxpdGllcy5cbiAqXG4gKiBAcGFja2FnZURvY3VtZW50YXRpb25cbiAqL1xuXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IENmbk91dHB1dCwgRm4gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBBc2dDYXBhY2l0eVByb3ZpZGVyLCBDbHVzdGVyLCBDb250YWluZXJJbnNpZ2h0cywgRWNzT3B0aW1pemVkSW1hZ2UsIElDbHVzdGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgeyBJbnN0YW5jZUNsYXNzLCBJbnN0YW5jZVNpemUsIEluc3RhbmNlVHlwZSwgSVNlY3VyaXR5R3JvdXAsIFNlY3VyaXR5R3JvdXAsIElWcGMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IEF1dG9TY2FsaW5nR3JvdXAsIEJsb2NrRGV2aWNlVm9sdW1lLCBTY2FsaW5nRXZlbnRzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWF1dG9zY2FsaW5nJztcbmltcG9ydCB7IElUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQge1xuICAgIEVDU19DTFVTVEVSX0FSTl9FWFBPUlRfTkFNRSxcbiAgICBFQ1NfQ0xVU1RFUl9OQU1FX0VYUE9SVF9OQU1FLFxuICAgIEVDU19TRUNVUklUWV9HUk9VUF9JRF9FWFBPUlRfTkFNRSxcbn0gZnJvbSAnLi4vLi4vYmluL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBPcGVuU2VhcmNoUGlwZWxpbmUgfSBmcm9tICcuL29wZW5zZWFyY2gtcGlwZWxpbmUnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIGNvbmZpZ3VyaW5nIHRoZSBFQ1MgY2x1c3RlciBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRWNzUHJvcGVydGllcyB7XG4gICAgLyoqIFZQQyB3aGVyZSB0aGUgRUNTIGNsdXN0ZXIgd2lsbCBiZSBkZXBsb3llZCAqL1xuICAgIHZwYzogSVZwYztcbiAgICAvKiogU05TIHRvcGljIGZvciBhdXRvIHNjYWxpbmcgbm90aWZpY2F0aW9ucyAqL1xuICAgIHRvcGljOiBJVG9waWM7XG4gICAgLyoqIE51bWJlciBvZiBFQzIgaW5zdGFuY2VzIGZvciB0aGUgRUNTIGNsdXN0ZXIgY2FwYWNpdHkgKi9cbiAgICBlY3NFYzJDYXBhY2l0eT86IG51bWJlcjtcbiAgICAvKiogRUMyIGluc3RhbmNlIHR5cGUgZm9yIHRoZSBFQ1MgY2x1c3RlciBub2RlcyAqL1xuICAgIGVjc0VjMkluc3RhbmNlVHlwZT86IHN0cmluZztcbiAgICAvKiogT3BlblNlYXJjaCBpbmdlc3Rpb24gcGlwZWxpbmUgZm9yIGxvZyByb3V0aW5nICovXG4gICAgb3BlblNlYXJjaFBpcGVsaW5lPzogT3BlblNlYXJjaFBpcGVsaW5lO1xufVxuXG4vKipcbiAqIEEgQ0RLIGNvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgYW4gQW1hem9uIEVDUyBjbHVzdGVyIHdpdGggRUMyIGNhcGFjaXR5LlxuICpcbiAqIFRoaXMgY29uc3RydWN0IHNldHMgdXA6XG4gKiAtIEVDUyBjbHVzdGVyIHdpdGggZW5oYW5jZWQgY29udGFpbmVyIGluc2lnaHRzXG4gKiAtIEF1dG8gU2NhbGluZyBHcm91cCB3aXRoIEVDUy1vcHRpbWl6ZWQgQU1JXG4gKiAtIFNlY3VyaXR5IGdyb3VwIGZvciBjbHVzdGVyIHJlc291cmNlc1xuICogLSBDYXBhY2l0eSBwcm92aWRlciBmb3IgZWZmaWNpZW50IHJlc291cmNlIG1hbmFnZW1lbnRcbiAqIC0gQ2xvdWRGb3JtYXRpb24gZXhwb3J0cyBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlc1xuICpcbiAqIFRoZSBjbHVzdGVyIGlzIGNvbmZpZ3VyZWQgd2l0aCBiZXN0IHByYWN0aWNlcyBmb3Igc2VjdXJpdHksIG1vbml0b3JpbmcsXG4gKiBhbmQgY29zdCBvcHRpbWl6YXRpb24uXG4gKi9cbmV4cG9ydCBjbGFzcyBXb3Jrc2hvcEVjcyBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgLyoqIFRoZSBFQ1MgY2x1c3RlciBpbnN0YW5jZSAqL1xuICAgIHB1YmxpYyByZWFkb25seSBjbHVzdGVyOiBDbHVzdGVyO1xuICAgIC8qKiBBdXRvIFNjYWxpbmcgR3JvdXAgbWFuYWdpbmcgdGhlIEVDMiBjYXBhY2l0eSAqL1xuICAgIHB1YmxpYyByZWFkb25seSBhdXRvU2NhbGluZ0dyb3VwOiBBdXRvU2NhbGluZ0dyb3VwO1xuICAgIC8qKiBTZWN1cml0eSBncm91cCBmb3IgRUNTIGNsdXN0ZXIgcmVzb3VyY2VzICovXG4gICAgcHVibGljIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA6IFNlY3VyaXR5R3JvdXA7XG4gICAgLyoqIE9wZW5TZWFyY2ggaW5nZXN0aW9uIHBpcGVsaW5lIGZvciBsb2cgcm91dGluZyAob3B0aW9uYWwpICovXG4gICAgcHVibGljIHJlYWRvbmx5IG9wZW5TZWFyY2hQaXBlbGluZT86IE9wZW5TZWFyY2hQaXBlbGluZTtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgV29ya3Nob3BFY3MgY29uc3RydWN0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgY29uc3RydWN0IGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIEVDUyBjbHVzdGVyXG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllczogRWNzUHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgICAgIC8vIFN0b3JlIHRoZSBwaXBlbGluZSByZWZlcmVuY2UgZm9yIHVzZSBieSBFQ1Mgc2VydmljZXNcbiAgICAgICAgdGhpcy5vcGVuU2VhcmNoUGlwZWxpbmUgPSBwcm9wZXJ0aWVzLm9wZW5TZWFyY2hQaXBlbGluZTtcblxuICAgICAgICB0aGlzLnNlY3VyaXR5R3JvdXAgPSBuZXcgU2VjdXJpdHlHcm91cCh0aGlzLCAnU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgICAgICAgIHZwYzogcHJvcGVydGllcy52cGMsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBFQ1MgY2x1c3RlciByZXNvdXJjZXMnLFxuICAgICAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgJHtpZH0tZWNzLXNlY3VyaXR5LWdyb3VwYCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5jbHVzdGVyID0gbmV3IENsdXN0ZXIodGhpcywgJ0NsdXN0ZXInLCB7XG4gICAgICAgICAgICBjb250YWluZXJJbnNpZ2h0c1YyOiBDb250YWluZXJJbnNpZ2h0cy5FTkhBTkNFRCxcbiAgICAgICAgICAgIHZwYzogcHJvcGVydGllcy52cGMsXG4gICAgICAgICAgICBjbHVzdGVyTmFtZTogYCR7aWR9LWNsdXN0ZXJgLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmF1dG9TY2FsaW5nR3JvdXAgPSBuZXcgQXV0b1NjYWxpbmdHcm91cCh0aGlzLCAnQXV0b1NjYWxpbmdHcm91cCcsIHtcbiAgICAgICAgICAgIHZwYzogcHJvcGVydGllcy52cGMsXG4gICAgICAgICAgICBtYWNoaW5lSW1hZ2U6IEVjc09wdGltaXplZEltYWdlLmFtYXpvbkxpbnV4MjAyMygpLFxuICAgICAgICAgICAgbWluQ2FwYWNpdHk6IHByb3BlcnRpZXMuZWNzRWMyQ2FwYWNpdHkgfHwgMCxcbiAgICAgICAgICAgIG1heENhcGFjaXR5OiBwcm9wZXJ0aWVzLmVjc0VjMkNhcGFjaXR5IHx8IDIsXG4gICAgICAgICAgICBkZXNpcmVkQ2FwYWNpdHk6IHByb3BlcnRpZXMuZWNzRWMyQ2FwYWNpdHkgfHwgMixcbiAgICAgICAgICAgIGluc3RhbmNlVHlwZTogcHJvcGVydGllcy5lY3NFYzJJbnN0YW5jZVR5cGVcbiAgICAgICAgICAgICAgICA/IG5ldyBJbnN0YW5jZVR5cGUocHJvcGVydGllcy5lY3NFYzJJbnN0YW5jZVR5cGUpXG4gICAgICAgICAgICAgICAgOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLk1FRElVTSksXG4gICAgICAgICAgICBibG9ja0RldmljZXM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGRldmljZU5hbWU6ICcvZGV2L3h2ZGEnLFxuICAgICAgICAgICAgICAgICAgICB2b2x1bWU6IEJsb2NrRGV2aWNlVm9sdW1lLmVicygzMCwgeyBlbmNyeXB0ZWQ6IHRydWUgfSksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBub3RpZmljYXRpb25zOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB0b3BpYzogcHJvcGVydGllcy50b3BpYyxcbiAgICAgICAgICAgICAgICAgICAgc2NhbGluZ0V2ZW50czogU2NhbGluZ0V2ZW50cy5BTEwsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBhdXRvU2NhbGluZ0dyb3VwTmFtZTogYCR7aWR9LWVjcy1hc2dgLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmNsdXN0ZXIuYWRkQXNnQ2FwYWNpdHlQcm92aWRlcihcbiAgICAgICAgICAgIG5ldyBBc2dDYXBhY2l0eVByb3ZpZGVyKHRoaXMsICdBc2dDYXBhY2l0eVByb3ZpZGVyJywge1xuICAgICAgICAgICAgICAgIGF1dG9TY2FsaW5nR3JvdXA6IHRoaXMuYXV0b1NjYWxpbmdHcm91cCxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRoaXMuYXV0b1NjYWxpbmdHcm91cCxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdBdXRvc2NhbGluZyBncm91cCBuZWVkcyBhY2Nlc3MgdG8gYWxsIEVDUyB0YXNrcycsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLmNsdXN0ZXIsIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1FQ1M0JyxcbiAgICAgICAgICAgICAgICByZWFzb246ICdDb250YWluZXJzIGluc2lnaHRzIHYyIGlzIGVuYWJsZWQsIGZhbHNlIHBvc2l0aXZlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIF0pO1xuXG4gICAgICAgIHRoaXMuY3JlYXRlRXhwb3J0cygpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgQ2xvdWRGb3JtYXRpb24gZXhwb3J0cyBmb3IgdGhlIEVDUyBjbHVzdGVyIHJlc291cmNlcy5cbiAgICAgKiBUaGVzZSBleHBvcnRzIGFsbG93IG90aGVyIHN0YWNrcyB0byByZWZlcmVuY2UgdGhlIGNsdXN0ZXIuXG4gICAgICovXG4gICAgcHJpdmF0ZSBjcmVhdGVFeHBvcnRzKCk6IHZvaWQge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyQXJuJywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyQXJuLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogRUNTX0NMVVNURVJfQVJOX0VYUE9SVF9OQU1FLFxuICAgICAgICB9KTtcblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyTmFtZScsIHtcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBFQ1NfQ0xVU1RFUl9OQU1FX0VYUE9SVF9OQU1FLFxuICAgICAgICB9KTtcblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5zZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IEVDU19TRUNVUklUWV9HUk9VUF9JRF9FWFBPUlRfTkFNRSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW1wb3J0cyBhbiBFQ1MgY2x1c3RlciBmcm9tIENsb3VkRm9ybWF0aW9uIGV4cG9ydHMuXG4gICAgICpcbiAgICAgKiBUaGlzIHN0YXRpYyBtZXRob2QgYWxsb3dzIG90aGVyIHN0YWNrcyB0byByZWZlcmVuY2UgYW4gRUNTIGNsdXN0ZXJcbiAgICAgKiB0aGF0IHdhcyBjcmVhdGVkIGJ5IHRoaXMgY29uc3RydWN0IGFuZCBleHBvcnRlZCB2aWEgQ2xvdWRGb3JtYXRpb24uXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgY29uc3RydWN0IHNjb3BlIHdoZXJlIHRoZSBjbHVzdGVyIHdpbGwgYmUgaW1wb3J0ZWRcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgY29uc3RydWN0IGlkZW50aWZpZXIgZm9yIHRoZSBpbXBvcnRlZCByZXNvdXJjZXNcbiAgICAgKiBAcGFyYW0gdnBjIC0gVGhlIFZQQyB3aGVyZSB0aGUgY2x1c3RlciBpcyBkZXBsb3llZFxuICAgICAqIEByZXR1cm5zIE9iamVjdCBjb250YWluaW5nIHRoZSBpbXBvcnRlZCBjbHVzdGVyLCBzZWN1cml0eSBncm91cCwgYW5kIG9wdGlvbmFsIHBpcGVsaW5lXG4gICAgICovXG4gICAgcHVibGljIHN0YXRpYyBpbXBvcnRGcm9tRXhwb3J0cyhcbiAgICAgICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICAgICAgaWQ6IHN0cmluZyxcbiAgICAgICAgdnBjOiBJVnBjLFxuICAgICk6IHsgY2x1c3RlcjogSUNsdXN0ZXI7IHNlY3VyaXR5R3JvdXA6IElTZWN1cml0eUdyb3VwOyBvcGVuU2VhcmNoUGlwZWxpbmU/OiB7IHBpcGVsaW5lRW5kcG9pbnQ6IHN0cmluZzsgcGlwZWxpbmVBcm46IHN0cmluZzsgcGlwZWxpbmVSb2xlQXJuOiBzdHJpbmcgfSB9IHtcbiAgICAgICAgY29uc3QgY2x1c3Rlck5hbWUgPSBGbi5pbXBvcnRWYWx1ZShFQ1NfQ0xVU1RFUl9OQU1FX0VYUE9SVF9OQU1FKTtcbiAgICAgICAgY29uc3Qgc2VjdXJpdHlHcm91cElkID0gRm4uaW1wb3J0VmFsdWUoRUNTX1NFQ1VSSVRZX0dST1VQX0lEX0VYUE9SVF9OQU1FKTtcblxuICAgICAgICBjb25zdCBjbHVzdGVyID0gQ2x1c3Rlci5mcm9tQ2x1c3RlckF0dHJpYnV0ZXMoc2NvcGUsIGAke2lkfS1DbHVzdGVyYCwge1xuICAgICAgICAgICAgY2x1c3Rlck5hbWU6IGNsdXN0ZXJOYW1lLFxuICAgICAgICAgICAgdnBjOiB2cGMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSBTZWN1cml0eUdyb3VwLmZyb21TZWN1cml0eUdyb3VwSWQoc2NvcGUsIGAke2lkfS1TZWN1cml0eUdyb3VwYCwgc2VjdXJpdHlHcm91cElkKTtcblxuICAgICAgICAvLyBJbXBvcnQgT3BlblNlYXJjaCBwaXBlbGluZSBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcbiAgICAgICAgLy8gVGhpcyBwcm92aWRlcyBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IC0gaWYgcGlwZWxpbmUgZXhwb3J0cyBkb24ndCBleGlzdCwgXG4gICAgICAgIC8vIHRoZSBpbXBvcnQgd2lsbCBncmFjZWZ1bGx5IGhhbmRsZSB0aGUgbWlzc2luZyB2YWx1ZXNcbiAgICAgICAgbGV0IG9wZW5TZWFyY2hQaXBlbGluZTogeyBwaXBlbGluZUVuZHBvaW50OiBzdHJpbmc7IHBpcGVsaW5lQXJuOiBzdHJpbmc7IHBpcGVsaW5lUm9sZUFybjogc3RyaW5nIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgIFxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcGlwZWxpbmVJbXBvcnRzID0gT3BlblNlYXJjaFBpcGVsaW5lLmltcG9ydEZyb21FeHBvcnRzKCk7XG4gICAgICAgICAgICBvcGVuU2VhcmNoUGlwZWxpbmUgPSB7XG4gICAgICAgICAgICAgICAgcGlwZWxpbmVFbmRwb2ludDogcGlwZWxpbmVJbXBvcnRzLnBpcGVsaW5lRW5kcG9pbnQsXG4gICAgICAgICAgICAgICAgcGlwZWxpbmVBcm46IHBpcGVsaW5lSW1wb3J0cy5waXBlbGluZUFybixcbiAgICAgICAgICAgICAgICBwaXBlbGluZVJvbGVBcm46IHBpcGVsaW5lSW1wb3J0cy5waXBlbGluZVJvbGVBcm4sXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgLy8gUGlwZWxpbmUgZXhwb3J0cyBkb24ndCBleGlzdCAtIHRoaXMgaXMgZmluZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgb3BlblNlYXJjaFBpcGVsaW5lID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgY2x1c3Rlciwgc2VjdXJpdHlHcm91cCwgb3BlblNlYXJjaFBpcGVsaW5lIH07XG4gICAgfVxufVxuIl19