/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Environment configuration module for the One Observability Workshop.
 *
 * This module defines environment-specific constants and configuration values
 * used throughout the CDK application for consistent deployment across different
 * AWS environments and regions.
 *
 * @packageDocumentation
 */

/**
 * Environment configuration and defaults for the One Observability Workshop.
 *
 * This module provides configuration constants that can be overridden via environment
 * variables or CDK context. It loads environment variables from a .env file and
 * provides sensible defaults for the workshop deployment.
 *
 * @packageDocumentation
 */

import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Runtime as CanaryRuntime } from 'aws-cdk-lib/aws-synthetics';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AuroraPostgresEngineVersion } from 'aws-cdk-lib/aws-rds';
import * as dotenv from 'dotenv';
import { MicroserviceApplicationPlacement } from '../lib/stages/applications';
import { WorkshopLambdaFunctionProperties } from '../lib/constructs/lambda';

/**
 * Host type enumeration for microservice deployment.
 * Defines where microservices can be deployed.
 */
export enum HostType {
    /** Amazon Elastic Container Service */
    ECS = 'ECS',
    /** Amazon Elastic Kubernetes Service */
    EKS = 'EKS',
}

/**
 * Compute type enumeration for container workloads.
 * Defines the compute platform for running containers.
 */
export enum ComputeType {
    /** Amazon EC2 instances */
    EC2 = 'EC2',
    /** AWS Fargate serverless compute */
    Fargate = 'Fargate',
}

// Load environment variables from .env file
dotenv.config();

/** AWS Account ID from environment variable */
export const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;

/** AWS Region from environment variable */
export const REGION = process.env.AWS_REGION;

/** S3 bucket name for configuration storage */
export const CONFIG_BUCKET = process.env.CONFIG_BUCKET;

/** GitHub organization name, defaults to 'aws-samples' */
export const ORGANIZATION_NAME = process.env.ORGANIZATION_NAME || 'aws-samples';

/** Repository name, defaults to 'one-observability-demo' */
export const REPOSITORY_NAME = process.env.REPOSITORY_NAME || 'one-observability-demo';

/** Git branch name for the pipeline source */
export const BRANCH_NAME = process.env.BRANCH_NAME || 'feat/cdkpipeline';

/** Working directory for CDK operations */
export const WORKING_FOLDER = process.env.WORKING_FOLDER || 'src/cdk';

/** Default tags applied to all resources */
export const TAGS = {
    environment: 'non-prod',
    application: 'One Observability Workshop',
    stackName: process.env.STACK_NAME || 'MissingStackName',
};

/** Default retention period for logs */
export const DEFAULT_RETENTION_DAYS = RetentionDays.ONE_WEEK; // TODO: Find a way to parametrize this

/** Core infrastructure properties for the workshop */
export const CORE_PROPERTIES = {
    /** Whether to create a new VPC or use existing one */
    createVpc: process.env.CREATE_VPC == 'false' || true,
    /** CIDR range for the VPC */
    vpcCider: process.env.VPC_CIDR || '10.0.0.0/16',
    /** Existing VPC ID to use instead of creating new one */
    vpcId: process.env.VPC_ID || undefined,
    /** Create CloudTrail and Cloudwatch logs for events */
    createCloudTrail: process.env.CREATE_CLOUDTRAIL == 'false' || true,
    /** Default retention for logs in the core components */
    defaultRetentionDays: DEFAULT_RETENTION_DAYS,
};

/** Microservices definitions */
/** Microservices definitions for the pet adoption application */

