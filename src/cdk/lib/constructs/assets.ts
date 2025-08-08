/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

/**
 * Properties for configuring Assets construct
 * @interface AssetsProperties
 */
export interface AssetsProperties {
    /**
     * Array of local file paths to deploy to the S3 bucket as seed data
     * Files will be deployed to the 'petimages' prefix in the bucket
     * @optional
     */
    seedPaths?: string[];
}

/**
 * AWS CDK Construct that creates S3 bucket for pet adoption assets with optional seed data deployment
 * @class Assets
 * @extends Construct
 */
export class WorkshopAssets extends Construct {
    /**
     * The S3 bucket for storing pet adoption assets
     * @public
     */
    public bucket: Bucket;

    /**
     * Creates a new Assets construct with S3 bucket and optional seed data deployment
     * If seedPaths are provided, deploys local assets to the bucket under 'petimages' prefix
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: AssetsProperties) {
        super(scope, id);

        this.bucket = new Bucket(this, 'petadoptionBucket', {
            publicReadAccess: false,
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true,
        });

        NagSuppressions.addResourceSuppressions(this.bucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Bucket doesn not need server access logs',
            },
        ]);

        if (properties?.seedPaths) {
            const sources = properties.seedPaths.map((path: string) => {
                return Source.asset(path);
            });

            const deployment = new BucketDeployment(this, 'petimagesdeployment', {
                sources: sources,
                destinationBucket: this.bucket,
            });

            NagSuppressions.addResourceSuppressions(
                deployment.handlerRole,
                [
                    {
                        id: 'AwsSolutions-IAM4',
                        reason: 'AWS Managed policies is acceptable for the cleanup lambda',
                    },
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'Star resource needed to cleanup the bucket',
                    },
                ],
                true,
            );

            // TODO: Refine the suppression if possible
            NagSuppressions.addStackSuppressions(Stack.of(this), [
                {
                    id: 'AwsSolutions-L1',
                    reason: 'The construct manages the lambda runtime version',
                },
            ]);
        }
    }
    createOutputs(): void {
        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map(
                Object.entries({
                    s3bucketname: this.bucket.bucketName,
                }),
            ),
        );
    }
}
