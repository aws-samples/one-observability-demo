/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Duration } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Properties for configuring QueueResources construct
 * @interface QueueResourcesProperties
 */
export interface QueueResourcesProperties {
    /**
     * The visibility timeout for the SQS queue in seconds
     * @default 300
     */
    visibilityTimeout?: number;
    /**
     * Email address for SNS topic subscription
     * @default 'someone@example.com'
     */
    snsTopicEmail?: string;
}

/**
 * AWS CDK Construct that creates SQS queue and SNS topic resources for pet adoption
 * @class QueueResources
 * @extends Construct
 */
export class QueueResources extends Construct {
    /**
     * The SQS queue for pet adoption messages
     * @public
     */
    public queue: Queue;
    /**
     * The SNS topic for pet adoption notifications
     * @public
     */
    public topic: Topic;

    /**
     * Creates a new QueueResources construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: QueueResourcesProperties) {
        super(scope, id);
        this.queue = new Queue(this, 'sqs_petadoption', {
            visibilityTimeout: Duration.seconds(properties?.visibilityTimeout || 300),
            enforceSSL: true,
        });

        NagSuppressions.addResourceSuppressions(
            this.queue,
            [
                {
                    id: 'AwsSolutions-SQS3',
                    reason: 'DLQ is not enabled for this workshop',
                },
            ],
            true,
        );

        this.topic = new Topic(this, 'topic_petadoption', {
            enforceSSL: true,
            displayName: 'Pet Adoption Notifications',
        });
        this.topic.addSubscription(new EmailSubscription(properties?.snsTopicEmail || 'someone@example.com'));
    }
}
