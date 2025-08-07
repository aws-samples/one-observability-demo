/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { App, Aspects } from 'aws-cdk-lib';
import { CoreStack } from '../lib/stages/core';
import {
    APPLICATION_LIST,
    AURORA_POSTGRES_VERSION,
    CORE_PROPERTIES,
    LAMBDA_FUNCTIONS,
    MICROSERVICES_PLACEMENT,
    PET_IMAGES,
    TAGS,
} from './environment';
import { ContainersStack } from '../lib/stages/containers';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StorageStack } from '../lib/stages/storage';
import { ComputeStack } from '../lib/stages/compute';
import { MicroservicesStack } from '../lib/stages/applications';

const app = new App();

new CoreStack(app, 'DevCoreStack', {
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

new ContainersStack(app, 'DevApplicationsStack', {
    source: {
        bucketName: s3BucketName,
        bucketKey: `repo/refs/heads/${branch_name}/repo.zip`,
    },
    tags: TAGS,
    applicationList: APPLICATION_LIST,
});

new StorageStack(app, 'DevStorageStack', {
    tags: TAGS,
    assetsProperties: {
        seedPaths: PET_IMAGES,
    },
    auroraDatabaseProperties: {
        engineVersion: AURORA_POSTGRES_VERSION,
    },
});

new ComputeStack(app, 'DevComputeStack', {
    tags: TAGS,
});

new MicroservicesStack(app, 'DevMicroservicesStack', {
    tags: TAGS,
    microservicesPlacement: MICROSERVICES_PLACEMENT,
    lambdaFunctions: LAMBDA_FUNCTIONS,
});

// Add CDK-nag compliance checks for AWS Solutions best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
