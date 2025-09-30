/**
 * Lambda function constructs for the One Observability Workshop.
 *
 * This module provides abstract base classes and interfaces for creating
 * Lambda functions with consistent configuration and best practices for
 * observability, security, and performance.
 *
 * @packageDocumentation
 */
import { Runtime, Function, ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { IVpc, ISecurityGroup, SubnetSelection } from 'aws-cdk-lib/aws-ec2';
import { Duration } from 'aws-cdk-lib';
/**
 * Gets the OpenTelemetry Python layer ARN for the specified region.
 * @param region - AWS region
 * @returns Complete ARN for the OpenTelemetry Python layer
 */
export declare function getOpenTelemetryPythonLayerArn(region: string): string;
/**
 * Gets the Lambda Insights layer ARN for the specified region.
 * @param region - AWS region
 * @returns Complete ARN for the Lambda Insights layer
 */
export declare function getLambdaInsightsLayerArn(region: string): string;
/**
 * Properties for configuring a workshop Lambda function.
 */
export interface WorkshopLambdaFunctionProperties {
    /** Unique name for the Lambda function */
    name: string;
    /** Runtime environment for the function */
    runtime: Runtime;
    /** Path to the dependencies lock file (for Node.js functions) */
    depsLockFilePath?: string;
    /** Entry point file for the function code */
    entry: string;
    /** Memory allocation for the function in MB */
    memorySize: number;
    /** Handler method name within the entry file */
    handler?: string;
    /** The path (relative to entry) to the index file containing the exported handler. */
    index?: string;
    /** Log retention period for CloudWatch logs */
    logRetentionDays?: RetentionDays;
    /** Description of the function's purpose */
    description?: string;
    /**
     * The schedule expression for traffic generation
     * @default 'rate(5 minute)'
     */
    scheduleExpression?: string;
    /**
     * Whether to enable the EventBridge schedule
     * @default false
     */
    enableSchedule?: boolean;
    /**
     * Lambda Timeout
     */
    timeout?: Duration;
    /**
     * VPC for the Lambda function
     */
    vpc?: IVpc;
    /**
     * VPC subnets for the Lambda function
     */
    vpcSubnets?: SubnetSelection;
    /**
     * Security groups for the Lambda function
     */
    securityGroups?: ISecurityGroup[];
}
/**
 * Predefined Lambda function names used throughout the workshop.
 */
export declare const LambdaFunctionNames: {
    /** Pet status updater function name */
    readonly StatusUpdater: string;
    readonly TrafficGenerator: string;
    readonly PetfoodImageGenerator: string;
    readonly PetfoodCleanupProcessor: string;
    readonly RdsSeeder: "rds-seeder";
};
/**
 * Abstract base class for workshop Lambda functions.
 *
 * This class provides a common foundation for creating Lambda functions
 * with consistent configuration, observability features, and security
 * best practices. Concrete implementations must provide specific
 * permissions, environment variables, and bundling configurations.
 */
export declare abstract class WokshopLambdaFunction extends Construct {
    /** The Lambda function instance */
    function: Function;
    /**
     * Creates a new workshop Lambda function.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the function
     * @throws Error if the runtime is not supported
     */
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties);
    /**
     * Creates IAM role for Lambda function with VPC permissions if needed
     */
    private createLambdaRole;
    /**
     * Use event bridge to schedule the function execution using the specified
     * schedule expression
     * @param scheduleExpression
     */
    scheduleFunction(scheduleExpression: string): void;
    /**
     * Adds IAM permissions required by the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     */
    abstract addFunctionPermissions(properties: WorkshopLambdaFunctionProperties): void;
    /**
     * Creates CloudFormation outputs for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     */
    abstract createOutputs(properties: WorkshopLambdaFunctionProperties): void;
    /**
     * Returns environment variables for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     * @returns Map of environment variable names to values
     */
    abstract getEnvironmentVariables(properties: WorkshopLambdaFunctionProperties): {
        [key: string]: string;
    } | undefined;
    /**
     * Returns Lambda layers to be attached to the function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     * @returns Array of Lambda layer versions
     */
    abstract getLayers(properties: WorkshopLambdaFunctionProperties): ILayerVersion[];
    /**
     * Returns bundling options for the Lambda function code.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     * @returns Bundling configuration options
     */
    abstract getBundling(properties: WorkshopLambdaFunctionProperties): BundlingOptions;
}
