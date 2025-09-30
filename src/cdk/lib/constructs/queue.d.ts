import { ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
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
export declare class QueueResources extends Construct {
    /**
     * The SQS queue for pet adoption messages
     * @public
     */
    queue: Queue;
    /**
     * The SNS topic for pet adoption notifications
     * @public
     */
    topic: Topic;
    /**
     * Creates a new QueueResources construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: QueueResourcesProperties);
    /**
     * Imports queue resources from CloudFormation exports created by QueueResources
     *
     * @param scope - The construct scope where the resources will be imported
     * @param id - The construct identifier for the imported resources
     * @returns Object containing the imported SNS topic and SQS queue
     */
    static importFromExports(scope: Construct, id: string): {
        topic: ITopic;
        queue: IQueue;
    };
    /**
     * Creates CloudFormation outputs for queue resources
     */
    private createQueueOutputs;
}
