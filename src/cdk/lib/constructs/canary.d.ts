import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Canary, Runtime } from 'aws-cdk-lib/aws-synthetics';
import { Construct } from 'constructs';
export interface WorkshopCanaryProperties {
    artifactsBucket?: IBucket;
    runtime: Runtime;
    scheduleExpression?: string;
    handler: string;
    path: string;
    logRetentionDays?: RetentionDays;
    name: string;
}
export declare const CanaryNames: {
    /** Pet status updater function name */
    readonly Petsite: string;
    readonly HouseKeeping: string;
};
export declare abstract class WorkshopCanary extends Construct {
    canary: Canary;
    constructor(scope: Construct, id: string, properties: WorkshopCanaryProperties);
    static getDefaultSSMPolicy(scope: Construct, prefix?: string): PolicyStatement;
    /**
     * Creates CloudFormation outputs for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     */
    abstract createOutputs(properties: WorkshopCanaryProperties): void;
    /**
     * Returns environment variables for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     * @returns Map of environment variable names to values
     */
    abstract getEnvironmentVariables(properties: WorkshopCanaryProperties): {
        [key: string]: string;
    } | undefined;
}
