import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
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
export declare class WorkshopAssets extends Construct {
    /**
     * The S3 bucket for storing pet adoption assets
     * @public
     */
    bucket: Bucket;
    /**
     * The CloudFront distribution for serving pet adoption assets
     * @public
     */
    distribution: Distribution;
    /**
     * Creates a new Assets construct with S3 bucket and optional seed data deployment
     * If seedPaths are provided, deploys local assets to the bucket under 'petimages' prefix
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: AssetsProperties);
    /**
     * Creates CloudFront distribution for optimized asset delivery
     */
    private createCloudFrontDistribution;
    /**
     * Creates CloudFormation outputs for the S3 bucket resources
     */
    private createAssetsOutputs;
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
    static importBucketFromExports(scope: Construct, id: string): IBucket;
}
