#!/usr/bin/env node

/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { App, Aspects } from 'aws-cdk-lib';
import { CDKPipeline } from '../lib/pipeline';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Utilities } from '../lib/utils/utilities';

const app = new App();
new CDKPipeline(app, 'CDKPipeline', {
    configBucketName: app.node.tryGetContext('configBucketName'),
    branchName: app.node.tryGetContext('branchName') || undefined,
    organizationName: app.node.tryGetContext('organizationName') || undefined,
    repositoryName: app.node.tryGetContext('repositoryName') || undefined,
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
