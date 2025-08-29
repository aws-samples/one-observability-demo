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

import { Runtime, Function, ILayerVersion, Architecture } from 'aws-cdk-lib/aws-lambda';
import { BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
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
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { RemovalPolicy } from 'aws-cdk-lib';

/**
 * Gets the OpenTelemetry Python layer ARN for the specified region.
 * @param region - AWS region
 * @returns Complete ARN for the OpenTelemetry Python layer
 */
export function getOpenTelemetryPythonLayerArn(region: string): string {
    const layerMappings: Record<string, { account: string; version: string }> = {
        'us-east-1': { account: '615299751070', version: '16' },
        'us-east-2': { account: '615299751070', version: '13' },
        'us-west-1': { account: '615299751070', version: '20' },
        'us-west-2': { account: '615299751070', version: '20' },
        'af-south-1': { account: '904233096616', version: '10' },
        'ap-east-1': { account: '888577020596', version: '10' },
        'ap-south-2': { account: '796973505492', version: '10' },
        'ap-southeast-3': { account: '039612877180', version: '10' },
        'ap-southeast-4': { account: '713881805771', version: '10' },
        'ap-southeast-5': { account: '152034782359', version: '1' },
        'ap-southeast-7': { account: '980416031188', version: '1' },
        'ap-south-1': { account: '615299751070', version: '13' },
        'ap-northeast-3': { account: '615299751070', version: '12' },
        'ap-northeast-2': { account: '615299751070', version: '13' },
        'ap-southeast-1': { account: '615299751070', version: '12' },
        'ap-southeast-2': { account: '615299751070', version: '13' },
        'ap-northeast-1': { account: '615299751070', version: '13' },
        'ca-central-1': { account: '615299751070', version: '13' },
        'ca-west-1': { account: '595944127152', version: '1' },
        'eu-central-1': { account: '615299751070', version: '13' },
        'eu-west-1': { account: '615299751070', version: '13' },
        'eu-west-2': { account: '615299751070', version: '13' },
        'eu-south-1': { account: '257394471194', version: '10' },
        'eu-west-3': { account: '615299751070', version: '13' },
        'eu-south-2': { account: '490004653786', version: '10' },
        'eu-north-1': { account: '615299751070', version: '13' },
        'eu-central-2': { account: '156041407956', version: '10' },
        'il-central-1': { account: '746669239226', version: '10' },
        'me-south-1': { account: '980921751758', version: '10' },
        'me-central-1': { account: '739275441131', version: '10' },
        'sa-east-1': { account: '615299751070', version: '13' },
        'mx-central-1': { account: '610118373846', version: '1' },
    };

    const mapping = layerMappings[region];
    if (!mapping) {
        throw new Error(`OpenTelemetry Python layer not available in region: ${region}`);
    }

    return `arn:aws:lambda:${region}:${mapping.account}:layer:AWSOpenTelemetryDistroPython:${mapping.version}`;
}

/**
 * Gets the Lambda Insights layer ARN for the specified region.
 * @param region - AWS region
 * @returns Complete ARN for the Lambda Insights layer
 */
export function getLambdaInsightsLayerArn(region: string): string {
    const layerMappings: Record<string, { account: string; version: string; partition?: string }> = {
        'us-east-1': { account: '580247275435', version: '56' },
        'us-east-2': { account: '580247275435', version: '56' },
        'us-west-1': { account: '580247275435', version: '56' },
        'us-west-2': { account: '580247275435', version: '56' },
        'af-south-1': { account: '012438385374', version: '47' },
        'ap-southeast-7': { account: '761018874580', version: '3' },
        'ap-east-1': { account: '519774774795', version: '47' },
        'ap-south-2': { account: '891564319516', version: '29' },
        'ap-southeast-3': { account: '439286490199', version: '33' },
        'ap-southeast-5': { account: '590183865173', version: '4' },
        'ap-southeast-4': { account: '158895979263', version: '24' },
        'ap-south-1': { account: '580247275435', version: '54' },
        'ap-northeast-3': { account: '194566237122', version: '37' },
        'ap-northeast-2': { account: '580247275435', version: '55' },
        'ap-southeast-1': { account: '580247275435', version: '56' },
        'ap-southeast-2': { account: '580247275435', version: '56' },
        'ap-northeast-1': { account: '580247275435', version: '83' },
        'ca-central-1': { account: '580247275435', version: '55' },
        'ca-west-1': { account: '946466191631', version: '16' },
        'cn-north-1': { account: '488211338238', version: '46', partition: 'aws-cn' },
        'cn-northwest-1': { account: '488211338238', version: '46', partition: 'aws-cn' },
        'eu-central-1': { account: '580247275435', version: '56' },
        'eu-west-1': { account: '580247275435', version: '56' },
        'eu-west-2': { account: '580247275435', version: '56' },
        'eu-south-1': { account: '339249233099', version: '47' },
        'eu-west-3': { account: '580247275435', version: '55' },
        'eu-south-2': { account: '352183217350', version: '31' },
        'eu-north-1': { account: '580247275435', version: '53' },
        'eu-central-2': { account: '033019950311', version: '30' },
        'il-central-1': { account: '459530977127', version: '23' },
        'mx-central-1': { account: '879381266642', version: '3' },
        'me-south-1': { account: '285320876703', version: '47' },
        'me-central-1': { account: '732604637566', version: '30' },
        'sa-east-1': { account: '580247275435', version: '55' },
        'us-gov-east-1': { account: '122132214140', version: '24', partition: 'aws-us-gov' },
        'us-gov-west-1': { account: '751350123760', version: '24', partition: 'aws-us-gov' },
    };

    const mapping = layerMappings[region];
    if (!mapping) {
        throw new Error(`Lambda Insights layer not available in region: ${region}`);
    }

    const partition = mapping.partition || 'aws';
    return `arn:${partition}:lambda:${region}:${mapping.account}:layer:LambdaInsightsExtension:${mapping.version}`;
}

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

        const logGroup = new LogGroup(this, 'LogGroup', {
            logGroupName: `/aws/lambda/${properties.name}`,
            retention: properties.logRetentionDays ?? RetentionDays.ONE_DAY,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        if (properties.runtime.name.startsWith('nodejs')) {
            /** NodeJS Lambda function */
            if (!properties.handler) {
                throw new Error('Handler must be specified for Node.js functions');
            }

            this.function = new NodejsFunction(this, `${properties.name}-function`, {
                runtime: properties.runtime,
                architecture: Architecture.X86_64,
                depsLockFilePath: properties.depsLockFilePath,
                entry: properties.entry,
                handler: properties.handler,
                memorySize: properties.memorySize,
                logGroup: logGroup,
                layers: this.getLayers(properties),
                environment: this.getEnvironmentVariables(properties),
                bundling: this.getBundling(properties),
                deadLetterQueueEnabled: true,
                deadLetterQueue: new Queue(this, 'DeadLetterQueue', {
                    queueName: `${properties.name}-dlq`,
                    enforceSSL: true,
                }),
            });
        } else if (properties.runtime.name.startsWith('python')) {
            /** Python Lambda function */
            if (!properties.index) {
                throw new Error('Index must be specified for Python functions');
            }

            this.function = new PythonFunction(this, `${properties.name}-function`, {
                runtime: properties.runtime,
                architecture: Architecture.X86_64,
                index: properties.index,
                entry: properties.entry,
                memorySize: properties.memorySize,
                logGroup: logGroup,
                layers: this.getLayers(properties),
                environment: this.getEnvironmentVariables(properties),
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
