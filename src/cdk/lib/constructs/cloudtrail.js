"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopCloudTrail = void 0;
/**
 * CloudTrail construct for the One Observability Workshop.
 *
 * This module provides a CloudTrail trail with CloudWatch logs integration
 * and anomaly detection capabilities for monitoring AWS API activity.
 *
 * @packageDocumentation
 */
const constructs_1 = require("constructs");
const aws_cloudtrail_1 = require("aws-cdk-lib/aws-cloudtrail");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
/**
 * A CDK construct that creates a CloudTrail trail with CloudWatch logs
 * integration and anomaly detection for the observability workshop.
 */
class WorkshopCloudTrail extends constructs_1.Construct {
    /**
     * Creates a new WorkshopCloudTrail construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the CloudTrail
     */
    constructor(scope, id, properties) {
        super(scope, id);
        const logName = aws_cdk_lib_1.Names.uniqueResourceName(this, {});
        // Create CloudWatch log group for CloudTrail
        this.logGroup = new aws_logs_1.LogGroup(this, 'CloudTrailLogGroup', {
            retention: properties.logRetentionDays || aws_logs_1.RetentionDays.ONE_WEEK,
            logGroupName: `/aws/cloudtrail/${logName}`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // Create IAM role for CloudTrail to write to CloudWatch Logs
        new aws_iam_1.Role(this, 'CloudTrailRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('cloudtrail.amazonaws.com'),
            inlinePolicies: {
                CloudWatchLogsPolicy: new aws_iam_1.PolicyDocument({
                    statements: [
                        new aws_iam_1.PolicyStatement({
                            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [this.logGroup.logGroupArn],
                        }),
                    ],
                }),
            },
        });
        const trailBucket = new aws_s3_1.Bucket(this, 'TrailBucket', {
            enforceSSL: true,
            autoDeleteObjects: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    expiration: aws_cdk_lib_1.Duration.days(7),
                },
            ],
        });
        // Create CloudTrail trail
        this.trail = new aws_cloudtrail_1.Trail(this, 'Trail', {
            trailName: properties.name,
            cloudWatchLogGroup: this.logGroup,
            includeGlobalServiceEvents: true,
            isMultiRegionTrail: false,
            enableFileValidation: true,
            sendToCloudWatchLogs: true,
            insightTypes: [aws_cloudtrail_1.InsightType.API_CALL_RATE, aws_cloudtrail_1.InsightType.API_ERROR_RATE],
            bucket: trailBucket,
        });
        if (properties.includeS3DataEvents) {
            this.trail.logAllS3DataEvents();
        }
        if (properties.includeLambdaEvents) {
            this.trail.logAllLambdaDataEvents();
        }
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.trail, [
            {
                id: 'AwsSolutions-S1',
                reason: 'CloudTrail Bucket, access logs are not required for the workshop',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(trailBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Trail Bucket, access logs are not required for the workshop',
            },
        ], true);
    }
}
exports.WorkshopCloudTrail = WorkshopCloudTrail;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR0cmFpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3VkdHJhaWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7RUFHRTs7O0FBRUY7Ozs7Ozs7R0FPRztBQUVILDJDQUF1QztBQUN2QywrREFBZ0U7QUFDaEUsbURBQStEO0FBQy9ELGlEQUE4RjtBQUM5Riw2Q0FBNkQ7QUFDN0QscUNBQTBDO0FBQzFDLCtDQUErRDtBQWdCL0Q7OztHQUdHO0FBQ0gsTUFBYSxrQkFBbUIsU0FBUSxzQkFBUztJQU03Qzs7Ozs7O09BTUc7SUFDSCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQXdDO1FBQzlFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxPQUFPLEdBQUcsbUJBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDbkQsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxtQkFBUSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUNyRCxTQUFTLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixJQUFJLHdCQUFhLENBQUMsUUFBUTtZQUNoRSxZQUFZLEVBQUUsbUJBQW1CLE9BQU8sRUFBRTtZQUMxQyxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1NBQ3ZDLENBQUMsQ0FBQztRQUVILDZEQUE2RDtRQUM3RCxJQUFJLGNBQUksQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDN0IsU0FBUyxFQUFFLElBQUksMEJBQWdCLENBQUMsMEJBQTBCLENBQUM7WUFDM0QsY0FBYyxFQUFFO2dCQUNaLG9CQUFvQixFQUFFLElBQUksd0JBQWMsQ0FBQztvQkFDckMsVUFBVSxFQUFFO3dCQUNSLElBQUkseUJBQWUsQ0FBQzs0QkFDaEIsT0FBTyxFQUFFLENBQUMsc0JBQXNCLEVBQUUsbUJBQW1CLENBQUM7NEJBQ3RELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO3lCQUN6QyxDQUFDO3FCQUNMO2lCQUNKLENBQUM7YUFDTDtTQUNKLENBQUMsQ0FBQztRQUVILE1BQU0sV0FBVyxHQUFHLElBQUksZUFBTSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDaEQsVUFBVSxFQUFFLElBQUk7WUFDaEIsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1lBQ3BDLGlCQUFpQixFQUFFLDBCQUFpQixDQUFDLFNBQVM7WUFDOUMsY0FBYyxFQUFFO2dCQUNaO29CQUNJLFVBQVUsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7aUJBQy9CO2FBQ0o7U0FDSixDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHNCQUFLLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRTtZQUNsQyxTQUFTLEVBQUUsVUFBVSxDQUFDLElBQUk7WUFDMUIsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDakMsMEJBQTBCLEVBQUUsSUFBSTtZQUNoQyxrQkFBa0IsRUFBRSxLQUFLO1lBQ3pCLG9CQUFvQixFQUFFLElBQUk7WUFDMUIsb0JBQW9CLEVBQUUsSUFBSTtZQUMxQixZQUFZLEVBQUUsQ0FBQyw0QkFBVyxDQUFDLGFBQWEsRUFBRSw0QkFBVyxDQUFDLGNBQWMsQ0FBQztZQUNyRSxNQUFNLEVBQUUsV0FBVztTQUN0QixDQUFDLENBQUM7UUFFSCxJQUFJLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUNwQyxDQUFDO1FBRUQsSUFBSSxVQUFVLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFDeEMsQ0FBQztRQUVELHlCQUFlLENBQUMsdUJBQXVCLENBQ25DLElBQUksQ0FBQyxLQUFLLEVBQ1Y7WUFDSTtnQkFDSSxFQUFFLEVBQUUsaUJBQWlCO2dCQUNyQixNQUFNLEVBQUUsa0VBQWtFO2FBQzdFO1NBQ0osRUFDRCxJQUFJLENBQ1AsQ0FBQztRQUVGLHlCQUFlLENBQUMsdUJBQXVCLENBQ25DLFdBQVcsRUFDWDtZQUNJO2dCQUNJLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw2REFBNkQ7YUFDeEU7U0FDSixFQUNELElBQUksQ0FDUCxDQUFDO0lBQ04sQ0FBQztDQUNKO0FBN0ZELGdEQTZGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuXG4vKipcbiAqIENsb3VkVHJhaWwgY29uc3RydWN0IGZvciB0aGUgT25lIE9ic2VydmFiaWxpdHkgV29ya3Nob3AuXG4gKlxuICogVGhpcyBtb2R1bGUgcHJvdmlkZXMgYSBDbG91ZFRyYWlsIHRyYWlsIHdpdGggQ2xvdWRXYXRjaCBsb2dzIGludGVncmF0aW9uXG4gKiBhbmQgYW5vbWFseSBkZXRlY3Rpb24gY2FwYWJpbGl0aWVzIGZvciBtb25pdG9yaW5nIEFXUyBBUEkgYWN0aXZpdHkuXG4gKlxuICogQHBhY2thZ2VEb2N1bWVudGF0aW9uXG4gKi9cblxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBUcmFpbCwgSW5zaWdodFR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR0cmFpbCc7XG5pbXBvcnQgeyBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IFJvbGUsIFNlcnZpY2VQcmluY2lwYWwsIFBvbGljeVN0YXRlbWVudCwgUG9saWN5RG9jdW1lbnQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IE5hbWVzLCBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgQmxvY2tQdWJsaWNBY2Nlc3MsIEJ1Y2tldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgV29ya3Nob3BDbG91ZFRyYWlsIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3Jrc2hvcENsb3VkVHJhaWxQcm9wZXJ0aWVzIHtcbiAgICAvKiogTmFtZSBpZGVudGlmaWVyIGZvciB0aGUgQ2xvdWRUcmFpbCByZXNvdXJjZXMgKi9cbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgLyoqIFdoZXRoZXIgdG8gaW5jbHVkZSBTMyBkYXRhIGV2ZW50cyBpbiB0aGUgdHJhaWwgKi9cbiAgICBpbmNsdWRlUzNEYXRhRXZlbnRzPzogYm9vbGVhbjtcbiAgICAvKiogV2hldGhlciB0byBpbmNsdWRlIExhbWJkYSBldmVudHMgaW4gdGhlIHRyYWlsICovXG4gICAgaW5jbHVkZUxhbWJkYUV2ZW50cz86IGJvb2xlYW47XG4gICAgLyoqIENsb3VkV2F0Y2ggbG9nIHJldGVudGlvbiBwZXJpb2QgaW4gZGF5cyAqL1xuICAgIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xufVxuXG4vKipcbiAqIEEgQ0RLIGNvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgYSBDbG91ZFRyYWlsIHRyYWlsIHdpdGggQ2xvdWRXYXRjaCBsb2dzXG4gKiBpbnRlZ3JhdGlvbiBhbmQgYW5vbWFseSBkZXRlY3Rpb24gZm9yIHRoZSBvYnNlcnZhYmlsaXR5IHdvcmtzaG9wLlxuICovXG5leHBvcnQgY2xhc3MgV29ya3Nob3BDbG91ZFRyYWlsIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgICAvKiogVGhlIENsb3VkVHJhaWwgdHJhaWwgaW5zdGFuY2UgKi9cbiAgICBwdWJsaWMgcmVhZG9ubHkgdHJhaWw6IFRyYWlsO1xuICAgIC8qKiBUaGUgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIHRyYWlsIGV2ZW50cyAqL1xuICAgIHB1YmxpYyByZWFkb25seSBsb2dHcm91cDogTG9nR3JvdXA7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IFdvcmtzaG9wQ2xvdWRUcmFpbCBjb25zdHJ1Y3QuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgcGFyZW50IGNvbnN0cnVjdFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBjb25zdHJ1Y3QgaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgQ2xvdWRUcmFpbFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM6IFdvcmtzaG9wQ2xvdWRUcmFpbFByb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgICAgICBjb25zdCBsb2dOYW1lID0gTmFtZXMudW5pcXVlUmVzb3VyY2VOYW1lKHRoaXMsIHt9KTtcbiAgICAgICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggbG9nIGdyb3VwIGZvciBDbG91ZFRyYWlsXG4gICAgICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgJ0Nsb3VkVHJhaWxMb2dHcm91cCcsIHtcbiAgICAgICAgICAgIHJldGVudGlvbjogcHJvcGVydGllcy5sb2dSZXRlbnRpb25EYXlzIHx8IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2Nsb3VkdHJhaWwvJHtsb2dOYW1lfWAsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgQ2xvdWRUcmFpbCB0byB3cml0ZSB0byBDbG91ZFdhdGNoIExvZ3NcbiAgICAgICAgbmV3IFJvbGUodGhpcywgJ0Nsb3VkVHJhaWxSb2xlJywge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbCgnY2xvdWR0cmFpbC5hbWF6b25hd3MuY29tJyksXG4gICAgICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgICAgICAgIENsb3VkV2F0Y2hMb2dzUG9saWN5OiBuZXcgUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgJ2xvZ3M6UHV0TG9nRXZlbnRzJ10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sb2dHcm91cC5sb2dHcm91cEFybl0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHRyYWlsQnVja2V0ID0gbmV3IEJ1Y2tldCh0aGlzLCAnVHJhaWxCdWNrZXQnLCB7XG4gICAgICAgICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICBibG9ja1B1YmxpY0FjY2VzczogQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGV4cGlyYXRpb246IER1cmF0aW9uLmRheXMoNyksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFRyYWlsIHRyYWlsXG4gICAgICAgIHRoaXMudHJhaWwgPSBuZXcgVHJhaWwodGhpcywgJ1RyYWlsJywge1xuICAgICAgICAgICAgdHJhaWxOYW1lOiBwcm9wZXJ0aWVzLm5hbWUsXG4gICAgICAgICAgICBjbG91ZFdhdGNoTG9nR3JvdXA6IHRoaXMubG9nR3JvdXAsXG4gICAgICAgICAgICBpbmNsdWRlR2xvYmFsU2VydmljZUV2ZW50czogdHJ1ZSxcbiAgICAgICAgICAgIGlzTXVsdGlSZWdpb25UcmFpbDogZmFsc2UsXG4gICAgICAgICAgICBlbmFibGVGaWxlVmFsaWRhdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIHNlbmRUb0Nsb3VkV2F0Y2hMb2dzOiB0cnVlLFxuICAgICAgICAgICAgaW5zaWdodFR5cGVzOiBbSW5zaWdodFR5cGUuQVBJX0NBTExfUkFURSwgSW5zaWdodFR5cGUuQVBJX0VSUk9SX1JBVEVdLFxuICAgICAgICAgICAgYnVja2V0OiB0cmFpbEJ1Y2tldCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHByb3BlcnRpZXMuaW5jbHVkZVMzRGF0YUV2ZW50cykge1xuICAgICAgICAgICAgdGhpcy50cmFpbC5sb2dBbGxTM0RhdGFFdmVudHMoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwcm9wZXJ0aWVzLmluY2x1ZGVMYW1iZGFFdmVudHMpIHtcbiAgICAgICAgICAgIHRoaXMudHJhaWwubG9nQWxsTGFtYmRhRGF0YUV2ZW50cygpO1xuICAgICAgICB9XG5cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgdGhpcy50cmFpbCxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxJyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnQ2xvdWRUcmFpbCBCdWNrZXQsIGFjY2VzcyBsb2dzIGFyZSBub3QgcmVxdWlyZWQgZm9yIHRoZSB3b3Jrc2hvcCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRyYWlsQnVja2V0LFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdUcmFpbCBCdWNrZXQsIGFjY2VzcyBsb2dzIGFyZSBub3QgcmVxdWlyZWQgZm9yIHRoZSB3b3Jrc2hvcCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuICAgIH1cbn1cbiJdfQ==