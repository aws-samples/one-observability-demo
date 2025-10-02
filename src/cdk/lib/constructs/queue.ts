/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Duration, Fn } from 'aws-cdk-lib';
import { ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import {
    SNS_TOPIC_ARN_EXPORT_NAME,
    SQS_QUEUE_ARN_EXPORT_NAME,
    SQS_QUEUE_URL_EXPORT_NAME,
    SSM_PARAMETER_NAMES,
} from '../../bin/constants';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

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

        // Create CloudFormation outputs for queue resources
        this.createQueueOutputs();

        // Create SSM parameters for queue resources
        this.createSsmParameters();
    }

    /**
     * Imports queue resources from CloudFormation exports created by QueueResources
     *
     * @param scope - The construct scope where the resources will be imported
     * @param id - The construct identifier for the imported resources
     * @returns Object containing the imported SNS topic and SQS queue
     */
    public static importFromExports(scope: Construct, id: string): { topic: ITopic; queue: IQueue } {
        const topicArn = Fn.importValue(SNS_TOPIC_ARN_EXPORT_NAME);
        const queueArn = Fn.importValue(SQS_QUEUE_ARN_EXPORT_NAME);
        const queueUrl = Fn.importValue(SQS_QUEUE_URL_EXPORT_NAME);

        const topic = Topic.fromTopicArn(scope, `${id}-Topic`, topicArn);
        const queue = Queue.fromQueueAttributes(scope, `${id}-Queue`, {
            queueArn: queueArn,
            queueUrl: queueUrl,
        });

        return { topic, queue };
    }

    /**
     * Creates CloudFormation outputs for queue resources
     */
    private createQueueOutputs() {
        new CfnOutput(this, 'SNSTopicArn', {
            value: this.topic.topicArn,
            exportName: SNS_TOPIC_ARN_EXPORT_NAME,
        });
        new CfnOutput(this, 'SQSQueueArn', {
            value: this.queue.queueArn,
            exportName: SQS_QUEUE_ARN_EXPORT_NAME,
        });
        new CfnOutput(this, 'SQSQueueUrl', {
            value: this.queue.queueUrl,
            exportName: SQS_QUEUE_URL_EXPORT_NAME,
        });
    }

    /**
     * Creates SSM parameters for queue resources
     */
    private createSsmParameters(): void {
        if (this.queue) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.SQS_QUEUE_URL]: this.queue.queueUrl,
                    }),
                ),
            );
        } else {
            throw new Error('Queue is not available');
        }
    }
}
