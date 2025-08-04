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

import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import dotenv from 'dotenv';

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
