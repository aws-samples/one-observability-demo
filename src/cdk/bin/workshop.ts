#!/usr/bin/env node

/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
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
} from './environment';

const app = new App();

new CDKPipeline(app, 'CDKPipeline', {
    configBucketName: app.node.tryGetContext('configBucketName') || CONFIG_BUCKET,
    branchName: app.node.tryGetContext('branchName') || BRANCH_NAME,
    organizationName: app.node.tryGetContext('organizationName') || ORGANIZATION_NAME,
    repositoryName: app.node.tryGetContext('repositoryName') || REPOSITORY_NAME,
    workingFolder: app.node.tryGetContext('workingFolder') || WORKING_FOLDER,
    env: {
        account: ACCOUNT_ID,
        region: REGION,
    },
});

const TAGS = {
    environment: 'non-prod',
    application: 'One Observability Workshop',
};

/**
 * Tag all child resources of the application
 */

Utilities.TagConstruct(app, TAGS);

/**
 * Add CDK-nag to check for AWS Solutions best practices
 */
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
