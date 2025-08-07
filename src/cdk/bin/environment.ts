/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
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
import dotenv from 'dotenv';
import { MicroserviceApplicationPlacement } from '../lib/stages/applications';
import { WorkshopLambdaFunctionProperties } from '../lib/constructs/lambda';

export enum HostType {
    ECS = 'ECS',
    EKS = 'EKS',
}

export enum ComputeType {
    EC2 = 'EC2',
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
export const PAYFORADOPTION_GO = {
    name: 'payforadoption-go',
    dockerFilePath: 'PetAdoptions/payforadoption-go',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const PETLISTADOPTIONS_GO = {
    name: 'petlistadoption-go',
    dockerFilePath: 'PetAdoptions/petlistadoptions-go',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const PETSEARCH_JAVA = {
    name: 'petsearch-java',
    dockerFilePath: 'PetAdoptions/petsearch-java',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const PETSITE = {
    name: 'petsite',
    dockerFilePath: 'PetAdoptions/petsite/petsite',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const PETSTATUSUPDATER = {
    name: 'petstatusupdater',
    dockerFilePath: 'PetAdoptions/petstatusupdater',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const TRAFFICGENERATOR = {
    name: 'trafficgenerator',
    dockerFilePath: 'PetAdoptions/trafficgenerator/trafficgenerator',
    hostType: HostType.ECS,
    computeType: ComputeType.Fargate,
    disableService: false,
};

export const APPLICATION_LIST = [PAYFORADOPTION_GO, PETLISTADOPTIONS_GO, PETSEARCH_JAVA, PETSITE, TRAFFICGENERATOR];

export const MICROSERVICES_PLACEMENT = new Map<string, MicroserviceApplicationPlacement>([
    [PAYFORADOPTION_GO.name, PAYFORADOPTION_GO],
    [PETLISTADOPTIONS_GO.name, PETLISTADOPTIONS_GO],
    [PETSEARCH_JAVA.name, PETSEARCH_JAVA],
    [PETSITE.name, PETSITE],
    [TRAFFICGENERATOR.name, TRAFFICGENERATOR],
]);

export const PET_IMAGES = [
    '../../PetAdoptions/cdk/pet_stack/resources/bunnies.zip',
    '../../PetAdoptions/cdk/pet_stack/resources/kitten.zip',
    '../../PetAdoptions/cdk/pet_stack/resources/puppies.zip',
];

export const PARAMETER_STORE_PREFIX = '/petstore';

export const STATUS_UPDATER_FUNCTION = {
    name: 'petupdater',
    runtime: Runtime.NODEJS_22_X,
    depsLockFilePath: '../../PetAdoptions/petstatusupdater/package-lock.json',
    entry: '../../PetAdoptions/petstatusupdater/index.js',
    memorySize: 128,
    handle: 'handler',
};

export const LAMBDA_FUNCTIONS = new Map<string, WorkshopLambdaFunctionProperties>([
    [STATUS_UPDATER_FUNCTION.name, STATUS_UPDATER_FUNCTION],
]);

export const MAX_AVAILABILITY_ZONES = 2;
export const VPC_ID_EXPORT_NAME = 'WorkshopVPC';
export const VPC_CIDR_EXPORT_NAME = 'WorkshopVPCCidr';
export const VPC_PRIVATE_SUBNETS_EXPORT_NAME = 'WorkshopVPCPrivateSubnets';
export const VPC_PUBLIC_SUBNETS_EXPORT_NAME = 'WorkshopVPCPublicSubnets';
export const VPC_ISOLATED_SUBNETS_EXPORT_NAME = 'WorkshopVPCIsolatedSubnets';
export const VPC_AVAILABILITY_ZONES_EXPORT_NAME = 'WorkshopVPCAvailabilityZones';
export const VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCPrivateSubnetCidrs';
export const VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCPublicSubnetCidrs';
export const VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCIsolatedSubnetCidrs';

export const SNS_TOPIC_ARN_EXPORT_NAME = 'WorkshopSNSTopicArn';
export const SQS_QUEUE_ARN_EXPORT_NAME = 'WorkshopSQSQueueArn';
export const SQS_QUEUE_URL_EXPORT_NAME = 'WorkshopSQSQueueUrl';

export const ECS_CLUSTER_ARN_EXPORT_NAME = 'WorkshopECSClusterArn';
export const ECS_CLUSTER_NAME_EXPORT_NAME = 'WorkshopECSClusterName';
export const ECS_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopECSSecurityGroupId';
export const EKS_CLUSTER_ARN_EXPORT_NAME = 'WorkshopEKSClusterArn';
export const EKS_CLUSTER_NAME_EXPORT_NAME = 'WorkshopEKSClusterName';
export const EKS_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopEKSSecurityGroupId';

export const AURORA_CLUSTER_ARN_EXPORT_NAME = 'WorkshopAuroraClusterArn';
export const AURORA_CLUSTER_ENDPOINT_EXPORT_NAME = 'WorkshopAuroraClusterEndpoint';
export const AURORA_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopAuroraSecurityGroupId';
export const AURORA_ADMIN_SECRET_ARN_EXPORT_NAME = 'WorkshopAuroraAdminSecretArn'; //pragma: allowlist secret
export const DYNAMODB_TABLE_ARN_EXPORT_NAME = 'WorkshopDynamoDBTableArn';
export const DYNAMODB_TABLE_NAME_EXPORT_NAME = 'WorkshopDynamoDBTableName';

export const AURORA_POSTGRES_VERSION = AuroraPostgresEngineVersion.VER_16_8;
