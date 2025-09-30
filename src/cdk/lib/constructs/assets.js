"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopAssets = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const constructs_1 = require("constructs");
const aws_s3_deployment_1 = require("aws-cdk-lib/aws-s3-deployment");
const aws_cloudfront_1 = require("aws-cdk-lib/aws-cloudfront");
const aws_cloudfront_origins_1 = require("aws-cdk-lib/aws-cloudfront-origins");
const cdk_nag_1 = require("cdk-nag");
const utilities_1 = require("../utils/utilities");
const environment_1 = require("../../bin/environment");
const constants_1 = require("../../bin/constants");
/**
 * AWS CDK Construct that creates S3 bucket for pet adoption assets with optional seed data deployment
 * @class Assets
 * @extends Construct
 */
class WorkshopAssets extends constructs_1.Construct {
    /**
     * Creates a new Assets construct with S3 bucket and optional seed data deployment
     * If seedPaths are provided, deploys local assets to the bucket under 'petimages' prefix
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope, id, properties) {
        super(scope, id);
        this.bucket = new aws_s3_1.Bucket(this, 'petadoptionBucket', {
            publicReadAccess: false,
            autoDeleteObjects: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            enforceSSL: true,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.bucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Bucket does not need server access logs',
            },
        ]);
        if (properties?.seedPaths) {
            const sources = properties.seedPaths.map((path) => {
                return aws_s3_deployment_1.Source.asset(path);
            });
            const deployment = new aws_s3_deployment_1.BucketDeployment(this, 'petimagesdeployment', {
                sources: sources,
                destinationBucket: this.bucket,
                retainOnDelete: false,
            });
            cdk_nag_1.NagSuppressions.addResourceSuppressions(deployment.handlerRole, [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS Managed policies is acceptable for the cleanup lambda',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Star resource needed to cleanup the bucket',
                },
            ], true);
            // TODO: Refine the suppression if possible
            cdk_nag_1.NagSuppressions.addStackSuppressions(aws_cdk_lib_1.Stack.of(this), [
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
    createCloudFrontDistribution() {
        // Create Origin Access Identity for secure S3 access
        const originAccessIdentity = new aws_cloudfront_1.OriginAccessIdentity(this, 'AssetsOAI', {
            comment: 'OAI for Pet Store Assets',
        });
        // Grant read permissions to CloudFront
        this.bucket.grantRead(originAccessIdentity);
        // Create CloudFront distribution
        this.distribution = new aws_cloudfront_1.Distribution(this, 'AssetsDistribution', {
            defaultBehavior: {
                origin: aws_cloudfront_origins_1.S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
                    originAccessIdentity: originAccessIdentity,
                }),
                viewerProtocolPolicy: aws_cloudfront_1.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: aws_cloudfront_1.CachePolicy.CACHING_OPTIMIZED,
                compress: true,
            },
            comment: 'Pet Store Assets CDN',
            enableIpv6: true,
            priceClass: aws_cloudfront_1.PriceClass.PRICE_CLASS_ALL,
        });
        // Add CDK-nag suppressions for CloudFront
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.distribution, [
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
    createAssetsOutputs() {
        new aws_cdk_lib_1.CfnOutput(this, 'AssetsBucketNameOutput', {
            value: this.bucket.bucketName,
            exportName: constants_1.ASSETS_BUCKET_NAME_EXPORT_NAME,
            description: 'Workshop Assets S3 Bucket Name',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'AssetsBucketArnOutput', {
            value: this.bucket.bucketArn,
            exportName: constants_1.ASSETS_BUCKET_ARN_EXPORT_NAME,
            description: 'Workshop Assets S3 Bucket ARN',
        });
        // CloudFront distribution outputs
        new aws_cdk_lib_1.CfnOutput(this, 'CloudFrontDomainOutput', {
            value: this.distribution.distributionDomainName,
            exportName: 'WorkshopCloudFrontDomain',
            description: 'Workshop CloudFront Distribution Domain Name',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CloudFrontDistributionIdOutput', {
            value: this.distribution.distributionId,
            exportName: 'WorkshopCloudFrontDistributionId',
            description: 'Workshop CloudFront Distribution ID',
        });
        utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
            [constants_1.SSM_PARAMETER_NAMES.S3_BUCKET_NAME]: this.bucket.bucketName,
            [constants_1.SSM_PARAMETER_NAMES.IMAGES_CDN_URL]: `https://${this.distribution.distributionDomainName}`,
        })));
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
    static importBucketFromExports(scope, id) {
        const bucketName = aws_cdk_lib_1.Fn.importValue(constants_1.ASSETS_BUCKET_NAME_EXPORT_NAME);
        const bucketArn = aws_cdk_lib_1.Fn.importValue(constants_1.ASSETS_BUCKET_ARN_EXPORT_NAME);
        return aws_s3_1.Bucket.fromBucketAttributes(scope, id, {
            bucketName: bucketName,
            bucketArn: bucketArn,
        });
    }
}
exports.WorkshopAssets = WorkshopAssets;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzZXRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXNzZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7RUFHRTtBQUNGLDZDQUFrRTtBQUNsRSwrQ0FBcUQ7QUFDckQsMkNBQXVDO0FBQ3ZDLHFFQUF5RTtBQUN6RSwrREFNb0M7QUFDcEMsK0VBQW9FO0FBQ3BFLHFDQUEwQztBQUMxQyxrREFBK0M7QUFDL0MsdURBQStEO0FBQy9ELG1EQUk2QjtBQWU3Qjs7OztHQUlHO0FBQ0gsTUFBYSxjQUFlLFNBQVEsc0JBQVM7SUFhekM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUE2QjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxlQUFNLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ2hELGdCQUFnQixFQUFFLEtBQUs7WUFDdkIsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1lBQ3BDLFVBQVUsRUFBRSxJQUFJO1NBQ25CLENBQUMsQ0FBQztRQUVILHlCQUFlLENBQUMsdUJBQXVCLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUNqRDtnQkFDSSxFQUFFLEVBQUUsaUJBQWlCO2dCQUNyQixNQUFNLEVBQUUseUNBQXlDO2FBQ3BEO1NBQ0osQ0FBQyxDQUFDO1FBRUgsSUFBSSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7WUFDeEIsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFZLEVBQUUsRUFBRTtnQkFDdEQsT0FBTywwQkFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUM5QixDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sVUFBVSxHQUFHLElBQUksb0NBQWdCLENBQUMsSUFBSSxFQUFFLHFCQUFx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QzFDLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFNBQVMsRUFBRSxTQUFTO1NBQ3ZCLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQXpNRCx3Q0F5TUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbmltcG9ydCB7IFJlbW92YWxQb2xpY3ksIFN0YWNrLCBDZm5PdXRwdXQsIEZuIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQnVja2V0LCBJQnVja2V0IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQnVja2V0RGVwbG95bWVudCwgU291cmNlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0IHtcbiAgICBEaXN0cmlidXRpb24sXG4gICAgT3JpZ2luQWNjZXNzSWRlbnRpdHksXG4gICAgVmlld2VyUHJvdG9jb2xQb2xpY3ksXG4gICAgQ2FjaGVQb2xpY3ksXG4gICAgUHJpY2VDbGFzcyxcbn0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0IHsgUzNCdWNrZXRPcmlnaW4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgVXRpbGl0aWVzIH0gZnJvbSAnLi4vdXRpbHMvdXRpbGl0aWVzJztcbmltcG9ydCB7IFBBUkFNRVRFUl9TVE9SRV9QUkVGSVggfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuaW1wb3J0IHtcbiAgICBBU1NFVFNfQlVDS0VUX05BTUVfRVhQT1JUX05BTUUsXG4gICAgQVNTRVRTX0JVQ0tFVF9BUk5fRVhQT1JUX05BTUUsXG4gICAgU1NNX1BBUkFNRVRFUl9OQU1FUyxcbn0gZnJvbSAnLi4vLi4vYmluL2NvbnN0YW50cyc7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgY29uZmlndXJpbmcgQXNzZXRzIGNvbnN0cnVjdFxuICogQGludGVyZmFjZSBBc3NldHNQcm9wZXJ0aWVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzUHJvcGVydGllcyB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgbG9jYWwgZmlsZSBwYXRocyB0byBkZXBsb3kgdG8gdGhlIFMzIGJ1Y2tldCBhcyBzZWVkIGRhdGFcbiAgICAgKiBGaWxlcyB3aWxsIGJlIGRlcGxveWVkIHRvIHRoZSAncGV0aW1hZ2VzJyBwcmVmaXggaW4gdGhlIGJ1Y2tldFxuICAgICAqIEBvcHRpb25hbFxuICAgICAqL1xuICAgIHNlZWRQYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIEFXUyBDREsgQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBTMyBidWNrZXQgZm9yIHBldCBhZG9wdGlvbiBhc3NldHMgd2l0aCBvcHRpb25hbCBzZWVkIGRhdGEgZGVwbG95bWVudFxuICogQGNsYXNzIEFzc2V0c1xuICogQGV4dGVuZHMgQ29uc3RydWN0XG4gKi9cbmV4cG9ydCBjbGFzcyBXb3Jrc2hvcEFzc2V0cyBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgLyoqXG4gICAgICogVGhlIFMzIGJ1Y2tldCBmb3Igc3RvcmluZyBwZXQgYWRvcHRpb24gYXNzZXRzXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyBidWNrZXQ6IEJ1Y2tldDtcblxuICAgIC8qKlxuICAgICAqIFRoZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBmb3Igc2VydmluZyBwZXQgYWRvcHRpb24gYXNzZXRzXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyBkaXN0cmlidXRpb246IERpc3RyaWJ1dGlvbjtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgQXNzZXRzIGNvbnN0cnVjdCB3aXRoIFMzIGJ1Y2tldCBhbmQgb3B0aW9uYWwgc2VlZCBkYXRhIGRlcGxveW1lbnRcbiAgICAgKiBJZiBzZWVkUGF0aHMgYXJlIHByb3ZpZGVkLCBkZXBsb3lzIGxvY2FsIGFzc2V0cyB0byB0aGUgYnVja2V0IHVuZGVyICdwZXRpbWFnZXMnIHByZWZpeFxuICAgICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0XG4gICAgICogQHBhcmFtIGlkIC0gVGhlIGNvbnN0cnVjdCBJRFxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgY29uc3RydWN0XG4gICAgICovXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllcz86IEFzc2V0c1Byb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgICAgICB0aGlzLmJ1Y2tldCA9IG5ldyBCdWNrZXQodGhpcywgJ3BldGFkb3B0aW9uQnVja2V0Jywge1xuICAgICAgICAgICAgcHVibGljUmVhZEFjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLmJ1Y2tldCwgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxJyxcbiAgICAgICAgICAgICAgICByZWFzb246ICdCdWNrZXQgZG9lcyBub3QgbmVlZCBzZXJ2ZXIgYWNjZXNzIGxvZ3MnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgXSk7XG5cbiAgICAgICAgaWYgKHByb3BlcnRpZXM/LnNlZWRQYXRocykge1xuICAgICAgICAgICAgY29uc3Qgc291cmNlcyA9IHByb3BlcnRpZXMuc2VlZFBhdGhzLm1hcCgocGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFNvdXJjZS5hc3NldChwYXRoKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IEJ1Y2tldERlcGxveW1lbnQodGhpcywgJ3BldGltYWdlc2RlcGxveW1lbnQnLCB7XG4gICAgICAgICAgICAgICAgc291cmNlczogc291cmNlcyxcbiAgICAgICAgICAgICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdGhpcy5idWNrZXQsXG4gICAgICAgICAgICAgICAgcmV0YWluT25EZWxldGU6IGZhbHNlLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50LmhhbmRsZXJSb2xlLFxuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWFzb246ICdBV1MgTWFuYWdlZCBwb2xpY2llcyBpcyBhY2NlcHRhYmxlIGZvciB0aGUgY2xlYW51cCBsYW1iZGEnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ1N0YXIgcmVzb3VyY2UgbmVlZGVkIHRvIGNsZWFudXAgdGhlIGJ1Y2tldCcsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB0cnVlLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gVE9ETzogUmVmaW5lIHRoZSBzdXBwcmVzc2lvbiBpZiBwb3NzaWJsZVxuICAgICAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKFN0YWNrLm9mKHRoaXMpLCBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ1RoZSBjb25zdHJ1Y3QgbWFuYWdlcyB0aGUgbGFtYmRhIHJ1bnRpbWUgdmVyc2lvbicsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnV29ya3Nob3AtQ1dMMicsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0N1c3RvbSByZXNvdXJjZSBmb3IgYnVja2V0IGRlcGxveW1lbnQgaXMgbWFuYWdlZCBieSB0aGUgY29uc3RydWN0JyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gZm9yIG9wdGltaXplZCBpbWFnZSBkZWxpdmVyeVxuICAgICAgICB0aGlzLmNyZWF0ZUNsb3VkRnJvbnREaXN0cmlidXRpb24oKTtcblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRGb3JtYXRpb24gb3V0cHV0cyBmb3IgQXNzZXRzIHJlc291cmNlc1xuICAgICAgICB0aGlzLmNyZWF0ZUFzc2V0c091dHB1dHMoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGZvciBvcHRpbWl6ZWQgYXNzZXQgZGVsaXZlcnlcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUNsb3VkRnJvbnREaXN0cmlidXRpb24oKTogdm9pZCB7XG4gICAgICAgIC8vIENyZWF0ZSBPcmlnaW4gQWNjZXNzIElkZW50aXR5IGZvciBzZWN1cmUgUzMgYWNjZXNzXG4gICAgICAgIGNvbnN0IG9yaWdpbkFjY2Vzc0lkZW50aXR5ID0gbmV3IE9yaWdpbkFjY2Vzc0lkZW50aXR5KHRoaXMsICdBc3NldHNPQUknLCB7XG4gICAgICAgICAgICBjb21tZW50OiAnT0FJIGZvciBQZXQgU3RvcmUgQXNzZXRzJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gR3JhbnQgcmVhZCBwZXJtaXNzaW9ucyB0byBDbG91ZEZyb250XG4gICAgICAgIHRoaXMuYnVja2V0LmdyYW50UmVhZChvcmlnaW5BY2Nlc3NJZGVudGl0eSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uXG4gICAgICAgIHRoaXMuZGlzdHJpYnV0aW9uID0gbmV3IERpc3RyaWJ1dGlvbih0aGlzLCAnQXNzZXRzRGlzdHJpYnV0aW9uJywge1xuICAgICAgICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgICAgICAgICAgb3JpZ2luOiBTM0J1Y2tldE9yaWdpbi53aXRoT3JpZ2luQWNjZXNzSWRlbnRpdHkodGhpcy5idWNrZXQsIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luQWNjZXNzSWRlbnRpdHk6IG9yaWdpbkFjY2Vzc0lkZW50aXR5LFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBWaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICAgICAgICBjYWNoZVBvbGljeTogQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tbWVudDogJ1BldCBTdG9yZSBBc3NldHMgQ0ROJyxcbiAgICAgICAgICAgIGVuYWJsZUlwdjY6IHRydWUsXG4gICAgICAgICAgICBwcmljZUNsYXNzOiBQcmljZUNsYXNzLlBSSUNFX0NMQVNTX0FMTCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIENESy1uYWcgc3VwcHJlc3Npb25zIGZvciBDbG91ZEZyb250XG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLmRpc3RyaWJ1dGlvbiwgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjEnLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGZvciBzdGF0aWMgYXNzZXRzIGRvZXMgbm90IHJlcXVpcmUgZ2VvIHJlc3RyaWN0aW9ucycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjInLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGZvciBzdGF0aWMgYXNzZXRzIGRvZXMgbm90IHJlcXVpcmUgV0FGJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMycsXG4gICAgICAgICAgICAgICAgcmVhc29uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gZm9yIHN0YXRpYyBhc3NldHMgZG9lcyBub3QgcmVxdWlyZSBhY2Nlc3MgbG9ncycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjQnLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ1VzaW5nIGRlZmF1bHQgQ2xvdWRGcm9udCBjZXJ0aWZpY2F0ZSBpbiB0aGUgd29ya3Nob3AgaXMgYWNjZXB0YWJsZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjcnLFxuICAgICAgICAgICAgICAgIHJlYXNvbjogJ1VzaW5nIE9BQyBpbnN0ZWFkIG9mIE9BSSBpcyBhY2NlcHRhYmxlIGZvciB0aGlzIHdvcmtzaG9wJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIF0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgQ2xvdWRGb3JtYXRpb24gb3V0cHV0cyBmb3IgdGhlIFMzIGJ1Y2tldCByZXNvdXJjZXNcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUFzc2V0c091dHB1dHMoKTogdm9pZCB7XG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0Fzc2V0c0J1Y2tldE5hbWVPdXRwdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5idWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IEFTU0VUU19CVUNLRVRfTkFNRV9FWFBPUlRfTkFNRSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV29ya3Nob3AgQXNzZXRzIFMzIEJ1Y2tldCBOYW1lJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQXNzZXRzQnVja2V0QXJuT3V0cHV0Jywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuYnVja2V0LmJ1Y2tldEFybixcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IEFTU0VUU19CVUNLRVRfQVJOX0VYUE9SVF9OQU1FLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdXb3Jrc2hvcCBBc3NldHMgUzMgQnVja2V0IEFSTicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIG91dHB1dHNcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERvbWFpbk91dHB1dCcsIHtcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLmRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogJ1dvcmtzaG9wQ2xvdWRGcm9udERvbWFpbicsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1dvcmtzaG9wIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIERvbWFpbiBOYW1lJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERpc3RyaWJ1dGlvbklkT3V0cHV0Jywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogJ1dvcmtzaG9wQ2xvdWRGcm9udERpc3RyaWJ1dGlvbklkJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV29ya3Nob3AgQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gSUQnLFxuICAgICAgICB9KTtcblxuICAgICAgICBVdGlsaXRpZXMuY3JlYXRlU3NtUGFyYW1ldGVycyhcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICBQQVJBTUVURVJfU1RPUkVfUFJFRklYLFxuICAgICAgICAgICAgbmV3IE1hcChcbiAgICAgICAgICAgICAgICBPYmplY3QuZW50cmllcyh7XG4gICAgICAgICAgICAgICAgICAgIFtTU01fUEFSQU1FVEVSX05BTUVTLlMzX0JVQ0tFVF9OQU1FXTogdGhpcy5idWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgW1NTTV9QQVJBTUVURVJfTkFNRVMuSU1BR0VTX0NETl9VUkxdOiBgaHR0cHM6Ly8ke3RoaXMuZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9YCxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW1wb3J0cyBhbiBTMyBidWNrZXQgZnJvbSBDbG91ZEZvcm1hdGlvbiBleHBvcnRzIGNyZWF0ZWQgYnkgV29ya3Nob3BBc3NldHNcbiAgICAgKlxuICAgICAqIFRoaXMgc3RhdGljIG1ldGhvZCByZWNvbnN0cnVjdHMgYSBidWNrZXQgaW5zdGFuY2UgZnJvbSBDbG91ZEZvcm1hdGlvbiBleHBvcnRzLFxuICAgICAqIGFsbG93aW5nIG90aGVyIHN0YWNrcyB0byByZWZlcmVuY2UgYW5kIHVzZSB0aGUgYnVja2V0IGNyZWF0ZWQgYnkgdGhlIGNvcmUgaW5mcmFzdHJ1Y3R1cmUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgY29uc3RydWN0IHNjb3BlIHdoZXJlIHRoZSBidWNrZXQgd2lsbCBiZSBpbXBvcnRlZFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBjb25zdHJ1Y3QgaWRlbnRpZmllciBmb3IgdGhlIGltcG9ydGVkIGJ1Y2tldFxuICAgICAqIEByZXR1cm5zIFRoZSBpbXBvcnRlZCBidWNrZXQgaW5zdGFuY2VcbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGNvbnN0IGJ1Y2tldCA9IFdvcmtzaG9wQXNzZXRzLmltcG9ydEJ1Y2tldEZyb21FeHBvcnRzKHRoaXMsICdJbXBvcnRlZEJ1Y2tldCcpO1xuICAgICAqIC8vIFVzZSBidWNrZXQuYnVja2V0TmFtZSwgYnVja2V0LmJ1Y2tldEFybiwgZXRjLlxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBzdGF0aWMgaW1wb3J0QnVja2V0RnJvbUV4cG9ydHMoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZyk6IElCdWNrZXQge1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gRm4uaW1wb3J0VmFsdWUoQVNTRVRTX0JVQ0tFVF9OQU1FX0VYUE9SVF9OQU1FKTtcbiAgICAgICAgY29uc3QgYnVja2V0QXJuID0gRm4uaW1wb3J0VmFsdWUoQVNTRVRTX0JVQ0tFVF9BUk5fRVhQT1JUX05BTUUpO1xuXG4gICAgICAgIHJldHVybiBCdWNrZXQuZnJvbUJ1Y2tldEF0dHJpYnV0ZXMoc2NvcGUsIGlkLCB7XG4gICAgICAgICAgICBidWNrZXROYW1lOiBidWNrZXROYW1lLFxuICAgICAgICAgICAgYnVja2V0QXJuOiBidWNrZXRBcm4sXG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==