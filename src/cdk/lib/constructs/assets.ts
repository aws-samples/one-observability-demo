/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { RemovalPolicy, Stack, CfnOutput, Fn } from 'aws-cdk-lib';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
    Distribution,
    OriginAccessIdentity,
    ViewerProtocolPolicy,
    CachePolicy,
    PriceClass,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import {
    ASSETS_BUCKET_NAME_EXPORT_NAME,
    ASSETS_BUCKET_ARN_EXPORT_NAME,
    SSM_PARAMETER_NAMES,
} from '../../bin/constants';

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
     * The CloudFront distribution for serving pet adoption assets
     * @public
     */
    public distribution: Distribution;

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
                reason: 'Bucket does not need server access logs',
            },
        ]);

        if (properties?.seedPaths) {
            const sources = properties.seedPaths.map((path: string) => {
                return Source.asset(path);
            });

            const deployment = new BucketDeployment(this, 'petimagesdeployment', {
                sources: sources,
                destinationBucket: this.bucket,
                retainOnDelete: false,
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
                {
                    id: 'Workshop-CWL2',
                    reason: 'Custom resource for bucket deployment is managed by the construct',
                },
            ]);
        }

        // Create CloudFront distribution for optimized image delivery
        this.createCloudFrontDistribution();

        // Create CloudFormation outputs for Assets resources
        this.createAssetsOutputs();
    }

    /**
     * Creates CloudFront distribution for optimized asset delivery
     */
    private createCloudFrontDistribution(): void {
        // Create Origin Access Identity for secure S3 access
        const originAccessIdentity = new OriginAccessIdentity(this, 'AssetsOAI', {
            comment: 'OAI for Pet Store Assets',
        });

        // Grant read permissions to CloudFront
        this.bucket.grantRead(originAccessIdentity);

        // Create CloudFront distribution
        this.distribution = new Distribution(this, 'AssetsDistribution', {
            defaultBehavior: {
                origin: S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
                    originAccessIdentity: originAccessIdentity,
                }),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                compress: true,
            },
            comment: 'Pet Store Assets CDN',
            enableIpv6: true,
            priceClass: PriceClass.PRICE_CLASS_ALL,
        });

        // Add CDK-nag suppressions for CloudFront
        NagSuppressions.addResourceSuppressions(this.distribution, [
            {
                id: 'AwsSolutions-CFR1',
                reason: 'CloudFront distribution for static assets does not require geo restrictions',
            },
            {
                id: 'AwsSolutions-CFR2',
                reason: 'CloudFront distribution for static assets does not require WAF',
            },
            {
                id: 'AwsSolutions-CFR3',
                reason: 'CloudFront distribution for static assets does not require access logs',
            },
            {
                id: 'AwsSolutions-CFR4',
                reason: 'Using default CloudFront certificate in the workshop is acceptable',
            },
            {
                id: 'AwsSolutions-CFR7',
                reason: 'Using OAC instead of OAI is acceptable for this workshop',
            },
        ]);
    }

    /**
     * Creates CloudFormation outputs for the S3 bucket resources
     */
    private createAssetsOutputs(): void {
        new CfnOutput(this, 'AssetsBucketNameOutput', {
            value: this.bucket.bucketName,
            exportName: ASSETS_BUCKET_NAME_EXPORT_NAME,
            description: 'Workshop Assets S3 Bucket Name',
        });

        new CfnOutput(this, 'AssetsBucketArnOutput', {
            value: this.bucket.bucketArn,
            exportName: ASSETS_BUCKET_ARN_EXPORT_NAME,
            description: 'Workshop Assets S3 Bucket ARN',
        });

        // CloudFront distribution outputs
        new CfnOutput(this, 'CloudFrontDomainOutput', {
            value: this.distribution.distributionDomainName,
            exportName: 'WorkshopCloudFrontDomain',
            description: 'Workshop CloudFront Distribution Domain Name',
        });

        new CfnOutput(this, 'CloudFrontDistributionIdOutput', {
            value: this.distribution.distributionId,
            exportName: 'WorkshopCloudFrontDistributionId',
            description: 'Workshop CloudFront Distribution ID',
        });

        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map(
                Object.entries({
                    [SSM_PARAMETER_NAMES.S3_BUCKET_NAME]: this.bucket.bucketName,
                    [SSM_PARAMETER_NAMES.IMAGES_CDN_URL]: `https://${this.distribution.distributionDomainName}`,
                }),
            ),
        );
    }

    /**
     * Imports an S3 bucket from CloudFormation exports created by WorkshopAssets
     *
     * This static method reconstructs a bucket instance from CloudFormation exports,
     * allowing other stacks to reference and use the bucket created by the core infrastructure.
     *
     * @param scope - The construct scope where the bucket will be imported
     * @param id - The construct identifier for the imported bucket
     * @returns The imported bucket instance
     *
     * @example
     * ```typescript
     * const bucket = WorkshopAssets.importBucketFromExports(this, 'ImportedBucket');
     * // Use bucket.bucketName, bucket.bucketArn, etc.
     * ```
     */
    public static importBucketFromExports(scope: Construct, id: string): IBucket {
        const bucketName = Fn.importValue(ASSETS_BUCKET_NAME_EXPORT_NAME);
        const bucketArn = Fn.importValue(ASSETS_BUCKET_ARN_EXPORT_NAME);

        return Bucket.fromBucketAttributes(scope, id, {
            bucketName: bucketName,
            bucketArn: bucketArn,
        });
    }
}
