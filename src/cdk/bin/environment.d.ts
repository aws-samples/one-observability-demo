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
import { MicroserviceApplicationPlacement } from '../lib/stages/applications';
import { WorkshopLambdaFunctionProperties } from '../lib/constructs/lambda';
import { Duration } from 'aws-cdk-lib';
/**
 * Host type enumeration for microservice deployment.
 * Defines where microservices can be deployed.
 */
export declare enum HostType {
    /** Amazon Elastic Container Service */
    ECS = "ECS",
    /** Amazon Elastic Kubernetes Service */
    EKS = "EKS"
}
/**
 * Compute type enumeration for container workloads.
 * Defines the compute platform for running containers.
 */
export declare enum ComputeType {
    /** Amazon EC2 instances */
    EC2 = "EC2",
    /** AWS Fargate serverless compute */
    Fargate = "Fargate"
}
/** AWS Account ID from environment variable */
export declare const ACCOUNT_ID: string | undefined;
/** AWS Region from environment variable */
export declare const REGION: string | undefined;
/** S3 bucket name for configuration storage */
export declare const CONFIG_BUCKET: string | undefined;
/** GitHub organization name, defaults to 'aws-samples' */
export declare const ORGANIZATION_NAME: string;
/** Repository name, defaults to 'one-observability-demo' */
export declare const REPOSITORY_NAME: string;
/** Git branch name for the pipeline source */
export declare const BRANCH_NAME: string;
/** Working directory for CDK operations */
export declare const WORKING_FOLDER: string;
/** Default tags applied to all resources */
export declare const TAGS: {
    environment: string;
    application: string;
    stackName: string;
};
/** Default retention period for logs */
export declare const DEFAULT_RETENTION_DAYS = RetentionDays.ONE_WEEK;
/** Core infrastructure properties for the workshop */
export declare const CORE_PROPERTIES: {
    /** Whether to create a new VPC or use existing one */
    createVpc: true;
    /** CIDR range for the VPC */
    vpcCider: string;
    /** Existing VPC ID to use instead of creating new one */
    vpcId: string | undefined;
    /** Create CloudTrail and Cloudwatch logs for events */
    createCloudTrail: true;
    /** Default retention for logs in the core components */
    defaultRetentionDays: RetentionDays;
};
/** Microservices definitions */
/** Microservices definitions for the pet adoption application */
/** Pay for Adoption microservice configuration (Go implementation) */
export declare const PAYFORADOPTION_GO: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
};
/** Pet List Adoptions microservice configuration (Go implementation) */
export declare const PETLISTADOPTIONS_PY: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
};
/** Pet Search microservice configuration (Java implementation) */
export declare const PETSEARCH_JAVA: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
};
/** Pet Site frontend application configuration (deployed on EKS) */
export declare const PETSITE_NET: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
    manifestPath: string;
};
/** Pet Status Updater microservice configuration */
export declare const PETFOOD_RS: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
};
/** Complete list of all microservice applications */
export declare const APPLICATION_LIST: {
    name: string;
    dockerFilePath: string;
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
}[];
/** Map of microservice names to their deployment configurations */
export declare const MICROSERVICES_PLACEMENT: Map<string, MicroserviceApplicationPlacement>;
/** Paths to pet image assets for seeding the application */
export declare const PET_IMAGES: string[];
/** Prefix for AWS Systems Manager Parameter Store parameters */
export declare const PARAMETER_STORE_PREFIX = "/petstore";
/** Lambda function configuration for pet status updater */
export declare const STATUS_UPDATER_FUNCTION: {
    name: string;
    runtime: Runtime;
    depsLockFilePath: string;
    entry: string;
    memorySize: number;
    handler: string;
    enableSchedule: boolean;
};
export declare const TRAFFIC_GENERATOR_FUNCTION: {
    name: string;
    runtime: Runtime;
    depsLockFilePath: string;
    entry: string;
    memorySize: number;
    handler: string;
    scheduleExpression: string;
    enableSchedule: boolean;
    timeout: Duration;
};
export declare const PETFOOD_IMAGE_GENERATOR_FUNCTION: {
    name: string;
    runtime: Runtime;
    entry: string;
    index: string;
    memorySize: number;
    handler: string;
    enableSchedule: boolean;
};
export declare const PETFOOD_CLEANUP_PROCESSOR_FUNCTION: {
    name: string;
    runtime: Runtime;
    depsLockFilePath: string;
    entry: string;
    memorySize: number;
    handler: string;
    enableSchedule: boolean;
};
export declare const RDS_SEEDER_FUNCTION: {
    name: string;
    runtime: Runtime;
    entry: string;
    index: string;
    memorySize: number;
    handler: string;
};
export declare const PETSITE_TRAFFIC_GENERATOR_FUNCTION: {
    name: string;
    runtime: Runtime;
    depsLockFilePath: string;
    entry: string;
    memorySize: number;
    handler: string;
    enableSchedule: boolean;
    timeout: Duration;
};
/** Map of Lambda function names to their configurations */
export declare const LAMBDA_FUNCTIONS: Map<string, WorkshopLambdaFunctionProperties>;
export declare const PETSITE_CANARY: {
    name: string;
    runtime: CanaryRuntime;
    scheduleExpression: string;
    handler: string;
    path: string;
};
export declare const HOUSEKEEPING_CANARY: {
    name: string;
    runtime: CanaryRuntime;
    scheduleExpression: string;
    handler: string;
    path: string;
};
export declare const CANARY_FUNCTIONS: Map<string, {
    name: string;
    runtime: CanaryRuntime;
    scheduleExpression: string;
    handler: string;
    path: string;
}>;
/** Maximum number of Availability Zones to use for high availability */
export declare const MAX_AVAILABILITY_ZONES = 2;
/** Aurora PostgreSQL engine version for the workshop database */
export declare const AURORA_POSTGRES_VERSION: AuroraPostgresEngineVersion;
/** This section contains all values that can be customized for the workshop deployment
 * Values can be overridden via CDK context or environment variables
 */
export declare const CUSTOM_ENABLE_WAF: boolean;
export declare const CUSTOM_ENABLE_GUARDDUTY_EKS_ADDON: boolean;
/**
 * This section contains values that will affect the workshop deployment
 * based on the current status of the account where the workshop is being deployed
 */
export declare const AUTO_TRANSACTION_SEARCH_CONFIGURED: boolean;
