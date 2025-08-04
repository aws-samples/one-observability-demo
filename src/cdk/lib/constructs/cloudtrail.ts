/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudTrail construct for the One Observability Workshop.
 *
 * This module provides a CloudTrail trail with CloudWatch logs integration
 * and anomaly detection capabilities for monitoring AWS API activity.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Trail, InsightType } from 'aws-cdk-lib/aws-cloudtrail';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal, PolicyStatement, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { Names } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

/**
 * Configuration properties for the WorkshopCloudTrail construct.
 */
export interface WorkshopCloudTrailProperties {
    /** Name identifier for the CloudTrail resources */
    name: string;
    /** Whether to include S3 data events in the trail */
    includeS3DataEvents?: boolean;
    /** Whether to include Lambda events in the trail */
    includeLambdaEvents?: boolean;
    /** CloudWatch log retention period in days */
    logRetentionDays?: RetentionDays;
}

/**
 * A CDK construct that creates a CloudTrail trail with CloudWatch logs
 * integration and anomaly detection for the observability workshop.
 */
export class WorkshopCloudTrail extends Construct {
    /** The CloudTrail trail instance */
    public readonly trail: Trail;
    /** The CloudWatch log group for trail events */
    public readonly logGroup: LogGroup;

    /**
     * Creates a new WorkshopCloudTrail construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param props - Configuration properties for the CloudTrail
     */
    constructor(scope: Construct, id: string, properties: WorkshopCloudTrailProperties) {
        super(scope, id);

        const logName = Names.uniqueResourceName(this, {});
        // Create CloudWatch log group for CloudTrail
        this.logGroup = new LogGroup(this, 'CloudTrailLogGroup', {
            retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
            logGroupName: `/aws/cloudtrail/${logName}`,
        });

        // Create IAM role for CloudTrail to write to CloudWatch Logs
        new Role(this, 'CloudTrailRole', {
            assumedBy: new ServicePrincipal('cloudtrail.amazonaws.com'),
            inlinePolicies: {
                CloudWatchLogsPolicy: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [this.logGroup.logGroupArn],
                        }),
                    ],
                }),
            },
        });

        // Create CloudTrail trail
        this.trail = new Trail(this, 'Trail', {
            trailName: properties.name,
            cloudWatchLogGroup: this.logGroup,
            includeGlobalServiceEvents: true,
            isMultiRegionTrail: false,
            enableFileValidation: true,
            sendToCloudWatchLogs: true,
            insightTypes: [InsightType.API_CALL_RATE, InsightType.API_ERROR_RATE],
        });

        if (properties.includeS3DataEvents) {
            this.trail.logAllS3DataEvents();
        }

        if (properties.includeLambdaEvents) {
            this.trail.logAllLambdaDataEvents();
        }

        NagSuppressions.addResourceSuppressions(
            this.trail,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'CloudTrail Bucket, access logs are not required for the workshop',
                },
            ],
            true,
        );
    }
}