/** Pay for Adoption microservice configuration (Go implementation) */
export const PAYFORADOPTION_GO = {
    name: 'payforadoption-go',
    dockerFilePath: 'src/applications/microservices/payforadoption-go',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

/** Pet List Adoptions microservice configuration (Go implementation) */
export const PETLISTADOPTIONS_PY = {
    name: 'petlistadoption-py',
    dockerFilePath: 'src/applications/microservices/petlistadoptions-py',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

/** Pet Search microservice configuration (Java implementation) */
export const PETSEARCH_JAVA = {
    name: 'petsearch-java',
    dockerFilePath: 'src/applications/microservices/petsearch-java',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

/** Pet Site frontend application configuration (deployed on EKS) */
export const PETSITE_NET = {
    name: 'petsite-net',
    dockerFilePath: 'src/applications/microservices/petsite-net/petsite',
    hostType: HostType.EKS,
    computeType: ComputeType.Fargate,
    disableService: false,
    manifestPath: 'lib/microservices/manifests/petsite-deployment.yaml',
};

/** Pet Status Updater microservice configuration */
export const PETFOOD_RS = {
    name: 'petfood-rs',
    dockerFilePath: 'src/applications/microservices/petfood-rs',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

/** Complete list of all microservice applications */
export const APPLICATION_LIST = [PAYFORADOPTION_GO, PETLISTADOPTIONS_PY, PETSEARCH_JAVA, PETSITE_NET, PETFOOD_RS];

/** Map of microservice names to their deployment configurations */
export const MICROSERVICES_PLACEMENT = new Map<string, MicroserviceApplicationPlacement>([
    [PAYFORADOPTION_GO.name, PAYFORADOPTION_GO],
    [PETLISTADOPTIONS_PY.name, PETLISTADOPTIONS_PY],
    [PETSEARCH_JAVA.name, PETSEARCH_JAVA],
    [PETSITE_NET.name, PETSITE_NET],
    [PETFOOD_RS.name, PETFOOD_RS],
]);

/** Paths to pet image assets for seeding the application */
export const PET_IMAGES = [
    '../../static/images/bunnys.zip',
    '../../static/images/kittens.zip',
    '../../static/images/puppys.zip',
    '../../static/images/petfood.zip',
];

/** Prefix for AWS Systems Manager Parameter Store parameters */
export const PARAMETER_STORE_PREFIX = '/petstore';

/** Lambda function configuration for pet status updater */
export const STATUS_UPDATER_FUNCTION = {
    name: 'petupdater-node',
    runtime: Runtime.NODEJS_22_X,
    depsLockFilePath: '../applications/lambda/petstatusupdater-node/package-lock.json',
    entry: '../applications/lambda/petstatusupdater-node/index.js',
    memorySize: 128,
    handler: 'handler',
    enableSchedule: false,
};

export const TRAFFIC_GENERATOR_FUNCTION = {
    name: 'traffic-generator-node',
    runtime: Runtime.NODEJS_22_X,
    depsLockFilePath: '../applications/lambda/traffic-generator-node/package-lock.json',
    entry: '../applications/lambda/traffic-generator-node/index.js',
    memorySize: 128,
    handler: 'handler',
    scheduleExpression: 'rate(1 minute)',
    enableSchedule: true,
};

export const PETFOOD_IMAGE_GENERATOR_FUNCTION = {
    name: 'petfood-image-generator-python',
    runtime: Runtime.PYTHON_3_13,
    entry: '../applications/lambda/petfood-image-generator-python',
    index: 'lambda_function.py',
    memorySize: 128,
    handler: 'lambda_handler',
    enableSchedule: false,
};

export const PETFOOD_CLEANUP_PROCESSOR_FUNCTION = {
    name: 'petfood-cleanup-processor-node',
    runtime: Runtime.NODEJS_22_X,
    depsLockFilePath: '../applications/lambda/petfood-cleanup-processor-node/package-lock.json',
    entry: '../applications/lambda/petfood-cleanup-processor-node/index.js',
    memorySize: 128,
    handler: 'handler',
    enableSchedule: false,
};

/** Map of Lambda function names to their configurations */
export const LAMBDA_FUNCTIONS = new Map<string, WorkshopLambdaFunctionProperties>([
    [STATUS_UPDATER_FUNCTION.name, STATUS_UPDATER_FUNCTION],
    [TRAFFIC_GENERATOR_FUNCTION.name, TRAFFIC_GENERATOR_FUNCTION],
    [PETFOOD_CLEANUP_PROCESSOR_FUNCTION.name, PETFOOD_CLEANUP_PROCESSOR_FUNCTION],
    [PETFOOD_IMAGE_GENERATOR_FUNCTION.name, PETFOOD_IMAGE_GENERATOR_FUNCTION],
]);

export const PETSITE_CANARY = {
    name: 'petsite-canary',
    runtime: CanaryRuntime.SYNTHETICS_NODEJS_PUPPETEER_9_1,
    scheduleExpression: 'rate(1 minute)',
    handler: 'index.handler',
    path: '../applications/canaries/petsite-canary',
};

export const HOUSEKEEPING_CANARY = {
    name: 'housekeeping-canary',
    runtime: CanaryRuntime.SYNTHETICS_NODEJS_PUPPETEER_9_1,
    scheduleExpression: 'rate(30 minutes)',
    handler: 'index.handler',
    path: '../applications/canaries/housekeeping',
};

export const CANARY_FUNCTIONS = new Map([
    [PETSITE_CANARY.name, PETSITE_CANARY],
    [HOUSEKEEPING_CANARY.name, HOUSEKEEPING_CANARY],
]);

/** Maximum number of Availability Zones to use for high availability */
export const MAX_AVAILABILITY_ZONES = 2;

/** Aurora PostgreSQL engine version for the workshop database */
export const AURORA_POSTGRES_VERSION = AuroraPostgresEngineVersion.VER_16_8;

/** This section contains all values that can be customized for the workshop deployment
 * Values can be overridden via CDK context or environment variables
 */

export const CUSTOM_ENABLE_WAF = process.env.CUSTOM_ENABLE_WAF == 'true' || false;
export const CUSTOM_ENABLE_GUARDDUTY_EKS_ADDON = process.env.CUSTOM_ENABLE_GUARDDUTY_EKS_ADDON == 'true' || false;

/**
 * This section contains values that will affect the workshop deployment
 * based on the current status of the account where the workshop is being deployed
 */

export const AUTO_TRANSACTION_SEARCH_CONFIGURED = process.env.AUTO_TRANSACTION_SEARCH_CONFIGURED == 'true' || false;
