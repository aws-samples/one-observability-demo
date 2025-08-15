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
export const ACCOUNT_ID = process.env.AWS_ACCOUNT;

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
export const PETLISTADOPTIONS_GO = {
    name: 'petlistadoption-go',
    dockerFilePath: 'src/applications/microservices/petlistadoptions-go',
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
export const PETSITE = {
    name: 'petsite',
    dockerFilePath: 'src/applications/microservices/petsite-net/petsite',
    hostType: HostType.EKS,
    computeType: ComputeType.Fargate,
    disableService: false,
    manifestPath: 'lib/microservices/manifests/petsite-deployment.yaml',
};

/** Pet Status Updater microservice configuration */
export const PETSTATUSUPDATER = {
    name: 'petstatusupdater',
    dockerFilePath: 'src/applications/microservices/petstatusupdater',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

/** Complete list of all microservice applications */
export const APPLICATION_LIST = [PAYFORADOPTION_GO, PETLISTADOPTIONS_GO, PETSEARCH_JAVA, PETSITE];

/** Map of microservice names to their deployment configurations */
export const MICROSERVICES_PLACEMENT = new Map<string, MicroserviceApplicationPlacement>([
    [PAYFORADOPTION_GO.name, PAYFORADOPTION_GO],
    [PETLISTADOPTIONS_GO.name, PETLISTADOPTIONS_GO],
    [PETSEARCH_JAVA.name, PETSEARCH_JAVA],
    [PETSITE.name, PETSITE],
]);

/** Paths to pet image assets for seeding the application */
export const PET_IMAGES = [
    '../../static/images/bunnies.zip',
    '../../static/images/kitten.zip',
    '../../static/images/puppies.zip',
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
    handle: 'handler',
};

export const PET_HISTORY_FUNCTION = {
    name: 'pethistory-node',
    runtime: Runtime.NODEJS_22_X,
    depsLockFilePath: '../applications/lambda/pethistory-node/package-lock.json',
    entry: '../applications/lambda/pethistory-node/index.js',
    memorySize: 128,
    handle: 'handler',
};

/** Map of Lambda function names to their configurations */
export const LAMBDA_FUNCTIONS = new Map<string, WorkshopLambdaFunctionProperties>([
    [STATUS_UPDATER_FUNCTION.name, STATUS_UPDATER_FUNCTION],
]);

/** Maximum number of Availability Zones to use for high availability */
export const MAX_AVAILABILITY_ZONES = 2;

/** Aurora PostgreSQL engine version for the workshop database */
export const AURORA_POSTGRES_VERSION = AuroraPostgresEngineVersion.VER_16_8;
