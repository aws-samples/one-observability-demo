/**
 * CloudTrail construct for the One Observability Workshop.
 *
 * This module provides a CloudTrail trail with CloudWatch logs integration
 * and anomaly detection capabilities for monitoring AWS API activity.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import { Trail } from 'aws-cdk-lib/aws-cloudtrail';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
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
export declare class WorkshopCloudTrail extends Construct {
    /** The CloudTrail trail instance */
    readonly trail: Trail;
    /** The CloudWatch log group for trail events */
    readonly logGroup: LogGroup;
    /**
     * Creates a new WorkshopCloudTrail construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the CloudTrail
     */
    constructor(scope: Construct, id: string, properties: WorkshopCloudTrailProperties);
}
