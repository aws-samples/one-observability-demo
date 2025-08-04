#!/usr/bin/env node

/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Entry point for the One Observability Workshop CDK application.
 *
 * This file creates the main CDK app and instantiates the pipeline stack
 * with configuration from environment variables and CDK context.
 * It also applies resource tagging and AWS Solutions compliance checks.
 *
 * @packageDocumentation
 */

import { App, Aspects } from 'aws-cdk-lib';
import { CDKPipeline } from '../lib/pipeline';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Utilities } from '../lib/utils/utilities';
import {
    CONFIG_BUCKET,
    REGION,
    ACCOUNT_ID,
    BRANCH_NAME,
    ORGANIZATION_NAME,
    REPOSITORY_NAME,
    WORKING_FOLDER,
    TAGS,
    CORE_PROPERTIES,
} from './environment';

/** Main CDK application instance */
const app = new App();

/**
 * Create the main pipeline stack for the One Observability Workshop.
 * Configuration values are resolved from CDK context first, then fall back to environment variables.
 */
new CDKPipeline(app, 'OneObservabilityWorkshopPipeline', {
    configBucketName: app.node.tryGetContext('configBucketName') || CONFIG_BUCKET,
    branchName: app.node.tryGetContext('branchName') || BRANCH_NAME,
    organizationName: app.node.tryGetContext('organizationName') || ORGANIZATION_NAME,
    repositoryName: app.node.tryGetContext('repositoryName') || REPOSITORY_NAME,
    workingFolder: app.node.tryGetContext('workingFolder') || WORKING_FOLDER,
    env: {
        account: ACCOUNT_ID,
        region: REGION,
    },
    tags: TAGS,
    coreStageProperties: CORE_PROPERTIES,
});

// Apply tags to all resources in the application
Utilities.TagConstruct(app, TAGS);

// Add CDK-nag compliance checks for AWS Solutions best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
