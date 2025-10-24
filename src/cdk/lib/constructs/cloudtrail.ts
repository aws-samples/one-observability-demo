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
import { Trail, InsightType, CfnEventDataStore, CfnTrail } from 'aws-cdk-lib/aws-cloudtrail';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal, PolicyStatement, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';

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
    /** Whether to enable anomaly detection for the trail */
    enableAnomalyDetection?: boolean;
    /** Whether to enable network events for the trail */
    includeNetworkEvents?: boolean;
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
     * @param properties - Configuration properties for the CloudTrail
     */
    constructor(scope: Construct, id: string, properties: WorkshopCloudTrailProperties) {
        super(scope, id);

        // Create CloudWatch log group for CloudTrail
        this.logGroup = new LogGroup(this, 'CloudTrailLogGroup', {
            retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
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

        const trailBucket = new Bucket(this, 'TrailBucket', {
            enforceSSL: true,
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    expiration: Duration.days(7),
                },
            ],
        });

        // Create CloudTrail trail
        this.trail = new Trail(this, 'Trail', {
            trailName: properties.name,
            cloudWatchLogGroup: this.logGroup,
            includeGlobalServiceEvents: true,
            isMultiRegionTrail: false,
            enableFileValidation: true,
            sendToCloudWatchLogs: true,
            insightTypes: properties.enableAnomalyDetection
                ? [InsightType.API_CALL_RATE, InsightType.API_ERROR_RATE]
                : undefined,
            bucket: trailBucket,
        });

        if (properties.includeNetworkEvents) {
            const advancedSelectors: CfnEventDataStore.AdvancedEventSelectorProperty[] = [];
            if (properties.includeS3DataEvents) {
                advancedSelectors.push({
                    fieldSelectors: [
                        {
                            field: 'eventCategory',
                            equalTo: ['Data'],
                        },
                        {
                            field: 'resources.type',
                            equalTo: ['AWS::S3::Object'],
                        },
                    ],
                    name: 'S3 Data Events',
                });
            }
            if (properties.includeLambdaEvents) {
                advancedSelectors.push({
                    fieldSelectors: [
                        {
                            field: 'eventCategory',
                            equalTo: ['Data'],
                        },
                        {
                            field: 'resources.type',
                            equalTo: ['AWS::Lambda::Function'],
                        },
                    ],
                    name: 'Lambda Data Events',
                });
            }
            if (properties.includeNetworkEvents) {
                advancedSelectors.push(
                    {
                        fieldSelectors: [
                            {
                                field: 'eventCategory',
                                equalTo: ['NetworkActivity'],
                            },
                            {
                                field: 'eventSource',
                                equalTo: ['dynamodb.amazonaws.com'],
                            },
                        ],
                        name: 'Network Activity Events (DynamoDB)',
                    },
                    {
                        fieldSelectors: [
                            {
                                field: 'eventCategory',
                                equalTo: ['NetworkActivity'],
                            },
                            {
                                field: 'eventSource',
                                equalTo: ['ecs.amazonaws.com'],
                            },
                        ],
                        name: 'Network Activity Events (ECS)',
                    },
                    {
                        fieldSelectors: [
                            {
                                field: 'eventCategory',
                                equalTo: ['NetworkActivity'],
                            },
                            {
                                field: 'eventSource',
                                equalTo: ['elasticloadbalancing.amazonaws.com'],
                            },
                        ],
                        name: 'Network Activity Events (ELB)',
                    },
                    {
                        fieldSelectors: [
                            {
                                field: 'eventCategory',
                                equalTo: ['NetworkActivity'],
                            },
                            {
                                field: 'eventSource',
                                equalTo: ['secretsmanager.amazonaws.com'],
                            },
                        ],
                        name: 'Network Activity Events (Secrets Manager)',
                    },
                );
            }

            const cfnTrail = this.trail.node.defaultChild as CfnTrail;
            cfnTrail.advancedEventSelectors = advancedSelectors;
        } else {
            // Using advanced selectors disables any Basic Event Selectors
            if (properties.includeS3DataEvents) {
                this.trail.logAllS3DataEvents();
            }

            if (properties.includeLambdaEvents) {
                this.trail.logAllLambdaDataEvents();
            }
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

        NagSuppressions.addResourceSuppressions(
            trailBucket,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Trail Bucket, access logs are not required for the workshop',
                },
            ],
            true,
        );
    }
}
