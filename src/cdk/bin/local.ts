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

import { App, Aspects, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CoreStack } from '../lib/stages/core';
import {
    APPLICATION_LIST,
    AURORA_POSTGRES_VERSION,
    CANARY_FUNCTIONS,
    CORE_PROPERTIES,
    CUSTOM_ENABLE_WAF,
    DEFAULT_RETENTION_DAYS,
    LAMBDA_FUNCTIONS,
    MICROSERVICES_PLACEMENT,
    PET_IMAGES,
    TAGS,
    CODE_CONNECTION_ARN,
    CUSTOM_ENABLE_CLOUDFRONT_LOGS,
} from './environment';
import { ContainersStack } from '../lib/stages/containers';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StorageStack } from '../lib/stages/storage';
import { ComputeStack } from '../lib/stages/compute';
import { MicroservicesStack } from '../lib/stages/applications';
import { Utilities, WorkshopNagPack } from '../lib/utils/utilities';
import { NagSuppressions } from 'cdk-nag';
import { GlobalWaf } from '../lib/constructs/waf';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

/** CDK Application instance for local deployment */
const app = new App();

/** Deploy core infrastructure stack with networking and security components */
const core = new CoreStack(app, 'DevCoreStack', {
    ...CORE_PROPERTIES,
    tags: TAGS,
    env: {
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
    },
});

if ((CUSTOM_ENABLE_WAF || CUSTOM_ENABLE_CLOUDFRONT_LOGS) && process.env?.AWS_REGION != 'us-east-1') {
    // A Separate stage is needed if the region is NOT us-east-1
    // This is handled in the stage but needs to be copied here for local
    // deployments
    const globalStack = new Stack(app, 'GlobalStack', {
        crossRegionReferences: true,
        env: {
            region: 'us-east-1',
            account: process.env.AWS_ACCOUNT_ID,
        },
        tags: TAGS,
    });
    if (CUSTOM_ENABLE_WAF) {
        const globalWaf = new GlobalWaf(globalStack, 'GlobalWaf', {
            logRetention: DEFAULT_RETENTION_DAYS,
        });
        globalWaf.replicateParameterToRegion(core);
    }

    if (CUSTOM_ENABLE_CLOUDFRONT_LOGS) {
        /** A log group will be created, but is not associated with the Cloudfront
         * distribution. This configuration must be done in the console.
         * https://github.com/aws/aws-cdk/issues/32279
         */
        new LogGroup(globalStack, 'CloudFrontLogGroup', {
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });
    }
    if (TAGS) {
        Utilities.TagConstruct(globalStack, TAGS);
    }
}

/** Validate required environment variables */
const s3BucketName = process.env.CONFIG_BUCKET;
if (!s3BucketName && !CODE_CONNECTION_ARN) {
    throw new Error('CONFIG_BUCKET or CODE_CONNECTION_ARN environment variable must be set');
}

const branch_name = process.env.BRANCH_NAME;
if (!branch_name) {
    throw new Error('BRANCH_NAME environment variable is not set');
}

/** Deploy container applications stack with ECS and EKS services */
const containers = new ContainersStack(app, 'DevApplicationsStack', {
    // Conditionally use CodeConnection or S3 source based on environment
    ...(CODE_CONNECTION_ARN
        ? {
              codeConnectionSource: {
                  connectionArn: CODE_CONNECTION_ARN,
                  organizationName: process.env.ORGANIZATION_NAME || 'aws-samples',
                  repositoryName: process.env.REPOSITORY_NAME || 'one-observability-demo',
                  branchName: branch_name,
              },
          }
        : {
              source: {
                  bucketName: s3BucketName!,
                  bucketKey: `repo/refs/heads/${branch_name}/repo.zip`,
              },
          }),
    tags: TAGS,
    applicationList: APPLICATION_LIST,
    env: {
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
    },
});

/** Deploy storage stack with S3, Aurora, and DynamoDB */
const storage = new StorageStack(app, 'DevStorageStack', {
    tags: TAGS,
    assetsProperties: {
        seedPaths: PET_IMAGES,
        globalWebACLArn: CUSTOM_ENABLE_WAF ? GlobalWaf.globalAclArnFromParameter() : undefined,
    },
    auroraDatabaseProperties: {
        engineVersion: AURORA_POSTGRES_VERSION,
    },
    env: {
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
    },
});
storage.addDependency(core, 'Network is needed');

/** Deploy compute stack with Lambda functions and EC2 resources */
const compute = new ComputeStack(app, 'DevComputeStack', {
    tags: TAGS,
});

compute.addDependency(core, 'Network is needed');

/** Deploy microservices stack with pet store application components */
const microservices = new MicroservicesStack(app, 'DevMicroservicesStack', {
    tags: TAGS,
    microservicesPlacement: MICROSERVICES_PLACEMENT,
    lambdaFunctions: LAMBDA_FUNCTIONS,
    env: {
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
    },
    canaries: CANARY_FUNCTIONS,
});
microservices.addDependency(compute, 'Need to know where to run');

/** Tag all resources to indicate local deployment */
Utilities.TagConstruct(app, {
    LocalDeployment: 'true',
});

/** Add CDK-nag compliance checks for AWS Solutions best practices */
Aspects.of(app).add(
    new AwsSolutionsChecks({
        verbose: true,
        reports: true,
        logIgnores: false,
    }),
);

/** Add Workshop-specific NAG pack for resource deletion validation */
Aspects.of(app).add(
    new WorkshopNagPack({
        verbose: true,
        reports: true,
        logIgnores: false,
    }),
);

/** Suppress CdkNagValidationFailure globally */
Utilities.SuppressLogRetentionNagWarnings(app);
Utilities.SuppressKubectlProviderNagWarnings(app);

/** Suppress Workshop Lambda rule for CDK custom resource providers */
const stacks = [core, containers, storage, compute, microservices];
for (const stack of stacks) {
    NagSuppressions.addStackSuppressions(stack, [
        {
            id: 'CdkNagValidationFailure',
            reason: 'Intrinsic functions cannot be resolved at synthesis time',
            appliesTo: ['AwsSolutions-EC23'],
        },
    ]);

    NagSuppressions.addStackSuppressions(stack, [
        {
            id: 'Workshop-Lambda1',
            reason: 'Custom Resources do not have a way to configure logs',
            appliesTo: [
                {
                    regex: '/Custom::.*/g',
                },
            ],
        },
    ]);
}
