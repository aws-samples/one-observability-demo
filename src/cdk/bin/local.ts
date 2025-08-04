/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { App, Aspects } from 'aws-cdk-lib';
import { CoreStack } from '../lib/stages/core';
import { APPLICATION_LIST, CORE_PROPERTIES, TAGS } from './environment';
import { ApplicationsStack } from '../lib/stages/applications';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new App();

new CoreStack(app, 'CoreStack', {
    ...CORE_PROPERTIES,
    tags: TAGS,
});

const s3BucketName = process.env.CONFIG_BUCKET;

if (!s3BucketName) {
    throw new Error('CONFIG_BUCKET environment variable is not set');
}

const branch_name = process.env.BRANCH_NAME;

if (!branch_name) {
    throw new Error('BRANCH_NAME environment variable is not set');
}

new ApplicationsStack(app, 'ApplicationsStack', {
    source: {
        bucketName: s3BucketName,
        bucketKey: `repo/refs/heads/${branch_name}/repo.zip`,
    },
    tags: TAGS,
    applicationList: APPLICATION_LIST,
});

// Add CDK-nag compliance checks for AWS Solutions best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
