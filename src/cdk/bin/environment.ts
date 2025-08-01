/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
/**
 * This file contains the environment configuration and defaults for the workshop
 */

// Default values. These values can be overridden in the cdk.context file if needed.

import dotenv from 'dotenv';
dotenv.config(); // This loads the variables from .env into process.env

export const ACCOUNT_ID = process.env.AWS_ACCOUNT;
export const REGION = process.env.AWS_REGION;

export const CONFIG_BUCKET = process.env.CONFIG_BUCKET;
export const CONFIG_BUCKET_KEY = process.env.CONFIG_BUCKET_KEY || 'repo.zip';

export const ORGANIZATION_NAME = process.env.ORGANIZATION_NAME || 'aws-samples';
export const REPOSITORY_NAME = process.env.REPOSITORY_NAME || 'one-observability-demo';
export const BRANCH_NAME = process.env.BRANCH_NAME || 'feat/cdkpipeline'; // TODO: Change to main on release
