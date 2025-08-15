/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Local development deployment entry point for the One Observability Workshop.
 *
 * This file creates individual CDK stacks for local development and testing,
 * bypassing the pipeline deployment model. It's useful for rapid development
 * and debugging of individual components.
 *
 * The stacks deployed include:
 * - Core infrastructure (VPC, security groups, etc.)
 * - Container applications (ECS/EKS services)
 * - Storage services (S3, Aurora, DynamoDB)
 * - Compute services (Lambda functions, EC2)
 * - Microservices (Pet store application components)
 *
 * @packageDocumentation
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
import { Utilities } from '../lib/utils/utilities';

/** CDK Application instance for local deployment */
const app = new App();

/** Deploy core infrastructure stack with networking and security components */
const core = new CoreStack(app, 'DevCoreStack', {
    ...CORE_PROPERTIES,
    tags: TAGS,
});

/** Validate required environment variables */
const s3BucketName = process.env.CONFIG_BUCKET;
if (!s3BucketName) {
    throw new Error('CONFIG_BUCKET environment variable is not set');
}

const branch_name = process.env.BRANCH_NAME;
if (!branch_name) {
    throw new Error('BRANCH_NAME environment variable is not set');
}

/** Deploy container applications stack with ECS and EKS services */
new ContainersStack(app, 'DevApplicationsStack', {
    source: {
        bucketName: s3BucketName,
        bucketKey: `repo/refs/heads/${branch_name}/repo.zip`,
    },
    tags: TAGS,
    applicationList: APPLICATION_LIST,
});

/** Deploy storage stack with S3, Aurora, and DynamoDB */
new StorageStack(app, 'DevStorageStack', {
    tags: TAGS,
    assetsProperties: {
        seedPaths: PET_IMAGES,
    },
    auroraDatabaseProperties: {
        engineVersion: AURORA_POSTGRES_VERSION,
    },
}).addDependency(core, 'Network is needed');

/** Deploy compute stack with Lambda functions and EC2 resources */
const compute = new ComputeStack(app, 'DevComputeStack', {
    tags: TAGS,
});

compute.addDependency(core, 'Network is needed');

/** Deploy microservices stack with pet store application components */
new MicroservicesStack(app, 'DevMicroservicesStack', {
    tags: TAGS,
    microservicesPlacement: MICROSERVICES_PLACEMENT,
    lambdaFunctions: LAMBDA_FUNCTIONS,
    env: {
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
    },
}).addDependency(compute, 'Need to know where to run');

/** Tag all resources to indicate local deployment */
Utilities.TagConstruct(app, {
    LocalDeployment: 'true',
});

/** Add CDK-nag compliance checks for AWS Solutions best practices */
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
