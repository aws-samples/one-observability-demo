/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

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
import { BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import {
    PETFOOD_CLEANUP_PROCESSOR_FUNCTION,
    PETFOOD_IMAGE_GENERATOR_FUNCTION,
    STATUS_UPDATER_FUNCTION,
    TRAFFIC_GENERATOR_FUNCTION,
} from '../../bin/environment';
import { Queue } from 'aws-cdk-lib/aws-sqs';

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
    handle: string;
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
}

/**
 * Predefined Lambda function names used throughout the workshop.
 */
export const LambdaFunctionNames = {
    /** Pet status updater function name */
    StatusUpdater: STATUS_UPDATER_FUNCTION.name,
    TrafficGenerator: TRAFFIC_GENERATOR_FUNCTION.name,
    PetfoodImageGenerator: PETFOOD_IMAGE_GENERATOR_FUNCTION.name,
    PetfoodCleanupProcessor: PETFOOD_CLEANUP_PROCESSOR_FUNCTION.name,
} as const;

/**
 * Abstract base class for workshop Lambda functions.
 *
 * This class provides a common foundation for creating Lambda functions
 * with consistent configuration, observability features, and security
 * best practices. Concrete implementations must provide specific
 * permissions, environment variables, and bundling configurations.
 */
export abstract class WokshopLambdaFunction extends Construct {
    /** The Lambda function instance */
    public function: Function;

    /**
     * Creates a new workshop Lambda function.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the function
     * @throws Error if the runtime is not supported
     */
    constructor(scope: Construct, id: string, properties: WorkshopLambdaFunctionProperties) {
        super(scope, id);

        if (properties.runtime.name.startsWith('nodejs')) {
            /** NodeJS Lambda function */
            this.function = new NodejsFunction(this, `${properties.name}-function`, {
                runtime: properties.runtime,
                depsLockFilePath: properties.depsLockFilePath,
                entry: properties.entry,
                handler: properties.handle,
                memorySize: properties.memorySize,
                logRetention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
                layers: this.getLayers(properties),
                environment: this.getEnvironmentVariables(properties),
                bundling: this.getBundling(properties),
                deadLetterQueueEnabled: true,
                deadLetterQueue: new Queue(this, 'DeadLetterQueue', {
                    queueName: `${properties.name}-dlq`,
                    enforceSSL: true,
                }),
            });
        } else {
            throw new Error(`Runtime ${properties.runtime.name} not supported`);
        }

        if (properties.enableSchedule && properties.scheduleExpression) {
            this.scheduleFunction(properties.scheduleExpression);
        }

        this.addFunctionPermissions(properties);
    }

    /**
     * Use event bridge to schedule the function execution using the specified
     * schedule expression
     * @param scheduleExpression
     */
    scheduleFunction(scheduleExpression: string) {
        const rule = new Rule(this, 'ScheduleRule', {
            schedule: Schedule.expression(scheduleExpression),
        });

        rule.addTarget(new LambdaFunction(this.function));
    }

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
    abstract getEnvironmentVariables(
        properties: WorkshopLambdaFunctionProperties,
    ): { [key: string]: string } | undefined;

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
