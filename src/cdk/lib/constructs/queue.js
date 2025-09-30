"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueResources = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sns_subscriptions_1 = require("aws-cdk-lib/aws-sns-subscriptions");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const cdk_nag_1 = require("cdk-nag");
const constructs_1 = require("constructs");
const constants_1 = require("../../bin/constants");
/**
 * AWS CDK Construct that creates SQS queue and SNS topic resources for pet adoption
 * @class QueueResources
 * @extends Construct
 */
class QueueResources extends constructs_1.Construct {
    /**
     * Creates a new QueueResources construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope, id, properties) {
        super(scope, id);
        this.queue = new aws_sqs_1.Queue(this, 'sqs_petadoption', {
            visibilityTimeout: aws_cdk_lib_1.Duration.seconds(properties?.visibilityTimeout || 300),
            enforceSSL: true,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.queue, [
            {
                id: 'AwsSolutions-SQS3',
                reason: 'DLQ is not enabled for this workshop',
            },
        ], true);
        this.topic = new aws_sns_1.Topic(this, 'topic_petadoption', {
            enforceSSL: true,
            displayName: 'Pet Adoption Notifications',
        });
        this.topic.addSubscription(new aws_sns_subscriptions_1.EmailSubscription(properties?.snsTopicEmail || 'someone@example.com'));
        // Create CloudFormation outputs for queue resources
        this.createQueueOutputs();
    }
    /**
     * Imports queue resources from CloudFormation exports created by QueueResources
     *
     * @param scope - The construct scope where the resources will be imported
     * @param id - The construct identifier for the imported resources
     * @returns Object containing the imported SNS topic and SQS queue
     */
    static importFromExports(scope, id) {
        const topicArn = aws_cdk_lib_1.Fn.importValue(constants_1.SNS_TOPIC_ARN_EXPORT_NAME);
        const queueArn = aws_cdk_lib_1.Fn.importValue(constants_1.SQS_QUEUE_ARN_EXPORT_NAME);
        const queueUrl = aws_cdk_lib_1.Fn.importValue(constants_1.SQS_QUEUE_URL_EXPORT_NAME);
        const topic = aws_sns_1.Topic.fromTopicArn(scope, `${id}-Topic`, topicArn);
        const queue = aws_sqs_1.Queue.fromQueueAttributes(scope, `${id}-Queue`, {
            queueArn: queueArn,
            queueUrl: queueUrl,
        });
        return { topic, queue };
    }
    /**
     * Creates CloudFormation outputs for queue resources
     */
    createQueueOutputs() {
        new aws_cdk_lib_1.CfnOutput(this, 'SNSTopicArn', {
            value: this.topic.topicArn,
            exportName: constants_1.SNS_TOPIC_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'SQSQueueArn', {
            value: this.queue.queueArn,
            exportName: constants_1.SQS_QUEUE_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'SQSQueueUrl', {
            value: this.queue.queueUrl,
            exportName: constants_1.SQS_QUEUE_URL_EXPORT_NAME,
        });
    }
}
exports.QueueResources = QueueResources;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJxdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7O0VBR0U7QUFDRiw2Q0FBc0Q7QUFDdEQsaURBQW9EO0FBQ3BELDZFQUFzRTtBQUN0RSxpREFBb0Q7QUFDcEQscUNBQTBDO0FBQzFDLDJDQUF1QztBQUN2QyxtREFBc0g7QUFtQnRIOzs7O0dBSUc7QUFDSCxNQUFhLGNBQWUsU0FBUSxzQkFBUztJQVl6Qzs7Ozs7T0FLRztJQUNILFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsVUFBcUM7UUFDM0UsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksZUFBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUM1QyxpQkFBaUIsRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsaUJBQWlCLElBQUksR0FBRyxDQUFDO1lBQ3pFLFVBQVUsRUFBRSxJQUFJO1NBQ25CLENBQUMsQ0FBQztRQUVILHlCQUFlLENBQUMsdUJBQXVCLENBQ25DLElBQUksQ0FBQyxLQUFLLEVBQ1Y7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0NBQXNDO2FBQ2pEO1NBQ0osRUFDRCxJQUFJLENBQ1AsQ0FBQztRQUVGLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxlQUFLLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzlDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFdBQVcsRUFBRSw0QkFBNEI7U0FDNUMsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSx5Q0FBaUIsQ0FBQyxVQUFVLEVBQUUsYUFBYSxJQUFJLHFCQUFxQixDQUFDLENBQUMsQ0FBQztRQUV0RyxvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7SUFDOUIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNJLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFnQixFQUFFLEVBQVU7UUFDeEQsTUFBTSxRQUFRLEdBQUcsZ0JBQUUsQ0FBQyxXQUFXLENBQUMscUNBQXlCLENBQUMsQ0FBQztRQUMzRCxNQUFNLFFBQVEsR0FBRyxnQkFBRSxDQUFDLFdBQVcsQ0FBQyxxQ0FBeUIsQ0FBQyxDQUFDO1FBQzNELE1BQU0sUUFBUSxHQUFHLGdCQUFFLENBQUMsV0FBVyxDQUFDLHFDQUF5QixDQUFDLENBQUM7UUFFM0QsTUFBTSxLQUFLLEdBQUcsZUFBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUNqRSxNQUFNLEtBQUssR0FBRyxlQUFLLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUU7WUFDMUQsUUFBUSxFQUFFLFFBQVE7WUFDbEIsUUFBUSxFQUFFLFFBQVE7U0FDckIsQ0FBQyxDQUFDO1FBRUgsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQztJQUM1QixDQUFDO0lBRUQ7O09BRUc7SUFDSyxrQkFBa0I7UUFDdEIsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDL0IsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUMxQixVQUFVLEVBQUUscUNBQXlCO1NBQ3hDLENBQUMsQ0FBQztRQUNILElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQy9CLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVE7WUFDMUIsVUFBVSxFQUFFLHFDQUF5QjtTQUN4QyxDQUFDLENBQUM7UUFDSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUMvQixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRO1lBQzFCLFVBQVUsRUFBRSxxQ0FBeUI7U0FDeEMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBcEZELHdDQW9GQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgRm4gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBJVG9waWMsIFRvcGljIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgeyBFbWFpbFN1YnNjcmlwdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgeyBJUXVldWUsIFF1ZXVlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgU05TX1RPUElDX0FSTl9FWFBPUlRfTkFNRSwgU1FTX1FVRVVFX0FSTl9FWFBPUlRfTkFNRSwgU1FTX1FVRVVFX1VSTF9FWFBPUlRfTkFNRSB9IGZyb20gJy4uLy4uL2Jpbi9jb25zdGFudHMnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIGNvbmZpZ3VyaW5nIFF1ZXVlUmVzb3VyY2VzIGNvbnN0cnVjdFxuICogQGludGVyZmFjZSBRdWV1ZVJlc291cmNlc1Byb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBRdWV1ZVJlc291cmNlc1Byb3BlcnRpZXMge1xuICAgIC8qKlxuICAgICAqIFRoZSB2aXNpYmlsaXR5IHRpbWVvdXQgZm9yIHRoZSBTUVMgcXVldWUgaW4gc2Vjb25kc1xuICAgICAqIEBkZWZhdWx0IDMwMFxuICAgICAqL1xuICAgIHZpc2liaWxpdHlUaW1lb3V0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEVtYWlsIGFkZHJlc3MgZm9yIFNOUyB0b3BpYyBzdWJzY3JpcHRpb25cbiAgICAgKiBAZGVmYXVsdCAnc29tZW9uZUBleGFtcGxlLmNvbSdcbiAgICAgKi9cbiAgICBzbnNUb3BpY0VtYWlsPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEFXUyBDREsgQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBTUVMgcXVldWUgYW5kIFNOUyB0b3BpYyByZXNvdXJjZXMgZm9yIHBldCBhZG9wdGlvblxuICogQGNsYXNzIFF1ZXVlUmVzb3VyY2VzXG4gKiBAZXh0ZW5kcyBDb25zdHJ1Y3RcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXVlUmVzb3VyY2VzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgICAvKipcbiAgICAgKiBUaGUgU1FTIHF1ZXVlIGZvciBwZXQgYWRvcHRpb24gbWVzc2FnZXNcbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgcHVibGljIHF1ZXVlOiBRdWV1ZTtcbiAgICAvKipcbiAgICAgKiBUaGUgU05TIHRvcGljIGZvciBwZXQgYWRvcHRpb24gbm90aWZpY2F0aW9uc1xuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwdWJsaWMgdG9waWM6IFRvcGljO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBRdWV1ZVJlc291cmNlcyBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgcGFyZW50IGNvbnN0cnVjdFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBjb25zdHJ1Y3QgSURcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIGNvbnN0cnVjdFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM/OiBRdWV1ZVJlc291cmNlc1Byb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICAgICAgdGhpcy5xdWV1ZSA9IG5ldyBRdWV1ZSh0aGlzLCAnc3FzX3BldGFkb3B0aW9uJywge1xuICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMocHJvcGVydGllcz8udmlzaWJpbGl0eVRpbWVvdXQgfHwgMzAwKSxcbiAgICAgICAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRoaXMucXVldWUsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TUVMzJyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnRExRIGlzIG5vdCBlbmFibGVkIGZvciB0aGlzIHdvcmtzaG9wJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy50b3BpYyA9IG5ldyBUb3BpYyh0aGlzLCAndG9waWNfcGV0YWRvcHRpb24nLCB7XG4gICAgICAgICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgICAgICAgZGlzcGxheU5hbWU6ICdQZXQgQWRvcHRpb24gTm90aWZpY2F0aW9ucycsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnRvcGljLmFkZFN1YnNjcmlwdGlvbihuZXcgRW1haWxTdWJzY3JpcHRpb24ocHJvcGVydGllcz8uc25zVG9waWNFbWFpbCB8fCAnc29tZW9uZUBleGFtcGxlLmNvbScpKTtcblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRGb3JtYXRpb24gb3V0cHV0cyBmb3IgcXVldWUgcmVzb3VyY2VzXG4gICAgICAgIHRoaXMuY3JlYXRlUXVldWVPdXRwdXRzKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW1wb3J0cyBxdWV1ZSByZXNvdXJjZXMgZnJvbSBDbG91ZEZvcm1hdGlvbiBleHBvcnRzIGNyZWF0ZWQgYnkgUXVldWVSZXNvdXJjZXNcbiAgICAgKlxuICAgICAqIEBwYXJhbSBzY29wZSAtIFRoZSBjb25zdHJ1Y3Qgc2NvcGUgd2hlcmUgdGhlIHJlc291cmNlcyB3aWxsIGJlIGltcG9ydGVkXG4gICAgICogQHBhcmFtIGlkIC0gVGhlIGNvbnN0cnVjdCBpZGVudGlmaWVyIGZvciB0aGUgaW1wb3J0ZWQgcmVzb3VyY2VzXG4gICAgICogQHJldHVybnMgT2JqZWN0IGNvbnRhaW5pbmcgdGhlIGltcG9ydGVkIFNOUyB0b3BpYyBhbmQgU1FTIHF1ZXVlXG4gICAgICovXG4gICAgcHVibGljIHN0YXRpYyBpbXBvcnRGcm9tRXhwb3J0cyhzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nKTogeyB0b3BpYzogSVRvcGljOyBxdWV1ZTogSVF1ZXVlIH0ge1xuICAgICAgICBjb25zdCB0b3BpY0FybiA9IEZuLmltcG9ydFZhbHVlKFNOU19UT1BJQ19BUk5fRVhQT1JUX05BTUUpO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IEZuLmltcG9ydFZhbHVlKFNRU19RVUVVRV9BUk5fRVhQT1JUX05BTUUpO1xuICAgICAgICBjb25zdCBxdWV1ZVVybCA9IEZuLmltcG9ydFZhbHVlKFNRU19RVUVVRV9VUkxfRVhQT1JUX05BTUUpO1xuXG4gICAgICAgIGNvbnN0IHRvcGljID0gVG9waWMuZnJvbVRvcGljQXJuKHNjb3BlLCBgJHtpZH0tVG9waWNgLCB0b3BpY0Fybik7XG4gICAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWUuZnJvbVF1ZXVlQXR0cmlidXRlcyhzY29wZSwgYCR7aWR9LVF1ZXVlYCwge1xuICAgICAgICAgICAgcXVldWVBcm46IHF1ZXVlQXJuLFxuICAgICAgICAgICAgcXVldWVVcmw6IHF1ZXVlVXJsLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4geyB0b3BpYywgcXVldWUgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIENsb3VkRm9ybWF0aW9uIG91dHB1dHMgZm9yIHF1ZXVlIHJlc291cmNlc1xuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlUXVldWVPdXRwdXRzKCkge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdTTlNUb3BpY0FybicsIHtcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLnRvcGljLnRvcGljQXJuLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogU05TX1RPUElDX0FSTl9FWFBPUlRfTkFNRSxcbiAgICAgICAgfSk7XG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ1NRU1F1ZXVlQXJuJywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMucXVldWUucXVldWVBcm4sXG4gICAgICAgICAgICBleHBvcnROYW1lOiBTUVNfUVVFVUVfQVJOX0VYUE9SVF9OQU1FLFxuICAgICAgICB9KTtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnU1FTUXVldWVVcmwnLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5xdWV1ZS5xdWV1ZVVybCxcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IFNRU19RVUVVRV9VUkxfRVhQT1JUX05BTUUsXG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==