#!/usr/bin/env ts-node
"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAGS = void 0;
/**
 * AWS Resource Cleanup Script for One Observability Workshop
 *
 * This script identifies and deletes AWS resources that are tagged with the workshop tags
 * but may not have been properly cleaned up when stacks were deleted.
 *
 * Usage:
 *   npm run cleanup -- --stack-name <STACK_NAME>
 *   npm run cleanup -- --discover
 *   npm run cleanup -- --stack-name <STACK_NAME> --dry-run
 */
const client_cloudwatch_logs_1 = require("@aws-sdk/client-cloudwatch-logs");
const client_ec2_1 = require("@aws-sdk/client-ec2");
const client_rds_1 = require("@aws-sdk/client-rds");
const client_ecs_1 = require("@aws-sdk/client-ecs");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_resource_groups_tagging_api_1 = require("@aws-sdk/client-resource-groups-tagging-api");
const throttle_backoff_1 = require("./utils/throttle-backoff");
exports.TAGS = {
    environment: 'non-prod',
    application: 'One Observability Workshop',
    stackName: process.env.STACK_NAME || 'MissingStackName',
};
class WorkshopResourceCleanup {
    constructor(region = process.env.AWS_REGION || 'us-east-1') {
        this.WORKSHOP_TAGS = exports.TAGS;
        const clientConfig = { region };
        this.region = region;
        this.cloudWatchLogs = new client_cloudwatch_logs_1.CloudWatchLogsClient(clientConfig);
        this.ec2 = new client_ec2_1.EC2Client(clientConfig);
        this.rds = new client_rds_1.RDSClient(clientConfig);
        this.ecs = new client_ecs_1.ECSClient(clientConfig);
        this.s3 = new client_s3_1.S3Client(clientConfig);
        this.resourceGroupsTagging = new client_resource_groups_tagging_api_1.ResourceGroupsTaggingAPIClient(clientConfig);
    }
    /**
     * Get AWS account and region information
     */
    async getAwsAccountInfo() {
        try {
            // Try to get account ID from any AWS resource ARN
            const command = new client_resource_groups_tagging_api_1.GetResourcesCommand({
                ResourcesPerPage: 1,
            });
            const response = await (0, throttle_backoff_1.throttlingBackOff)(() => this.resourceGroupsTagging.send(command));
            let accountId;
            if (response.ResourceTagMappingList && response.ResourceTagMappingList.length > 0) {
                const arn = response.ResourceTagMappingList[0].ResourceARN;
                if (arn) {
                    // Extract account ID from ARN (format: arn:aws:service:region:account-id:resource)
                    const arnParts = arn.split(':');
                    if (arnParts.length >= 5) {
                        accountId = arnParts[4];
                    }
                }
            }
            return {
                accountId,
                region: this.region,
            };
        }
        catch {
            return {
                accountId: undefined,
                region: this.region,
            };
        }
    }
    /**
     * Discover all unique stack names from resources with workshop tags
     */
    async discoverStackNames() {
        console.log('🔍 Discovering stack names from existing resources...\n');
        const stackNames = new Set();
        try {
            // First, try to find resources with both environment AND application tags
            console.log('   Searching for resources with both environment and application tags...');
            await this.searchResourcesWithTags([
                {
                    Key: 'environment',
                    Values: [this.WORKSHOP_TAGS.environment],
                },
                {
                    Key: 'application',
                    Values: [this.WORKSHOP_TAGS.application],
                },
            ], stackNames);
            // If no stack names found, fallback to searching by application tag only
            if (stackNames.size === 0) {
                console.log('   No resources found with both tags. Falling back to application tag only...');
                await this.searchResourcesWithTags([
                    {
                        Key: 'application',
                        Values: [this.WORKSHOP_TAGS.application],
                    },
                ], stackNames);
            }
            if (stackNames.size === 0) {
                console.log('   No workshop resources found with required tags.');
            }
            else {
                console.log(`   Found ${stackNames.size} unique stack name(s).`);
            }
        }
        catch (error) {
            console.error('❌ Error discovering stack names:', error);
        }
        return [...stackNames].sort();
    }
    /**
     * Helper method to search for resources with given tag filters
     */
    async searchResourcesWithTags(tagFilters, stackNames) {
        let nextToken;
        do {
            const commandWithToken = new client_resource_groups_tagging_api_1.GetResourcesCommand({
                TagFilters: tagFilters,
                ...(nextToken && { PaginationToken: nextToken }),
            });
            const response = await (0, throttle_backoff_1.throttlingBackOff)(() => this.resourceGroupsTagging.send(commandWithToken));
            if (response.ResourceTagMappingList) {
                for (const resource of response.ResourceTagMappingList) {
                    // First try to find explicit stackName tag
                    const stackNameTag = resource.Tags?.find((tag) => tag.Key === 'stackName');
                    if (stackNameTag?.Value && stackNameTag.Value !== 'MissingStackName') {
                        stackNames.add(stackNameTag.Value);
                    }
                    else {
                        // Fallback: Extract stack name from resource ARN patterns
                        const extractedStackName = this.extractStackNameFromArn(resource.ResourceARN || '');
                        if (extractedStackName) {
                            stackNames.add(extractedStackName);
                        }
                    }
                }
            }
            nextToken = response.PaginationToken;
        } while (nextToken);
    }
    /**
     * Extract stack name from ARN when stackName tag is missing
     */
    extractStackNameFromArn(arn) {
        if (!arn)
            return undefined;
        // Common patterns in One Observability Workshop ARNs:
        // arn:aws:ecs:region:account:task-definition/DevMicroservicesStacktrafficgeneratortaskDefinition5F5740DD:3
        // arn:aws:ecs:region:account:task-definition/OneObservabilityMicroservicesMicroservicepetfoodrstaskDefinition693030E6:1
        const patterns = [
            // ECS Task Definition pattern: extract stack name from task definition name
            /task-definition\/([^:\/]+)/,
            // Lambda function pattern: extract from function name
            /function:([^:]+)/,
            // CloudWatch log group pattern: extract from log group name
            /log-group:([^:]+)/,
            // S3 bucket pattern: extract from bucket name
            /:::([^\/]+)/,
            // EBS volume/snapshot pattern: extract from tags or name
            /volume\/(.+)|snapshot\/(.+)/,
            // RDS pattern: extract from DB identifier
            /db:([^:]+)|cluster:([^:]+)/,
        ];
        for (const pattern of patterns) {
            const match = arn.match(pattern);
            if (match) {
                const resourceName = match[1] || match[2] || match[3];
                if (resourceName) {
                    // Extract potential stack name from resource name
                    // Look for common stack name patterns
                    const stackPatterns = [
                        // Match patterns like "DevMicroservicesStack", "OneObservabilityMicroservices", etc.
                        /^(Dev\w*Stack|OneObservability\w*)/,
                        // Match patterns ending with "Stack"
                        /^(\w*Stack)/,
                        // Match CDK-style stack names
                        /^([A-Z][a-zA-Z0-9]*Stack)/,
                    ];
                    for (const stackPattern of stackPatterns) {
                        const stackMatch = resourceName.match(stackPattern);
                        if (stackMatch) {
                            return stackMatch[1];
                        }
                    }
                    // If no stack pattern found, try to extract meaningful prefix
                    if (resourceName.includes('Dev') || resourceName.includes('OneObservability')) {
                        // For names like "DevMicroservicesStacktrafficgenerator"
                        const prefixMatch = resourceName.match(/^(Dev\w*|OneObservability\w*)/);
                        if (prefixMatch) {
                            return prefixMatch[1];
                        }
                    }
                }
            }
        }
        return undefined;
    }
    /**
     * Get workshop resources using Resource Groups API
     */
    async getWorkshopResources(resourceType, stackName, checkMode = 'exact') {
        const resources = [];
        let nextToken;
        try {
            const tagFilters = [];
            switch (checkMode) {
                case 'exact': {
                    tagFilters.push({ Key: 'environment', Values: [this.WORKSHOP_TAGS.environment] }, { Key: 'application', Values: [this.WORKSHOP_TAGS.application] });
                    if (stackName) {
                        tagFilters.push({ Key: 'stackName', Values: [stackName] });
                    }
                    break;
                }
                case 'missing-stackname': {
                    tagFilters.push({ Key: 'environment', Values: [this.WORKSHOP_TAGS.environment] }, { Key: 'application', Values: [this.WORKSHOP_TAGS.application] });
                    // Note: We'll filter out resources WITH stackName after getting results
                    break;
                }
                case 'application-only': {
                    tagFilters.push({ Key: 'application', Values: [this.WORKSHOP_TAGS.application] });
                    break;
                }
            }
            do {
                const command = new client_resource_groups_tagging_api_1.GetResourcesCommand({
                    ResourceTypeFilters: [resourceType],
                    TagFilters: tagFilters,
                    ...(nextToken && { PaginationToken: nextToken }),
                });
                const response = await (0, throttle_backoff_1.throttlingBackOff)(() => this.resourceGroupsTagging.send(command));
                if (response.ResourceTagMappingList) {
                    for (const resource of response.ResourceTagMappingList) {
                        if (!resource.ResourceARN)
                            continue;
                        // For missing-stackname mode, filter out resources that have valid stackName
                        if (checkMode === 'missing-stackname') {
                            const stackNameTag = resource.Tags?.find((tag) => tag.Key === 'stackName');
                            if (stackNameTag?.Value && stackNameTag.Value !== 'MissingStackName') {
                                continue; // Skip resources with valid stackName
                            }
                        }
                        resources.push(resource.ResourceARN);
                    }
                }
                nextToken = response.PaginationToken;
            } while (nextToken);
        }
        catch (error) {
            console.error(`❌ Error getting workshop resources for ${resourceType}:`, error);
        }
        return resources;
    }
    /**
     * Extract resource identifier from ARN based on resource type
     */
    extractResourceId(arn, resourceType) {
        const parts = arn.split(':');
        switch (resourceType) {
            case 'logs:log-group': {
                // arn:aws:logs:region:account:log-group:NAME:*
                return parts.length >= 6 ? parts.slice(6).join(':').replace(/:\*$/, '') : undefined;
            }
            case 'ec2:volume':
            case 'ec2:snapshot': {
                // arn:aws:ec2:region:account:volume/vol-xxx or snapshot/snap-xxx
                return parts.length >= 6 ? parts[5].split('/')[1] : undefined;
            }
            case 'rds:db-snapshot':
            case 'rds:cluster-snapshot': {
                // arn:aws:rds:region:account:snapshot:name or cluster-snapshot:name
                return parts.length >= 6 ? parts[6] : undefined;
            }
            case 'ecs:task-definition': {
                // arn:aws:ecs:region:account:task-definition/family:revision
                return parts.length >= 6 ? parts[5].split('/')[1] : undefined;
            }
            case 's3:bucket': {
                // arn:aws:s3:::bucket-name
                return parts.length >= 6 ? parts[5] : undefined;
            }
            default: {
                return undefined;
            }
        }
    }
    /**
     * Check if resource has matching workshop tags (legacy method for compatibility)
     */
    hasWorkshopTags(tags, stackName, checkMode = 'exact') {
        const tagMap = new Map(tags.map((tag) => [tag.Key || tag.key, tag.Value || tag.value]));
        const hasRequiredTags = tagMap.get('environment') === this.WORKSHOP_TAGS.environment &&
            tagMap.get('application') === this.WORKSHOP_TAGS.application;
        const hasApplicationTag = tagMap.get('application') === this.WORKSHOP_TAGS.application;
        const hasStackNameTag = tagMap.has('stackName') && tagMap.get('stackName') !== 'MissingStackName';
        switch (checkMode) {
            case 'exact': {
                if (stackName) {
                    return hasRequiredTags && tagMap.get('stackName') === stackName;
                }
                return hasRequiredTags;
            }
            case 'missing-stackname': {
                // Resources that have workshop tags but missing valid stackName
                return hasRequiredTags && !hasStackNameTag;
            }
            case 'application-only': {
                // Resources that have application tag (fallback mode)
                return hasApplicationTag;
            }
            default: {
                return hasRequiredTags;
            }
        }
    }
    /**
     * Check for resources with missing stackName tags
     */
    async checkForResourcesWithMissingStackName() {
        console.log('🔍 Checking for resources with missing stackName tags...\n');
        const resourceTypes = [];
        let totalCount = 0;
        try {
            // Check CloudWatch Logs
            process.stdout.write('   📋 Checking CloudWatch Log Groups...');
            const cwCount = await this.countResourcesWithMissingStackName('logs:log-group');
            console.log(` found ${cwCount}`);
            if (cwCount > 0) {
                resourceTypes.push(`CloudWatch Log Groups (${cwCount})`);
                totalCount += cwCount;
            }
            // Check EBS Volumes
            process.stdout.write('   💾 Checking EBS Volumes...');
            const ebsVolCount = await this.countResourcesWithMissingStackName('ec2:volume');
            console.log(` found ${ebsVolCount}`);
            if (ebsVolCount > 0) {
                resourceTypes.push(`EBS Volumes (${ebsVolCount})`);
                totalCount += ebsVolCount;
            }
            // Check EBS Snapshots
            process.stdout.write('   📸 Checking EBS Snapshots...');
            const ebsSnapCount = await this.countResourcesWithMissingStackName('ec2:snapshot');
            console.log(` found ${ebsSnapCount}`);
            if (ebsSnapCount > 0) {
                resourceTypes.push(`EBS Snapshots (${ebsSnapCount})`);
                totalCount += ebsSnapCount;
            }
            // Check RDS Backups (DB snapshots)
            process.stdout.write('   🗄️ Checking RDS Backups...');
            const rdsDatabaseCount = await this.countResourcesWithMissingStackName('rds:db-snapshot');
            const rdsClusterCount = await this.countResourcesWithMissingStackName('rds:cluster-snapshot');
            const rdsCount = rdsDatabaseCount + rdsClusterCount;
            console.log(` found ${rdsCount}`);
            if (rdsCount > 0) {
                resourceTypes.push(`RDS Backups (${rdsCount})`);
                totalCount += rdsCount;
            }
            // Check ECS Task Definitions
            process.stdout.write('   📋 Checking ECS Task Definitions...');
            const ecsCount = await this.countResourcesWithMissingStackName('ecs:task-definition');
            console.log(` found ${ecsCount}`);
            if (ecsCount > 0) {
                resourceTypes.push(`ECS Task Definitions (${ecsCount})`);
                totalCount += ecsCount;
            }
            // Check S3 Buckets
            process.stdout.write('   🪣 Checking S3 Buckets...');
            const s3Count = await this.countResourcesWithMissingStackName('s3:bucket');
            console.log(` found ${s3Count}`);
            if (s3Count > 0) {
                resourceTypes.push(`S3 Buckets (${s3Count})`);
                totalCount += s3Count;
            }
            console.log(); // Add blank line after progress indicators
            return {
                hasResources: totalCount > 0,
                count: totalCount,
                resourceTypes,
            };
        }
        catch (error) {
            console.error('❌ Error checking for resources:', error);
            return { hasResources: false, count: 0, resourceTypes: [] };
        }
    }
    /**
     * Count resources with missing stackName tag using Resource Groups API
     */
    async countResourcesWithMissingStackName(resourceType) {
        const resources = await this.getWorkshopResources(resourceType, undefined, 'missing-stackname');
        return resources.length;
    }
    /**
     * Clean up CloudWatch Log Groups
     */
    async cleanupCloudWatchLogs(stackName, dryRun) {
        console.log('🗂️  Cleaning up CloudWatch Log Groups...');
        let deletedCount = 0;
        const resourceType = 'logs:log-group';
        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);
            for (const resourceArn of resources) {
                const logGroupName = this.extractResourceId(resourceArn, resourceType);
                if (!logGroupName) {
                    console.log(`   ⚠️ Could not extract log group name from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete log group: ${logGroupName}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.cloudWatchLogs.send(new client_cloudwatch_logs_1.DeleteLogGroupCommand({ logGroupName })));
                        console.log(`   ✅ Deleted log group: ${logGroupName}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete log group ${logGroupName}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up CloudWatch logs:', error);
        }
        return deletedCount;
    }
    /**
     * Clean up EBS Volumes
     */
    async cleanupEBSVolumes(stackName, dryRun) {
        console.log('💾 Cleaning up EBS Volumes...');
        let deletedCount = 0;
        const resourceType = 'ec2:volume';
        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);
            for (const resourceArn of resources) {
                const volumeId = this.extractResourceId(resourceArn, resourceType);
                if (!volumeId) {
                    console.log(`   ⚠️ Could not extract volume ID from ARN: ${resourceArn}`);
                    continue;
                }
                // Check if volume exists and is available (not attached)
                try {
                    const describeCommand = new client_ec2_1.DescribeVolumesCommand({ VolumeIds: [volumeId] });
                    const describeResponse = await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(describeCommand));
                    const volume = describeResponse.Volumes?.[0];
                    if (!volume) {
                        console.log(`   ⚠️ Volume ${volumeId} not found in describe response, skipping`);
                        continue;
                    }
                    if (volume.State !== 'available') {
                        console.log(`   ⚠️ Skipping volume ${volumeId} because it is in ${volume.State} state`);
                        continue;
                    }
                }
                catch (error) {
                    const errorObject = error;
                    if (errorObject.name === 'InvalidVolume.NotFound' ||
                        errorObject.Code === 'InvalidVolume.NotFound') {
                        console.log(`   ⚠️ Volume ${volumeId} no longer exists, skipping`);
                        continue;
                    }
                    console.error(`   ❌ Error checking volume ${volumeId}: ${errorObject.message || String(error)}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS volume: ${volumeId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(new client_ec2_1.DeleteVolumeCommand({ VolumeId: volumeId })));
                        console.log(`   ✅ Deleted EBS volume: ${volumeId}`);
                    }
                    catch (error) {
                        const errorObject = error;
                        if (errorObject.name === 'InvalidVolume.NotFound' ||
                            errorObject.Code === 'InvalidVolume.NotFound') {
                            console.log(`   ⚠️ Volume ${volumeId} was already deleted, continuing`);
                        }
                        else {
                            console.error(`   ❌ Failed to delete volume ${volumeId}: ${errorObject.message || String(error)}`);
                        }
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up EBS volumes:', error);
        }
        return deletedCount;
    }
    /**
     * Clean up EBS Snapshots
     */
    async cleanupEBSSnapshots(stackName, dryRun) {
        console.log('📸 Cleaning up EBS Snapshots...');
        let deletedCount = 0;
        const resourceType = 'ec2:snapshot';
        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);
            for (const resourceArn of resources) {
                const snapshotId = this.extractResourceId(resourceArn, resourceType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(new client_ec2_1.DeleteSnapshotCommand({ SnapshotId: snapshotId })));
                        console.log(`   ✅ Deleted EBS snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up EBS snapshots:', error);
        }
        return deletedCount;
    }
    /**
     * Clean up RDS Backups (DB Snapshots and Cluster Snapshots)
     */
    async cleanupRDSBackups(stackName, dryRun) {
        console.log('🗄️  Cleaning up RDS Backups...');
        let deletedCount = 0;
        try {
            // Clean up DB snapshots
            const databaseSnapshotType = 'rds:db-snapshot';
            const databaseSnapshots = await this.getWorkshopResources(databaseSnapshotType, stackName);
            for (const resourceArn of databaseSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, databaseSnapshotType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract DB snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.rds.send(new client_rds_1.DeleteDBSnapshotCommand({ DBSnapshotIdentifier: snapshotId })));
                        console.log(`   ✅ Deleted DB snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete DB snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
            // Clean up DB cluster snapshots
            const clusterSnapshotType = 'rds:cluster-snapshot';
            const clusterSnapshots = await this.getWorkshopResources(clusterSnapshotType, stackName);
            for (const resourceArn of clusterSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, clusterSnapshotType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract cluster snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB cluster snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.rds.send(new client_rds_1.DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: snapshotId })));
                        console.log(`   ✅ Deleted DB cluster snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete cluster snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up RDS backups:', error);
        }
        return deletedCount;
    }
    /**
     * Clean up ECS Task Definitions
     */
    async cleanupECSTaskDefinitions(stackName, dryRun) {
        console.log('📋 Cleaning up ECS Task Definitions...');
        let deletedCount = 0;
        const resourceType = 'ecs:task-definition';
        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);
            for (const resourceArn of resources) {
                const taskDefinition = resourceArn; // For task definitions, we use the full ARN
                if (dryRun) {
                    console.log(`   [DRY RUN] Would deregister task definition: ${taskDefinition}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ecs.send(new client_ecs_1.DeregisterTaskDefinitionCommand({ taskDefinition })));
                        console.log(`   ✅ Deregistered task definition: ${taskDefinition}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to deregister task definition ${taskDefinition}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up ECS task definitions:', error);
        }
        return deletedCount;
    }
    /**
     * Clean up S3 Buckets (with emptying)
     */
    async cleanupS3Buckets(stackName, dryRun) {
        console.log('🪣 Cleaning up S3 Buckets...');
        let deletedCount = 0;
        const resourceType = 's3:bucket';
        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);
            for (const resourceArn of resources) {
                const bucketName = this.extractResourceId(resourceArn, resourceType);
                if (!bucketName) {
                    console.log(`   ⚠️ Could not extract bucket name from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would empty and delete S3 bucket: ${bucketName}`);
                }
                else {
                    try {
                        // First empty the bucket
                        await this.emptyS3Bucket(bucketName);
                        // Then delete the bucket
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.s3.send(new client_s3_1.DeleteBucketCommand({ Bucket: bucketName })));
                        console.log(`   ✅ Deleted S3 bucket: ${bucketName}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                deletedCount++;
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up S3 buckets:', error);
        }
        return deletedCount;
    }
    /**
     * Empty S3 bucket by deleting all objects and versions
     */
    async emptyS3Bucket(bucketName) {
        console.log(`   🗂️  Emptying S3 bucket: ${bucketName}`);
        try {
            let isTruncated = true;
            let keyMarker;
            let versionIdMarker;
            while (isTruncated) {
                const listCommand = new client_s3_1.ListObjectVersionsCommand({
                    Bucket: bucketName,
                    KeyMarker: keyMarker,
                    VersionIdMarker: versionIdMarker,
                    MaxKeys: 1000,
                });
                const listResponse = await (0, throttle_backoff_1.throttlingBackOff)(() => this.s3.send(listCommand));
                const objects = [];
                // Add current versions
                if (listResponse.Versions) {
                    objects.push(...listResponse.Versions.map((version) => ({
                        Key: version.Key,
                        VersionId: version.VersionId,
                    })));
                }
                // Add delete markers
                if (listResponse.DeleteMarkers) {
                    objects.push(...listResponse.DeleteMarkers.map((marker) => ({
                        Key: marker.Key,
                        VersionId: marker.VersionId,
                    })));
                }
                // Delete objects in batches
                if (objects.length > 0) {
                    const deleteCommand = new client_s3_1.DeleteObjectsCommand({
                        Bucket: bucketName,
                        Delete: {
                            Objects: objects,
                            Quiet: true,
                        },
                    });
                    await (0, throttle_backoff_1.throttlingBackOff)(() => this.s3.send(deleteCommand));
                    console.log(`     Deleted ${objects.length} objects`);
                }
                isTruncated = listResponse.IsTruncated || false;
                keyMarker = listResponse.NextKeyMarker;
                versionIdMarker = listResponse.NextVersionIdMarker;
            }
        }
        catch (error) {
            console.error(`   ❌ Failed to empty bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Run complete cleanup for a specific stack
     */
    async cleanupStack(stackName, dryRun = false) {
        console.log(`\n🧹 ${dryRun ? '[DRY RUN] ' : ''}Cleaning up resources for stack: ${stackName}\n`);
        const counts = {
            cloudwatchLogs: 0,
            ebsVolumes: 0,
            ebsSnapshots: 0,
            rdsBackups: 0,
            ecsTaskDefinitions: 0,
            s3Buckets: 0,
        };
        // Clean up resources in parallel for better performance
        const cleanupPromises = [
            this.cleanupCloudWatchLogs(stackName, dryRun),
            this.cleanupEBSVolumes(stackName, dryRun),
            this.cleanupEBSSnapshots(stackName, dryRun),
            this.cleanupRDSBackups(stackName, dryRun),
            this.cleanupECSTaskDefinitions(stackName, dryRun),
            this.cleanupS3Buckets(stackName, dryRun),
        ];
        try {
            const results = await Promise.all(cleanupPromises);
            counts.cloudwatchLogs = results[0];
            counts.ebsVolumes = results[1];
            counts.ebsSnapshots = results[2];
            counts.rdsBackups = results[3];
            counts.ecsTaskDefinitions = results[4];
            counts.s3Buckets = results[5];
        }
        catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
        return counts;
    }
    /**
     * Run cleanup for resources without stackName tag
     */
    async cleanupResourcesWithoutStackNameTag(dryRun = false) {
        console.log(`\n🧹 ${dryRun ? '[DRY RUN] ' : ''}Cleaning up resources without valid stackName tags\n`);
        const counts = {
            cloudwatchLogs: 0,
            ebsVolumes: 0,
            ebsSnapshots: 0,
            rdsBackups: 0,
            ecsTaskDefinitions: 0,
            s3Buckets: 0,
        };
        try {
            // Clean up CloudWatch Logs without stackName
            console.log('🗂️  Cleaning up CloudWatch Log Groups without stackName...');
            const resourceType = 'logs:log-group';
            const logGroups = await this.getWorkshopResources(resourceType, undefined, 'missing-stackname');
            for (const resourceArn of logGroups) {
                const logGroupName = this.extractResourceId(resourceArn, resourceType);
                if (!logGroupName) {
                    console.log(`   ⚠️ Could not extract log group name from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete log group: ${logGroupName}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.cloudWatchLogs.send(new client_cloudwatch_logs_1.DeleteLogGroupCommand({ logGroupName })));
                        console.log(`   ✅ Deleted log group: ${logGroupName}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete log group ${logGroupName}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.cloudwatchLogs++;
            }
            // Clean up EBS Volumes without stackName
            console.log('💾 Cleaning up EBS Volumes without stackName...');
            const volumeType = 'ec2:volume';
            const volumes = await this.getWorkshopResources(volumeType, undefined, 'missing-stackname');
            for (const resourceArn of volumes) {
                const volumeId = this.extractResourceId(resourceArn, volumeType);
                if (!volumeId) {
                    console.log(`   ⚠️ Could not extract volume ID from ARN: ${resourceArn}`);
                    continue;
                }
                // Check if volume exists and is available (not attached)
                try {
                    const describeCommand = new client_ec2_1.DescribeVolumesCommand({ VolumeIds: [volumeId] });
                    const describeResponse = await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(describeCommand));
                    const volume = describeResponse.Volumes?.[0];
                    if (!volume) {
                        console.log(`   ⚠️ Volume ${volumeId} not found in describe response, skipping`);
                        continue;
                    }
                    if (volume.State !== 'available') {
                        console.log(`   ⚠️ Skipping volume ${volumeId} because it is in ${volume.State} state`);
                        continue;
                    }
                }
                catch (error) {
                    const errorObject = error;
                    if (errorObject.name === 'InvalidVolume.NotFound' ||
                        errorObject.Code === 'InvalidVolume.NotFound') {
                        console.log(`   ⚠️ Volume ${volumeId} no longer exists, skipping`);
                        continue;
                    }
                    console.error(`   ❌ Error checking volume ${volumeId}: ${errorObject.message || String(error)}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS volume: ${volumeId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(new client_ec2_1.DeleteVolumeCommand({ VolumeId: volumeId })));
                        console.log(`   ✅ Deleted EBS volume: ${volumeId}`);
                    }
                    catch (error) {
                        const errorObject = error;
                        if (errorObject.name === 'InvalidVolume.NotFound' ||
                            errorObject.Code === 'InvalidVolume.NotFound') {
                            console.log(`   ⚠️ Volume ${volumeId} was already deleted, continuing`);
                        }
                        else {
                            console.error(`   ❌ Failed to delete volume ${volumeId}: ${errorObject.message || String(error)}`);
                        }
                        continue;
                    }
                }
                counts.ebsVolumes++;
            }
            // Clean up EBS Snapshots without stackName
            console.log('📸 Cleaning up EBS Snapshots without stackName...');
            const snapshotType = 'ec2:snapshot';
            const snapshots = await this.getWorkshopResources(snapshotType, undefined, 'missing-stackname');
            for (const resourceArn of snapshots) {
                const snapshotId = this.extractResourceId(resourceArn, snapshotType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ec2.send(new client_ec2_1.DeleteSnapshotCommand({ SnapshotId: snapshotId })));
                        console.log(`   ✅ Deleted EBS snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.ebsSnapshots++;
            }
            // Clean up RDS Backups without stackName
            console.log('🗄️  Cleaning up RDS Backups without stackName...');
            // Clean up DB snapshots
            const databaseSnapshotType = 'rds:db-snapshot';
            const databaseSnapshots = await this.getWorkshopResources(databaseSnapshotType, undefined, 'missing-stackname');
            for (const resourceArn of databaseSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, databaseSnapshotType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract DB snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.rds.send(new client_rds_1.DeleteDBSnapshotCommand({ DBSnapshotIdentifier: snapshotId })));
                        console.log(`   ✅ Deleted DB snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete DB snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.rdsBackups++;
            }
            // Clean up DB cluster snapshots
            const clusterSnapshotType = 'rds:cluster-snapshot';
            const clusterSnapshots = await this.getWorkshopResources(clusterSnapshotType, undefined, 'missing-stackname');
            for (const resourceArn of clusterSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, clusterSnapshotType);
                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract cluster snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB cluster snapshot: ${snapshotId}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.rds.send(new client_rds_1.DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: snapshotId })));
                        console.log(`   ✅ Deleted DB cluster snapshot: ${snapshotId}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete cluster snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.rdsBackups++;
            }
            // Clean up ECS Task Definitions without stackName
            console.log('📋 Cleaning up ECS Task Definitions without stackName...');
            const taskDefinitionType = 'ecs:task-definition';
            const taskDefinitions = await this.getWorkshopResources(taskDefinitionType, undefined, 'missing-stackname');
            for (const resourceArn of taskDefinitions) {
                const taskDefinition = resourceArn; // For task definitions, we use the full ARN
                if (dryRun) {
                    console.log(`   [DRY RUN] Would deregister task definition: ${taskDefinition}`);
                }
                else {
                    try {
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.ecs.send(new client_ecs_1.DeregisterTaskDefinitionCommand({ taskDefinition })));
                        console.log(`   ✅ Deregistered task definition: ${taskDefinition}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to deregister task definition ${taskDefinition}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.ecsTaskDefinitions++;
            }
            // Clean up S3 Buckets without stackName
            console.log('🪣 Cleaning up S3 Buckets without stackName...');
            const bucketType = 's3:bucket';
            const buckets = await this.getWorkshopResources(bucketType, undefined, 'missing-stackname');
            for (const resourceArn of buckets) {
                const bucketName = this.extractResourceId(resourceArn, bucketType);
                if (!bucketName) {
                    console.log(`   ⚠️ Could not extract bucket name from ARN: ${resourceArn}`);
                    continue;
                }
                if (dryRun) {
                    console.log(`   [DRY RUN] Would empty and delete S3 bucket: ${bucketName}`);
                }
                else {
                    try {
                        // First empty the bucket
                        await this.emptyS3Bucket(bucketName);
                        // Then delete the bucket
                        await (0, throttle_backoff_1.throttlingBackOff)(() => this.s3.send(new client_s3_1.DeleteBucketCommand({ Bucket: bucketName })));
                        console.log(`   ✅ Deleted S3 bucket: ${bucketName}`);
                    }
                    catch (error) {
                        console.error(`   ❌ Failed to delete bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                counts.s3Buckets++;
            }
            return counts;
        }
        catch (error) {
            console.error('❌ Error during cleanup of resources without stackName:', error);
            return counts;
        }
    }
}
/**
 * Parse command line arguments
 */
function parseArguments() {
    const arguments_ = process.argv.slice(2);
    const options = {
        discover: false,
        dryRun: false,
    };
    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index];
        switch (argument) {
            case '--stack-name': {
                options.stackName = arguments_[++index];
                break;
            }
            case '--discover': {
                options.discover = true;
                break;
            }
            case '--dry-run': {
                options.dryRun = true;
                break;
            }
            case '--region': {
                options.region = arguments_[++index];
                break;
            }
            case '--skip-confirmation': {
                options.skipConfirmation = true;
                break;
            }
            case '--cleanup-missing-tags': {
                options.cleanupMissingTags = true;
                break;
            }
            case '--help': {
                showHelp();
                process.exit(0);
                break;
            }
            default: {
                if (argument.startsWith('--')) {
                    console.error(`❌ Unknown option: ${argument}`);
                    showHelp();
                    process.exit(1);
                }
            }
        }
    }
    return options;
}
/**
 * Show help message
 */
function showHelp() {
    console.log(`
🧹 AWS Resource Cleanup Script for One Observability Workshop

USAGE:
    npm run cleanup -- [OPTIONS]

OPTIONS:
    --stack-name <name>       Specific stack name to clean up
    --discover                List all found workshop stack names
    --dry-run                 Preview what would be deleted (recommended)
    --region <region>         AWS region (default: us-east-1 or AWS_REGION)
    --cleanup-missing-tags    Clean up resources without valid stackName tags
    --skip-confirmation       Skip confirmation prompts (use with caution)
    --help                    Show this help message

EXAMPLES:
    # Discover all workshop stack names
    npm run cleanup -- --discover

    # Preview cleanup for a specific stack (RECOMMENDED FIRST STEP)
    npm run cleanup -- --stack-name MyWorkshopStack --dry-run

    # Actually perform the cleanup
    npm run cleanup -- --stack-name MyWorkshopStack

    # Clean up resources without valid stackName tags
    npm run cleanup -- --cleanup-missing-tags --dry-run

    # Clean up in a specific region
    npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2

⚠️  SAFETY NOTICE:
    This script performs destructive operations that cannot be undone!
    Always run with --dry-run first to see what would be deleted.
`);
}
/**
 * Print summary report
 */
function printSummary(counts, dryRun) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`\n📊 ${dryRun ? '[DRY RUN] ' : ''}Cleanup Summary:`);
    console.log(`   CloudWatch Log Groups: ${counts.cloudwatchLogs}`);
    console.log(`   EBS Volumes: ${counts.ebsVolumes}`);
    console.log(`   EBS Snapshots: ${counts.ebsSnapshots}`);
    console.log(`   RDS Backups: ${counts.rdsBackups}`);
    console.log(`   ECS Task Definitions: ${counts.ecsTaskDefinitions}`);
    console.log(`   S3 Buckets: ${counts.s3Buckets}`);
    console.log(`   Total Resources: ${total}`);
    if (total === 0) {
        console.log('\n✨ No resources found to clean up!');
    }
    else if (dryRun) {
        console.log(`\n⚠️  This was a dry run. To actually delete these ${total} resources, run without --dry-run`);
    }
    else {
        console.log(`\n✅ Successfully cleaned up ${total} resources!`);
    }
}
/**
 * Prompt for user confirmation
 */
async function promptConfirmation(stackName, dryRun) {
    if (dryRun)
        return true;
    const { createInterface } = await Promise.resolve().then(() => require('node:readline'));
    return new Promise((resolve) => {
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        readline.question(`\n⚠️  You are about to DELETE resources for stack "${stackName}". This action cannot be undone!\n` +
            'Type "yes" to continue or anything else to cancel: ', (answer) => {
            readline.close();
            resolve(answer.toLowerCase() === 'yes');
        });
    });
}
/**
 * Main execution function
 */
async function main() {
    try {
        const options = parseArguments();
        // Validate options
        if (!options.discover && !options.stackName && !options.cleanupMissingTags) {
            console.error('❌ Error: Must provide either --stack-name <name>, --discover, or --cleanup-missing-tags');
            showHelp();
            process.exit(1);
        }
        console.log('🧹 AWS Resource Cleanup Script for One Observability Workshop\n');
        // Initialize cleanup service
        const cleanup = new WorkshopResourceCleanup(options.region);
        // Display AWS account and region information
        try {
            const awsInfo = await cleanup.getAwsAccountInfo();
            console.log('📍 AWS Configuration:');
            console.log(`   Account ID: ${awsInfo.accountId || 'Unable to determine'}`);
            console.log(`   Region: ${awsInfo.region}`);
            console.log();
        }
        catch {
            console.log('📍 AWS Configuration:');
            console.log(`   Account ID: Unable to determine`);
            console.log(`   Region: ${options.region || 'us-east-1'}`);
            console.log();
        }
        if (options.discover) {
            // Discovery mode
            const stackNames = await cleanup.discoverStackNames();
            if (stackNames.length === 0) {
                console.log('No workshop resources found.');
                console.log('\nTo clean up resources without proper stackName tags, run:');
                console.log('npm run cleanup -- --cleanup-missing-tags --dry-run');
            }
            else {
                console.log('\nFound the following workshop stack names:');
                for (const stackName of stackNames) {
                    console.log(`   • ${stackName}`);
                }
                console.log('\nTo clean up a specific stack, run:');
                console.log('npm run cleanup -- --stack-name <STACK_NAME> --dry-run');
                console.log('\nTo clean up resources without proper stackName tags, run:');
                console.log('npm run cleanup -- --cleanup-missing-tags --dry-run');
            }
        }
        else if (options.cleanupMissingTags) {
            // Clean up resources without stackName tags
            console.log('Checking for resources with missing or invalid stackName tags...\n');
            const missingTagsCheck = await cleanup.checkForResourcesWithMissingStackName();
            if (!missingTagsCheck.hasResources) {
                console.log('✨ No resources found with missing stackName tags!');
                return;
            }
            console.log(`Found ${missingTagsCheck.count} resources with missing stackName tags:`);
            for (const resourceType of missingTagsCheck.resourceTypes) {
                console.log(`   • ${resourceType}`);
            }
            if (!options.skipConfirmation) {
                const confirmed = await promptConfirmation('resources without stackName tags', options.dryRun);
                if (!confirmed) {
                    console.log('❌ Operation cancelled by user.');
                    process.exit(0);
                }
            }
            const counts = await cleanup.cleanupResourcesWithoutStackNameTag(options.dryRun);
            printSummary(counts, options.dryRun);
        }
        else if (options.stackName) {
            // Stack-specific cleanup
            if (!options.skipConfirmation) {
                const confirmed = await promptConfirmation(options.stackName, options.dryRun);
                if (!confirmed) {
                    console.log('❌ Operation cancelled by user.');
                    process.exit(0);
                }
            }
            const counts = await cleanup.cleanupStack(options.stackName, options.dryRun);
            printSummary(counts, options.dryRun);
        }
    }
    catch (error) {
        console.error('\n❌ Fatal error during cleanup:', error);
        process.exit(1);
    }
}
// Run the script if executed directly
if (require.main === module) {
    // eslint-disable-next-line unicorn/prefer-top-level-await
    (async () => {
        try {
            await main();
        }
        catch (error) {
            console.error('❌ Unhandled error:', error);
            process.exit(1);
        }
    })();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xlYW51cC1yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjbGVhbnVwLXJlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBOzs7RUFHRTs7O0FBRUY7Ozs7Ozs7Ozs7R0FVRztBQUVILDRFQUE4RjtBQUM5RixvREFBb0g7QUFDcEgsb0RBQXlHO0FBQ3pHLG9EQUFpRjtBQUNqRixrREFBb0g7QUFDcEgsb0dBQWtIO0FBQ2xILCtEQUE2RDtBQW9CaEQsUUFBQSxJQUFJLEdBQUc7SUFDaEIsV0FBVyxFQUFFLFVBQVU7SUFDdkIsV0FBVyxFQUFFLDRCQUE0QjtJQUN6QyxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksa0JBQWtCO0NBQzFELENBQUM7QUFFRixNQUFNLHVCQUF1QjtJQVd6QixZQUFZLFNBQWlCLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVc7UUFGakQsa0JBQWEsR0FBRyxZQUFJLENBQUM7UUFHbEMsTUFBTSxZQUFZLEdBQUcsRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUVyQixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksNkNBQW9CLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDN0QsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLHNCQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdkMsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLHNCQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdkMsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLHNCQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdkMsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLG9CQUFRLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElBQUksbUVBQThCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDbEYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQjtRQUNuQixJQUFJLENBQUM7WUFDRCxrREFBa0Q7WUFDbEQsTUFBTSxPQUFPLEdBQUcsSUFBSSx3REFBbUIsQ0FBQztnQkFDcEMsZ0JBQWdCLEVBQUUsQ0FBQzthQUN0QixDQUFDLENBQUM7WUFFSCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBRXpGLElBQUksU0FBNkIsQ0FBQztZQUNsQyxJQUFJLFFBQVEsQ0FBQyxzQkFBc0IsSUFBSSxRQUFRLENBQUMsc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNoRixNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO2dCQUMzRCxJQUFJLEdBQUcsRUFBRSxDQUFDO29CQUNOLG1GQUFtRjtvQkFDbkYsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDaEMsSUFBSSxRQUFRLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDO3dCQUN2QixTQUFTLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUM1QixDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDO1lBRUQsT0FBTztnQkFDSCxTQUFTO2dCQUNULE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTthQUN0QixDQUFDO1FBQ04sQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNMLE9BQU87Z0JBQ0gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTthQUN0QixDQUFDO1FBQ04sQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDcEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5REFBeUQsQ0FBQyxDQUFDO1FBRXZFLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFFckMsSUFBSSxDQUFDO1lBQ0QsMEVBQTBFO1lBQzFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEVBQTBFLENBQUMsQ0FBQztZQUN4RixNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FDOUI7Z0JBQ0k7b0JBQ0ksR0FBRyxFQUFFLGFBQWE7b0JBQ2xCLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO2lCQUMzQztnQkFDRDtvQkFDSSxHQUFHLEVBQUUsYUFBYTtvQkFDbEIsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUM7aUJBQzNDO2FBQ0osRUFDRCxVQUFVLENBQ2IsQ0FBQztZQUVGLHlFQUF5RTtZQUN6RSxJQUFJLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0VBQStFLENBQUMsQ0FBQztnQkFDN0YsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQzlCO29CQUNJO3dCQUNJLEdBQUcsRUFBRSxhQUFhO3dCQUNsQixNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQztxQkFDM0M7aUJBQ0osRUFDRCxVQUFVLENBQ2IsQ0FBQztZQUNOLENBQUM7WUFFRCxJQUFJLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0RBQW9ELENBQUMsQ0FBQztZQUN0RSxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLFVBQVUsQ0FBQyxJQUFJLHdCQUF3QixDQUFDLENBQUM7WUFDckUsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3RCxDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsVUFBVSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDbEMsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLHVCQUF1QixDQUNqQyxVQUFvRCxFQUNwRCxVQUF1QjtRQUV2QixJQUFJLFNBQTZCLENBQUM7UUFDbEMsR0FBRyxDQUFDO1lBQ0EsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLHdEQUFtQixDQUFDO2dCQUM3QyxVQUFVLEVBQUUsVUFBVTtnQkFDdEIsR0FBRyxDQUFDLFNBQVMsSUFBSSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsQ0FBQzthQUNuRCxDQUFDLENBQUM7WUFFSCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7WUFFbEcsSUFBSSxRQUFRLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztnQkFDbEMsS0FBSyxNQUFNLFFBQVEsSUFBSSxRQUFRLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztvQkFDckQsMkNBQTJDO29CQUMzQyxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksQ0FDcEMsQ0FBQyxHQUFxQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsR0FBRyxLQUFLLFdBQVcsQ0FDckUsQ0FBQztvQkFFRixJQUFJLFlBQVksRUFBRSxLQUFLLElBQUksWUFBWSxDQUFDLEtBQUssS0FBSyxrQkFBa0IsRUFBRSxDQUFDO3dCQUNuRSxVQUFVLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDdkMsQ0FBQzt5QkFBTSxDQUFDO3dCQUNKLDBEQUEwRDt3QkFDMUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQzt3QkFDcEYsSUFBSSxrQkFBa0IsRUFBRSxDQUFDOzRCQUNyQixVQUFVLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUM7d0JBQ3ZDLENBQUM7b0JBQ0wsQ0FBQztnQkFDTCxDQUFDO1lBQ0wsQ0FBQztZQUVELFNBQVMsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDO1FBQ3pDLENBQUMsUUFBUSxTQUFTLEVBQUU7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssdUJBQXVCLENBQUMsR0FBVztRQUN2QyxJQUFJLENBQUMsR0FBRztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRTNCLHNEQUFzRDtRQUN0RCwyR0FBMkc7UUFDM0csd0hBQXdIO1FBRXhILE1BQU0sUUFBUSxHQUFHO1lBQ2IsNEVBQTRFO1lBQzVFLDRCQUE0QjtZQUM1QixzREFBc0Q7WUFDdEQsa0JBQWtCO1lBQ2xCLDREQUE0RDtZQUM1RCxtQkFBbUI7WUFDbkIsOENBQThDO1lBQzlDLGFBQWE7WUFDYix5REFBeUQ7WUFDekQsNkJBQTZCO1lBQzdCLDBDQUEwQztZQUMxQyw0QkFBNEI7U0FDL0IsQ0FBQztRQUVGLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7WUFDN0IsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNqQyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNSLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN0RCxJQUFJLFlBQVksRUFBRSxDQUFDO29CQUNmLGtEQUFrRDtvQkFDbEQsc0NBQXNDO29CQUN0QyxNQUFNLGFBQWEsR0FBRzt3QkFDbEIscUZBQXFGO3dCQUNyRixvQ0FBb0M7d0JBQ3BDLHFDQUFxQzt3QkFDckMsYUFBYTt3QkFDYiw4QkFBOEI7d0JBQzlCLDJCQUEyQjtxQkFDOUIsQ0FBQztvQkFFRixLQUFLLE1BQU0sWUFBWSxJQUFJLGFBQWEsRUFBRSxDQUFDO3dCQUN2QyxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO3dCQUNwRCxJQUFJLFVBQVUsRUFBRSxDQUFDOzRCQUNiLE9BQU8sVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUN6QixDQUFDO29CQUNMLENBQUM7b0JBRUQsOERBQThEO29CQUM5RCxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUM7d0JBQzVFLHlEQUF5RDt3QkFDekQsTUFBTSxXQUFXLEdBQUcsWUFBWSxDQUFDLEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxDQUFDO3dCQUN4RSxJQUFJLFdBQVcsRUFBRSxDQUFDOzRCQUNkLE9BQU8sV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUMxQixDQUFDO29CQUNMLENBQUM7Z0JBQ0wsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLG9CQUFvQixDQUM5QixZQUFvQixFQUNwQixTQUFrQixFQUNsQixZQUFnRSxPQUFPO1FBRXZFLE1BQU0sU0FBUyxHQUFhLEVBQUUsQ0FBQztRQUMvQixJQUFJLFNBQTZCLENBQUM7UUFFbEMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFDO1lBRXRCLFFBQVEsU0FBUyxFQUFFLENBQUM7Z0JBQ2hCLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQztvQkFDWCxVQUFVLENBQUMsSUFBSSxDQUNYLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQ2hFLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQ25FLENBQUM7b0JBQ0YsSUFBSSxTQUFTLEVBQUUsQ0FBQzt3QkFDWixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUM7b0JBQy9ELENBQUM7b0JBQ0QsTUFBTTtnQkFDVixDQUFDO2dCQUVELEtBQUssbUJBQW1CLENBQUMsQ0FBQyxDQUFDO29CQUN2QixVQUFVLENBQUMsSUFBSSxDQUNYLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQ2hFLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQ25FLENBQUM7b0JBQ0Ysd0VBQXdFO29CQUN4RSxNQUFNO2dCQUNWLENBQUM7Z0JBRUQsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7b0JBQ3RCLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLEVBQUUsYUFBYSxFQUFFLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUNsRixNQUFNO2dCQUNWLENBQUM7WUFDTCxDQUFDO1lBRUQsR0FBRyxDQUFDO2dCQUNBLE1BQU0sT0FBTyxHQUFHLElBQUksd0RBQW1CLENBQUM7b0JBQ3BDLG1CQUFtQixFQUFFLENBQUMsWUFBWSxDQUFDO29CQUNuQyxVQUFVLEVBQUUsVUFBVTtvQkFDdEIsR0FBRyxDQUFDLFNBQVMsSUFBSSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsQ0FBQztpQkFDbkQsQ0FBQyxDQUFDO2dCQUVILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxvQ0FBaUIsRUFBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBRXpGLElBQUksUUFBUSxDQUFDLHNCQUFzQixFQUFFLENBQUM7b0JBQ2xDLEtBQUssTUFBTSxRQUFRLElBQUksUUFBUSxDQUFDLHNCQUFzQixFQUFFLENBQUM7d0JBQ3JELElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVzs0QkFBRSxTQUFTO3dCQUVwQyw2RUFBNkU7d0JBQzdFLElBQUksU0FBUyxLQUFLLG1CQUFtQixFQUFFLENBQUM7NEJBQ3BDLE1BQU0sWUFBWSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUNwQyxDQUFDLEdBQXFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssV0FBVyxDQUNyRSxDQUFDOzRCQUNGLElBQUksWUFBWSxFQUFFLEtBQUssSUFBSSxZQUFZLENBQUMsS0FBSyxLQUFLLGtCQUFrQixFQUFFLENBQUM7Z0NBQ25FLFNBQVMsQ0FBQyxzQ0FBc0M7NEJBQ3BELENBQUM7d0JBQ0wsQ0FBQzt3QkFFRCxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsQ0FBQztvQkFDekMsQ0FBQztnQkFDTCxDQUFDO2dCQUVELFNBQVMsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDO1lBQ3pDLENBQUMsUUFBUSxTQUFTLEVBQUU7UUFDeEIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxZQUFZLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNwRixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssaUJBQWlCLENBQUMsR0FBVyxFQUFFLFlBQW9CO1FBQ3ZELE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFN0IsUUFBUSxZQUFZLEVBQUUsQ0FBQztZQUNuQixLQUFLLGdCQUFnQixDQUFDLENBQUMsQ0FBQztnQkFDcEIsK0NBQStDO2dCQUMvQyxPQUFPLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7WUFDeEYsQ0FBQztZQUVELEtBQUssWUFBWSxDQUFDO1lBQ2xCLEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQztnQkFDbEIsaUVBQWlFO2dCQUNqRSxPQUFPLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7WUFDbEUsQ0FBQztZQUVELEtBQUssaUJBQWlCLENBQUM7WUFDdkIsS0FBSyxzQkFBc0IsQ0FBQyxDQUFDLENBQUM7Z0JBQzFCLG9FQUFvRTtnQkFDcEUsT0FBTyxLQUFLLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7WUFDcEQsQ0FBQztZQUVELEtBQUsscUJBQXFCLENBQUMsQ0FBQyxDQUFDO2dCQUN6Qiw2REFBNkQ7Z0JBQzdELE9BQU8sS0FBSyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztZQUNsRSxDQUFDO1lBRUQsS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDO2dCQUNmLDJCQUEyQjtnQkFDM0IsT0FBTyxLQUFLLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7WUFDcEQsQ0FBQztZQUVELE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQ04sT0FBTyxTQUFTLENBQUM7WUFDckIsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxlQUFlLENBQ25CLElBQTJFLEVBQzNFLFNBQWtCLEVBQ2xCLFlBQWdFLE9BQU87UUFFdkUsTUFBTSxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRXhGLE1BQU0sZUFBZSxHQUNqQixNQUFNLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxLQUFLLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVztZQUM1RCxNQUFNLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxLQUFLLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO1FBRWpFLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQztRQUN2RixNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLEtBQUssa0JBQWtCLENBQUM7UUFFbEcsUUFBUSxTQUFTLEVBQUUsQ0FBQztZQUNoQixLQUFLLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQ1gsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixPQUFPLGVBQWUsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxLQUFLLFNBQVMsQ0FBQztnQkFDcEUsQ0FBQztnQkFDRCxPQUFPLGVBQWUsQ0FBQztZQUMzQixDQUFDO1lBRUQsS0FBSyxtQkFBbUIsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZCLGdFQUFnRTtnQkFDaEUsT0FBTyxlQUFlLElBQUksQ0FBQyxlQUFlLENBQUM7WUFDL0MsQ0FBQztZQUVELEtBQUssa0JBQWtCLENBQUMsQ0FBQyxDQUFDO2dCQUN0QixzREFBc0Q7Z0JBQ3RELE9BQU8saUJBQWlCLENBQUM7WUFDN0IsQ0FBQztZQUVELE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQ04sT0FBTyxlQUFlLENBQUM7WUFDM0IsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMscUNBQXFDO1FBS3ZDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNERBQTRELENBQUMsQ0FBQztRQUUxRSxNQUFNLGFBQWEsR0FBYSxFQUFFLENBQUM7UUFDbkMsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDO1FBRW5CLElBQUksQ0FBQztZQUNELHdCQUF3QjtZQUN4QixPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO1lBQ2hFLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGtDQUFrQyxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFDaEYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDakMsSUFBSSxPQUFPLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2QsYUFBYSxDQUFDLElBQUksQ0FBQywwQkFBMEIsT0FBTyxHQUFHLENBQUMsQ0FBQztnQkFDekQsVUFBVSxJQUFJLE9BQU8sQ0FBQztZQUMxQixDQUFDO1lBRUQsb0JBQW9CO1lBQ3BCLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7WUFDdEQsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsa0NBQWtDLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDaEYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFDckMsSUFBSSxXQUFXLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2xCLGFBQWEsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLFdBQVcsR0FBRyxDQUFDLENBQUM7Z0JBQ25ELFVBQVUsSUFBSSxXQUFXLENBQUM7WUFDOUIsQ0FBQztZQUVELHNCQUFzQjtZQUN0QixPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1lBQ3hELE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLGtDQUFrQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ25GLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxZQUFZLEVBQUUsQ0FBQyxDQUFDO1lBQ3RDLElBQUksWUFBWSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNuQixhQUFhLENBQUMsSUFBSSxDQUFDLGtCQUFrQixZQUFZLEdBQUcsQ0FBQyxDQUFDO2dCQUN0RCxVQUFVLElBQUksWUFBWSxDQUFDO1lBQy9CLENBQUM7WUFFRCxtQ0FBbUM7WUFDbkMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztZQUN2RCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLGtDQUFrQyxDQUFDLGlCQUFpQixDQUFDLENBQUM7WUFDMUYsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsa0NBQWtDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztZQUM5RixNQUFNLFFBQVEsR0FBRyxnQkFBZ0IsR0FBRyxlQUFlLENBQUM7WUFDcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLFFBQVEsRUFBRSxDQUFDLENBQUM7WUFDbEMsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2YsYUFBYSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsUUFBUSxHQUFHLENBQUMsQ0FBQztnQkFDaEQsVUFBVSxJQUFJLFFBQVEsQ0FBQztZQUMzQixDQUFDO1lBRUQsNkJBQTZCO1lBQzdCLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxDQUFDLENBQUM7WUFDL0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsa0NBQWtDLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUN0RixPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUNsQyxJQUFJLFFBQVEsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDZixhQUFhLENBQUMsSUFBSSxDQUFDLHlCQUF5QixRQUFRLEdBQUcsQ0FBQyxDQUFDO2dCQUN6RCxVQUFVLElBQUksUUFBUSxDQUFDO1lBQzNCLENBQUM7WUFFRCxtQkFBbUI7WUFDbkIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQztZQUNyRCxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUMzRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUNqQyxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDZCxhQUFhLENBQUMsSUFBSSxDQUFDLGVBQWUsT0FBTyxHQUFHLENBQUMsQ0FBQztnQkFDOUMsVUFBVSxJQUFJLE9BQU8sQ0FBQztZQUMxQixDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMkNBQTJDO1lBRTFELE9BQU87Z0JBQ0gsWUFBWSxFQUFFLFVBQVUsR0FBRyxDQUFDO2dCQUM1QixLQUFLLEVBQUUsVUFBVTtnQkFDakIsYUFBYTthQUNoQixDQUFDO1FBQ04sQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3hELE9BQU8sRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxDQUFDO1FBQ2hFLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxLQUFLLENBQUMsa0NBQWtDLENBQUMsWUFBb0I7UUFDakUsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1FBQ2hHLE9BQU8sU0FBUyxDQUFDLE1BQU0sQ0FBQztJQUM1QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsU0FBaUIsRUFBRSxNQUFlO1FBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLENBQUMsQ0FBQztRQUV6RCxJQUFJLFlBQVksR0FBRyxDQUFDLENBQUM7UUFDckIsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUM7UUFFdEMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBRTNFLEtBQUssTUFBTSxXQUFXLElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsWUFBWSxDQUFDLENBQUM7Z0JBRXZFLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztvQkFDaEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvREFBb0QsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDL0UsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsWUFBWSxFQUFFLENBQUMsQ0FBQztnQkFDeEUsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksOENBQXFCLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQ3hFLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsWUFBWSxFQUFFLENBQUMsQ0FBQztvQkFDM0QsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULG1DQUFtQyxZQUFZLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQy9HLENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsWUFBWSxFQUFFLENBQUM7WUFDbkIsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNqRSxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsTUFBZTtRQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLCtCQUErQixDQUFDLENBQUM7UUFFN0MsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLE1BQU0sWUFBWSxHQUFHLFlBQVksQ0FBQztRQUVsQyxJQUFJLENBQUM7WUFDRCxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFFM0UsS0FBSyxNQUFNLFdBQVcsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQztnQkFFbkUsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO29CQUNaLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQzFFLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCx5REFBeUQ7Z0JBQ3pELElBQUksQ0FBQztvQkFDRCxNQUFNLGVBQWUsR0FBRyxJQUFJLG1DQUFzQixDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUM5RSxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBQSxvQ0FBaUIsRUFBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDO29CQUV2RixNQUFNLE1BQU0sR0FBRyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDN0MsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO3dCQUNWLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLFFBQVEsMkNBQTJDLENBQUMsQ0FBQzt3QkFDakYsU0FBUztvQkFDYixDQUFDO29CQUVELElBQUksTUFBTSxDQUFDLEtBQUssS0FBSyxXQUFXLEVBQUUsQ0FBQzt3QkFDL0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsUUFBUSxxQkFBcUIsTUFBTSxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUM7d0JBQ3hGLFNBQVM7b0JBQ2IsQ0FBQztnQkFDTCxDQUFDO2dCQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7b0JBQ3RCLE1BQU0sV0FBVyxHQUFHLEtBQTJELENBQUM7b0JBQ2hGLElBQ0ksV0FBVyxDQUFDLElBQUksS0FBSyx3QkFBd0I7d0JBQzdDLFdBQVcsQ0FBQyxJQUFJLEtBQUssd0JBQXdCLEVBQy9DLENBQUM7d0JBQ0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsUUFBUSw2QkFBNkIsQ0FBQyxDQUFDO3dCQUNuRSxTQUFTO29CQUNiLENBQUM7b0JBQ0QsT0FBTyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsUUFBUSxLQUFLLFdBQVcsQ0FBQyxPQUFPLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztvQkFDakcsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsUUFBUSxFQUFFLENBQUMsQ0FBQztnQkFDckUsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQ0FBbUIsQ0FBQyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFDOUYsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsUUFBUSxFQUFFLENBQUMsQ0FBQztvQkFDeEQsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixNQUFNLFdBQVcsR0FBRyxLQUEyRCxDQUFDO3dCQUNoRixJQUNJLFdBQVcsQ0FBQyxJQUFJLEtBQUssd0JBQXdCOzRCQUM3QyxXQUFXLENBQUMsSUFBSSxLQUFLLHdCQUF3QixFQUMvQyxDQUFDOzRCQUNDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLFFBQVEsa0NBQWtDLENBQUMsQ0FBQzt3QkFDNUUsQ0FBQzs2QkFBTSxDQUFDOzRCQUNKLE9BQU8sQ0FBQyxLQUFLLENBQ1QsZ0NBQWdDLFFBQVEsS0FBSyxXQUFXLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUN0RixDQUFDO3dCQUNOLENBQUM7d0JBQ0QsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsWUFBWSxFQUFFLENBQUM7WUFDbkIsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3RCxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLFNBQWlCLEVBQUUsTUFBZTtRQUN4RCxPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7UUFFL0MsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLE1BQU0sWUFBWSxHQUFHLGNBQWMsQ0FBQztRQUVwQyxJQUFJLENBQUM7WUFDRCxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFFM0UsS0FBSyxNQUFNLFdBQVcsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQztnQkFFckUsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO29CQUNkLE9BQU8sQ0FBQyxHQUFHLENBQUMsaURBQWlELFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQzVFLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNULE9BQU8sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3pFLENBQUM7cUJBQU0sQ0FBQztvQkFDSixJQUFJLENBQUM7d0JBQ0QsTUFBTSxJQUFBLG9DQUFpQixFQUFDLEdBQUcsRUFBRSxDQUN6QixJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLGtDQUFxQixDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FDdkUsQ0FBQzt3QkFDRixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixVQUFVLEVBQUUsQ0FBQyxDQUFDO29CQUM1RCxDQUFDO29CQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7d0JBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQ1Qsa0NBQWtDLFVBQVUsS0FBSyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDNUcsQ0FBQzt3QkFDRixTQUFTO29CQUNiLENBQUM7Z0JBQ0wsQ0FBQztnQkFDRCxZQUFZLEVBQUUsQ0FBQztZQUNuQixDQUFDO1FBQ0wsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQy9ELENBQUM7UUFFRCxPQUFPLFlBQVksQ0FBQztJQUN4QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsU0FBaUIsRUFBRSxNQUFlO1FBQ3RELE9BQU8sQ0FBQyxHQUFHLENBQUMsaUNBQWlDLENBQUMsQ0FBQztRQUUvQyxJQUFJLFlBQVksR0FBRyxDQUFDLENBQUM7UUFFckIsSUFBSSxDQUFDO1lBQ0Qsd0JBQXdCO1lBQ3hCLE1BQU0sb0JBQW9CLEdBQUcsaUJBQWlCLENBQUM7WUFDL0MsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUUzRixLQUFLLE1BQU0sV0FBVyxJQUFJLGlCQUFpQixFQUFFLENBQUM7Z0JBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztnQkFFN0UsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO29CQUNkLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0RBQW9ELFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQy9FLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNULE9BQU8sQ0FBQyxHQUFHLENBQUMsMENBQTBDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3hFLENBQUM7cUJBQU0sQ0FBQztvQkFDSixJQUFJLENBQUM7d0JBQ0QsTUFBTSxJQUFBLG9DQUFpQixFQUFDLEdBQUcsRUFBRSxDQUN6QixJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLG9DQUF1QixDQUFDLEVBQUUsb0JBQW9CLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUNuRixDQUFDO3dCQUNGLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkJBQTZCLFVBQVUsRUFBRSxDQUFDLENBQUM7b0JBQzNELENBQUM7b0JBQUMsT0FBTyxLQUFjLEVBQUUsQ0FBQzt3QkFDdEIsT0FBTyxDQUFDLEtBQUssQ0FDVCxxQ0FBcUMsVUFBVSxLQUFLLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUMvRyxDQUFDO3dCQUNGLFNBQVM7b0JBQ2IsQ0FBQztnQkFDTCxDQUFDO2dCQUNELFlBQVksRUFBRSxDQUFDO1lBQ25CLENBQUM7WUFFRCxnQ0FBZ0M7WUFDaEMsTUFBTSxtQkFBbUIsR0FBRyxzQkFBc0IsQ0FBQztZQUNuRCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLG1CQUFtQixFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBRXpGLEtBQUssTUFBTSxXQUFXLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztnQkFDekMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO2dCQUU1RSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ2QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5REFBeUQsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDcEYsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDaEYsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUNULElBQUksMkNBQThCLENBQUMsRUFBRSwyQkFBMkIsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUNsRixDQUNKLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsVUFBVSxFQUFFLENBQUMsQ0FBQztvQkFDbkUsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULDBDQUEwQyxVQUFVLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQ3BILENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsWUFBWSxFQUFFLENBQUM7WUFDbkIsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3RCxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLFNBQWlCLEVBQUUsTUFBZTtRQUM5RCxPQUFPLENBQUMsR0FBRyxDQUFDLHdDQUF3QyxDQUFDLENBQUM7UUFFdEQsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLE1BQU0sWUFBWSxHQUFHLHFCQUFxQixDQUFDO1FBRTNDLElBQUksQ0FBQztZQUNELE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLFlBQVksRUFBRSxTQUFTLENBQUMsQ0FBQztZQUUzRSxLQUFLLE1BQU0sV0FBVyxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNsQyxNQUFNLGNBQWMsR0FBRyxXQUFXLENBQUMsQ0FBQyw0Q0FBNEM7Z0JBRWhGLElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsY0FBYyxFQUFFLENBQUMsQ0FBQztnQkFDcEYsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksNENBQStCLENBQUMsRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDLENBQ3pFLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsY0FBYyxFQUFFLENBQUMsQ0FBQztvQkFDeEUsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULDZDQUE2QyxjQUFjLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQzNILENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsWUFBWSxFQUFFLENBQUM7WUFDbkIsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN0RSxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLFNBQWlCLEVBQUUsTUFBZTtRQUNyRCxPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixDQUFDLENBQUM7UUFFNUMsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQztRQUVqQyxJQUFJLENBQUM7WUFDRCxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFFM0UsS0FBSyxNQUFNLFdBQVcsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQztnQkFFckUsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO29CQUNkLE9BQU8sQ0FBQyxHQUFHLENBQUMsaURBQWlELFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQzVFLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNULE9BQU8sQ0FBQyxHQUFHLENBQUMsa0RBQWtELFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ2hGLENBQUM7cUJBQU0sQ0FBQztvQkFDSixJQUFJLENBQUM7d0JBQ0QseUJBQXlCO3dCQUN6QixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7d0JBRXJDLHlCQUF5Qjt3QkFDekIsTUFBTSxJQUFBLG9DQUFpQixFQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQW1CLENBQUMsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7d0JBQzdGLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLFVBQVUsRUFBRSxDQUFDLENBQUM7b0JBQ3pELENBQUM7b0JBQUMsT0FBTyxLQUFjLEVBQUUsQ0FBQzt3QkFDdEIsT0FBTyxDQUFDLEtBQUssQ0FDVCxnQ0FBZ0MsVUFBVSxLQUFLLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUMxRyxDQUFDO3dCQUNGLFNBQVM7b0JBQ2IsQ0FBQztnQkFDTCxDQUFDO2dCQUNELFlBQVksRUFBRSxDQUFDO1lBQ25CLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDNUQsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFDO0lBQ3hCLENBQUM7SUFFRDs7T0FFRztJQUNLLEtBQUssQ0FBQyxhQUFhLENBQUMsVUFBa0I7UUFDMUMsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUV6RCxJQUFJLENBQUM7WUFDRCxJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUM7WUFDdkIsSUFBSSxTQUE2QixDQUFDO1lBQ2xDLElBQUksZUFBbUMsQ0FBQztZQUV4QyxPQUFPLFdBQVcsRUFBRSxDQUFDO2dCQUNqQixNQUFNLFdBQVcsR0FBRyxJQUFJLHFDQUF5QixDQUFDO29CQUM5QyxNQUFNLEVBQUUsVUFBVTtvQkFDbEIsU0FBUyxFQUFFLFNBQVM7b0JBQ3BCLGVBQWUsRUFBRSxlQUFlO29CQUNoQyxPQUFPLEVBQUUsSUFBSTtpQkFDaEIsQ0FBQyxDQUFDO2dCQUVILE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBQSxvQ0FBaUIsRUFBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO2dCQUU5RSxNQUFNLE9BQU8sR0FBK0MsRUFBRSxDQUFDO2dCQUUvRCx1QkFBdUI7Z0JBQ3ZCLElBQUksWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDO29CQUN4QixPQUFPLENBQUMsSUFBSSxDQUNSLEdBQUcsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7d0JBQ3ZDLEdBQUcsRUFBRSxPQUFPLENBQUMsR0FBSTt3QkFDakIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO3FCQUMvQixDQUFDLENBQUMsQ0FDTixDQUFDO2dCQUNOLENBQUM7Z0JBRUQscUJBQXFCO2dCQUNyQixJQUFJLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQztvQkFDN0IsT0FBTyxDQUFDLElBQUksQ0FDUixHQUFHLFlBQVksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO3dCQUMzQyxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUk7d0JBQ2hCLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztxQkFDOUIsQ0FBQyxDQUFDLENBQ04sQ0FBQztnQkFDTixDQUFDO2dCQUVELDRCQUE0QjtnQkFDNUIsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUNyQixNQUFNLGFBQWEsR0FBRyxJQUFJLGdDQUFvQixDQUFDO3dCQUMzQyxNQUFNLEVBQUUsVUFBVTt3QkFDbEIsTUFBTSxFQUFFOzRCQUNKLE9BQU8sRUFBRSxPQUFPOzRCQUNoQixLQUFLLEVBQUUsSUFBSTt5QkFDZDtxQkFDSixDQUFDLENBQUM7b0JBRUgsTUFBTSxJQUFBLG9DQUFpQixFQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUM7b0JBQzNELE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLE9BQU8sQ0FBQyxNQUFNLFVBQVUsQ0FBQyxDQUFDO2dCQUMxRCxDQUFDO2dCQUVELFdBQVcsR0FBRyxZQUFZLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQztnQkFDaEQsU0FBUyxHQUFHLFlBQVksQ0FBQyxhQUFhLENBQUM7Z0JBQ3ZDLGVBQWUsR0FBRyxZQUFZLENBQUMsbUJBQW1CLENBQUM7WUFDdkQsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO1lBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQ1QsK0JBQStCLFVBQVUsS0FBSyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDekcsQ0FBQztZQUNGLE1BQU0sS0FBSyxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLFNBQWlCLEVBQUUsU0FBa0IsS0FBSztRQUN6RCxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLEVBQUUsb0NBQW9DLFNBQVMsSUFBSSxDQUFDLENBQUM7UUFFakcsTUFBTSxNQUFNLEdBQW1CO1lBQzNCLGNBQWMsRUFBRSxDQUFDO1lBQ2pCLFVBQVUsRUFBRSxDQUFDO1lBQ2IsWUFBWSxFQUFFLENBQUM7WUFDZixVQUFVLEVBQUUsQ0FBQztZQUNiLGtCQUFrQixFQUFFLENBQUM7WUFDckIsU0FBUyxFQUFFLENBQUM7U0FDZixDQUFDO1FBRUYsd0RBQXdEO1FBQ3hELE1BQU0sZUFBZSxHQUFHO1lBQ3BCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1lBQzdDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1lBQzNDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1lBQ3pDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1lBQ2pELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO1NBQzNDLENBQUM7UUFFRixJQUFJLENBQUM7WUFDRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFbkQsTUFBTSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbkMsTUFBTSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDL0IsTUFBTSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDakMsTUFBTSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDL0IsTUFBTSxDQUFDLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2QyxNQUFNLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMseUJBQXlCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxTQUFrQixLQUFLO1FBQzdELE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxNQUFNLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxzREFBc0QsQ0FBQyxDQUFDO1FBRXRHLE1BQU0sTUFBTSxHQUFtQjtZQUMzQixjQUFjLEVBQUUsQ0FBQztZQUNqQixVQUFVLEVBQUUsQ0FBQztZQUNiLFlBQVksRUFBRSxDQUFDO1lBQ2YsVUFBVSxFQUFFLENBQUM7WUFDYixrQkFBa0IsRUFBRSxDQUFDO1lBQ3JCLFNBQVMsRUFBRSxDQUFDO1NBQ2YsQ0FBQztRQUVGLElBQUksQ0FBQztZQUNELDZDQUE2QztZQUM3QyxPQUFPLENBQUMsR0FBRyxDQUFDLDZEQUE2RCxDQUFDLENBQUM7WUFDM0UsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUM7WUFDdEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1lBRWhHLEtBQUssTUFBTSxXQUFXLElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsWUFBWSxDQUFDLENBQUM7Z0JBRXZFLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztvQkFDaEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvREFBb0QsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDL0UsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsWUFBWSxFQUFFLENBQUMsQ0FBQztnQkFDeEUsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksOENBQXFCLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQ3hFLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsWUFBWSxFQUFFLENBQUMsQ0FBQztvQkFDM0QsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULG1DQUFtQyxZQUFZLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQy9HLENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQzVCLENBQUM7WUFFRCx5Q0FBeUM7WUFDekMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO1lBQy9ELE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQztZQUNoQyxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLG1CQUFtQixDQUFDLENBQUM7WUFFNUYsS0FBSyxNQUFNLFdBQVcsSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDaEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztnQkFFakUsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO29CQUNaLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQzFFLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCx5REFBeUQ7Z0JBQ3pELElBQUksQ0FBQztvQkFDRCxNQUFNLGVBQWUsR0FBRyxJQUFJLG1DQUFzQixDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUM5RSxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBQSxvQ0FBaUIsRUFBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDO29CQUV2RixNQUFNLE1BQU0sR0FBRyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDN0MsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO3dCQUNWLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLFFBQVEsMkNBQTJDLENBQUMsQ0FBQzt3QkFDakYsU0FBUztvQkFDYixDQUFDO29CQUVELElBQUksTUFBTSxDQUFDLEtBQUssS0FBSyxXQUFXLEVBQUUsQ0FBQzt3QkFDL0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsUUFBUSxxQkFBcUIsTUFBTSxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUM7d0JBQ3hGLFNBQVM7b0JBQ2IsQ0FBQztnQkFDTCxDQUFDO2dCQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7b0JBQ3RCLE1BQU0sV0FBVyxHQUFHLEtBQTJELENBQUM7b0JBQ2hGLElBQ0ksV0FBVyxDQUFDLElBQUksS0FBSyx3QkFBd0I7d0JBQzdDLFdBQVcsQ0FBQyxJQUFJLEtBQUssd0JBQXdCLEVBQy9DLENBQUM7d0JBQ0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsUUFBUSw2QkFBNkIsQ0FBQyxDQUFDO3dCQUNuRSxTQUFTO29CQUNiLENBQUM7b0JBQ0QsT0FBTyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsUUFBUSxLQUFLLFdBQVcsQ0FBQyxPQUFPLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztvQkFDakcsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsUUFBUSxFQUFFLENBQUMsQ0FBQztnQkFDckUsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQ0FBbUIsQ0FBQyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFDOUYsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsUUFBUSxFQUFFLENBQUMsQ0FBQztvQkFDeEQsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixNQUFNLFdBQVcsR0FBRyxLQUEyRCxDQUFDO3dCQUNoRixJQUNJLFdBQVcsQ0FBQyxJQUFJLEtBQUssd0JBQXdCOzRCQUM3QyxXQUFXLENBQUMsSUFBSSxLQUFLLHdCQUF3QixFQUMvQyxDQUFDOzRCQUNDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLFFBQVEsa0NBQWtDLENBQUMsQ0FBQzt3QkFDNUUsQ0FBQzs2QkFBTSxDQUFDOzRCQUNKLE9BQU8sQ0FBQyxLQUFLLENBQ1QsZ0NBQWdDLFFBQVEsS0FBSyxXQUFXLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUN0RixDQUFDO3dCQUNOLENBQUM7d0JBQ0QsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3hCLENBQUM7WUFFRCwyQ0FBMkM7WUFDM0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1lBQ2pFLE1BQU0sWUFBWSxHQUFHLGNBQWMsQ0FBQztZQUNwQyxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxFQUFFLG1CQUFtQixDQUFDLENBQUM7WUFFaEcsS0FBSyxNQUFNLFdBQVcsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQztnQkFFckUsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO29CQUNkLE9BQU8sQ0FBQyxHQUFHLENBQUMsaURBQWlELFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQzVFLFNBQVM7Z0JBQ2IsQ0FBQztnQkFFRCxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNULE9BQU8sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3pFLENBQUM7cUJBQU0sQ0FBQztvQkFDSixJQUFJLENBQUM7d0JBQ0QsTUFBTSxJQUFBLG9DQUFpQixFQUFDLEdBQUcsRUFBRSxDQUN6QixJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLGtDQUFxQixDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FDdkUsQ0FBQzt3QkFDRixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixVQUFVLEVBQUUsQ0FBQyxDQUFDO29CQUM1RCxDQUFDO29CQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7d0JBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQ1Qsa0NBQWtDLFVBQVUsS0FBSyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDNUcsQ0FBQzt3QkFDRixTQUFTO29CQUNiLENBQUM7Z0JBQ0wsQ0FBQztnQkFDRCxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDMUIsQ0FBQztZQUVELHlDQUF5QztZQUN6QyxPQUFPLENBQUMsR0FBRyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7WUFFakUsd0JBQXdCO1lBQ3hCLE1BQU0sb0JBQW9CLEdBQUcsaUJBQWlCLENBQUM7WUFDL0MsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FDckQsb0JBQW9CLEVBQ3BCLFNBQVMsRUFDVCxtQkFBbUIsQ0FDdEIsQ0FBQztZQUVGLEtBQUssTUFBTSxXQUFXLElBQUksaUJBQWlCLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO2dCQUU3RSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ2QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvREFBb0QsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDL0UsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQ0FBMEMsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDeEUsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksb0NBQXVCLENBQUMsRUFBRSxvQkFBb0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQ25GLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsVUFBVSxFQUFFLENBQUMsQ0FBQztvQkFDM0QsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULHFDQUFxQyxVQUFVLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQy9HLENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3hCLENBQUM7WUFFRCxnQ0FBZ0M7WUFDaEMsTUFBTSxtQkFBbUIsR0FBRyxzQkFBc0IsQ0FBQztZQUNuRCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUNwRCxtQkFBbUIsRUFDbkIsU0FBUyxFQUNULG1CQUFtQixDQUN0QixDQUFDO1lBRUYsS0FBSyxNQUFNLFdBQVcsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO2dCQUN6QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsV0FBVyxFQUFFLG1CQUFtQixDQUFDLENBQUM7Z0JBRTVFLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztvQkFDZCxPQUFPLENBQUMsR0FBRyxDQUFDLHlEQUF5RCxXQUFXLEVBQUUsQ0FBQyxDQUFDO29CQUNwRixTQUFTO2dCQUNiLENBQUM7Z0JBRUQsSUFBSSxNQUFNLEVBQUUsQ0FBQztvQkFDVCxPQUFPLENBQUMsR0FBRyxDQUFDLGtEQUFrRCxVQUFVLEVBQUUsQ0FBQyxDQUFDO2dCQUNoRixDQUFDO3FCQUFNLENBQUM7b0JBQ0osSUFBSSxDQUFDO3dCQUNELE1BQU0sSUFBQSxvQ0FBaUIsRUFBQyxHQUFHLEVBQUUsQ0FDekIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQ1QsSUFBSSwyQ0FBOEIsQ0FBQyxFQUFFLDJCQUEyQixFQUFFLFVBQVUsRUFBRSxDQUFDLENBQ2xGLENBQ0osQ0FBQzt3QkFDRixPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO29CQUNuRSxDQUFDO29CQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7d0JBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQ1QsMENBQTBDLFVBQVUsS0FBSyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDcEgsQ0FBQzt3QkFDRixTQUFTO29CQUNiLENBQUM7Z0JBQ0wsQ0FBQztnQkFDRCxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDeEIsQ0FBQztZQUVELGtEQUFrRDtZQUNsRCxPQUFPLENBQUMsR0FBRyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7WUFDeEUsTUFBTSxrQkFBa0IsR0FBRyxxQkFBcUIsQ0FBQztZQUNqRCxNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxrQkFBa0IsRUFBRSxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztZQUU1RyxLQUFLLE1BQU0sV0FBVyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUN4QyxNQUFNLGNBQWMsR0FBRyxXQUFXLENBQUMsQ0FBQyw0Q0FBNEM7Z0JBRWhGLElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsY0FBYyxFQUFFLENBQUMsQ0FBQztnQkFDcEYsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCxNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksNENBQStCLENBQUMsRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDLENBQ3pFLENBQUM7d0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsY0FBYyxFQUFFLENBQUMsQ0FBQztvQkFDeEUsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULDZDQUE2QyxjQUFjLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQzNILENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDaEMsQ0FBQztZQUVELHdDQUF3QztZQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7WUFDOUQsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDO1lBQy9CLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztZQUU1RixLQUFLLE1BQU0sV0FBVyxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNoQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsV0FBVyxFQUFFLFVBQVUsQ0FBQyxDQUFDO2dCQUVuRSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ2QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpREFBaUQsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDNUUsU0FBUztnQkFDYixDQUFDO2dCQUVELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDaEYsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQzt3QkFDRCx5QkFBeUI7d0JBQ3pCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQzt3QkFFckMseUJBQXlCO3dCQUN6QixNQUFNLElBQUEsb0NBQWlCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSwrQkFBbUIsQ0FBQyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFDN0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsVUFBVSxFQUFFLENBQUMsQ0FBQztvQkFDekQsQ0FBQztvQkFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO3dCQUN0QixPQUFPLENBQUMsS0FBSyxDQUNULGdDQUFnQyxVQUFVLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQzFHLENBQUM7d0JBQ0YsU0FBUztvQkFDYixDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3ZCLENBQUM7WUFFRCxPQUFPLE1BQU0sQ0FBQztRQUNsQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0RBQXdELEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDL0UsT0FBTyxNQUFNLENBQUM7UUFDbEIsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQUVEOztHQUVHO0FBQ0gsU0FBUyxjQUFjO0lBQ25CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3pDLE1BQU0sT0FBTyxHQUFtQjtRQUM1QixRQUFRLEVBQUUsS0FBSztRQUNmLE1BQU0sRUFBRSxLQUFLO0tBQ2hCLENBQUM7SUFFRixLQUFLLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1FBQ3JELE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVuQyxRQUFRLFFBQVEsRUFBRSxDQUFDO1lBQ2YsS0FBSyxjQUFjLENBQUMsQ0FBQyxDQUFDO2dCQUNsQixPQUFPLENBQUMsU0FBUyxHQUFHLFVBQVUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUN4QyxNQUFNO1lBQ1YsQ0FBQztZQUNELEtBQUssWUFBWSxDQUFDLENBQUMsQ0FBQztnQkFDaEIsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUM7Z0JBQ3hCLE1BQU07WUFDVixDQUFDO1lBQ0QsS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDO2dCQUNmLE9BQU8sQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO2dCQUN0QixNQUFNO1lBQ1YsQ0FBQztZQUNELEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQztnQkFDZCxPQUFPLENBQUMsTUFBTSxHQUFHLFVBQVUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNyQyxNQUFNO1lBQ1YsQ0FBQztZQUNELEtBQUsscUJBQXFCLENBQUMsQ0FBQyxDQUFDO2dCQUN6QixPQUFPLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDO2dCQUNoQyxNQUFNO1lBQ1YsQ0FBQztZQUNELEtBQUssd0JBQXdCLENBQUMsQ0FBQyxDQUFDO2dCQUM1QixPQUFPLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDO2dCQUNsQyxNQUFNO1lBQ1YsQ0FBQztZQUNELEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQztnQkFDWixRQUFRLEVBQUUsQ0FBQztnQkFDWCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNoQixNQUFNO1lBQ1YsQ0FBQztZQUNELE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQ04sSUFBSSxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQzVCLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLFFBQVEsRUFBRSxDQUFDLENBQUM7b0JBQy9DLFFBQVEsRUFBRSxDQUFDO29CQUNYLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3BCLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE9BQU8sQ0FBQztBQUNuQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLFFBQVE7SUFDYixPQUFPLENBQUMsR0FBRyxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBa0NmLENBQUMsQ0FBQztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsWUFBWSxDQUFDLE1BQXNCLEVBQUUsTUFBZTtJQUN6RCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFM0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLE1BQU0sQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFDbEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsTUFBTSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUM7SUFDbEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFDcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7SUFDeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFDcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsTUFBTSxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQztJQUNyRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixNQUFNLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUNsRCxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBRTVDLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ2QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7U0FBTSxJQUFJLE1BQU0sRUFBRSxDQUFDO1FBQ2hCLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0RBQXNELEtBQUssbUNBQW1DLENBQUMsQ0FBQztJQUNoSCxDQUFDO1NBQU0sQ0FBQztRQUNKLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEtBQUssYUFBYSxDQUFDLENBQUM7SUFDbkUsQ0FBQztBQUNMLENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxTQUFpQixFQUFFLE1BQWU7SUFDaEUsSUFBSSxNQUFNO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFFeEIsTUFBTSxFQUFFLGVBQWUsRUFBRSxHQUFHLDJDQUFhLGVBQWUsRUFBQyxDQUFDO0lBQzFELE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtRQUMzQixNQUFNLFFBQVEsR0FBRyxlQUFlLENBQUM7WUFDN0IsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO1lBQ3BCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtTQUN6QixDQUFDLENBQUM7UUFFSCxRQUFRLENBQUMsUUFBUSxDQUNiLHNEQUFzRCxTQUFTLG9DQUFvQztZQUMvRixxREFBcUQsRUFDekQsQ0FBQyxNQUFjLEVBQUUsRUFBRTtZQUNmLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNqQixPQUFPLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxLQUFLLEtBQUssQ0FBQyxDQUFDO1FBQzVDLENBQUMsQ0FDSixDQUFDO0lBQ04sQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsSUFBSTtJQUNmLElBQUksQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBRWpDLG1CQUFtQjtRQUNuQixJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUN6RSxPQUFPLENBQUMsS0FBSyxDQUFDLHlGQUF5RixDQUFDLENBQUM7WUFDekcsUUFBUSxFQUFFLENBQUM7WUFDWCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3BCLENBQUM7UUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLGlFQUFpRSxDQUFDLENBQUM7UUFFL0UsNkJBQTZCO1FBQzdCLE1BQU0sT0FBTyxHQUFHLElBQUksdUJBQXVCLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVELDZDQUE2QztRQUM3QyxJQUFJLENBQUM7WUFDRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ2xELE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNyQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixPQUFPLENBQUMsU0FBUyxJQUFJLHFCQUFxQixFQUFFLENBQUMsQ0FBQztZQUM1RSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDNUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2xCLENBQUM7UUFBQyxNQUFNLENBQUM7WUFDTCxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUM7WUFDckMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO1lBQ2xELE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxPQUFPLENBQUMsTUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFDM0QsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2xCLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNuQixpQkFBaUI7WUFDakIsTUFBTSxVQUFVLEdBQUcsTUFBTSxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUV0RCxJQUFJLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzFCLE9BQU8sQ0FBQyxHQUFHLENBQUMsOEJBQThCLENBQUMsQ0FBQztnQkFDNUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2REFBNkQsQ0FBQyxDQUFDO2dCQUMzRSxPQUFPLENBQUMsR0FBRyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7WUFDdkUsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkNBQTZDLENBQUMsQ0FBQztnQkFDM0QsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztvQkFDakMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLFNBQVMsRUFBRSxDQUFDLENBQUM7Z0JBQ3JDLENBQUM7Z0JBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO2dCQUNwRCxPQUFPLENBQUMsR0FBRyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7Z0JBQ3RFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkRBQTZELENBQUMsQ0FBQztnQkFDM0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQ3ZFLENBQUM7UUFDTCxDQUFDO2FBQU0sSUFBSSxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUNwQyw0Q0FBNEM7WUFDNUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvRUFBb0UsQ0FBQyxDQUFDO1lBRWxGLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxPQUFPLENBQUMscUNBQXFDLEVBQUUsQ0FBQztZQUUvRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQ2pDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbURBQW1ELENBQUMsQ0FBQztnQkFDakUsT0FBTztZQUNYLENBQUM7WUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsZ0JBQWdCLENBQUMsS0FBSyx5Q0FBeUMsQ0FBQyxDQUFDO1lBQ3RGLEtBQUssTUFBTSxZQUFZLElBQUksZ0JBQWdCLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQ3hELE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxZQUFZLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLENBQUM7WUFFRCxJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQzVCLE1BQU0sU0FBUyxHQUFHLE1BQU0sa0JBQWtCLENBQUMsa0NBQWtDLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUMvRixJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ2IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO29CQUM5QyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwQixDQUFDO1lBQ0wsQ0FBQztZQUVELE1BQU0sTUFBTSxHQUFHLE1BQU0sT0FBTyxDQUFDLG1DQUFtQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNqRixZQUFZLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN6QyxDQUFDO2FBQU0sSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDM0IseUJBQXlCO1lBQ3pCLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztnQkFDNUIsTUFBTSxTQUFTLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDOUUsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO29CQUNiLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztvQkFDOUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsQ0FBQztZQUNMLENBQUM7WUFFRCxNQUFNLE1BQU0sR0FBRyxNQUFNLE9BQU8sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDN0UsWUFBWSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN4RCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BCLENBQUM7QUFDTCxDQUFDO0FBRUQsc0NBQXNDO0FBQ3RDLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztJQUMxQiwwREFBMEQ7SUFDMUQsQ0FBQyxLQUFLLElBQUksRUFBRTtRQUNSLElBQUksQ0FBQztZQUNELE1BQU0sSUFBSSxFQUFFLENBQUM7UUFDakIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzNDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsQ0FBQztJQUNMLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDVCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgdHMtbm9kZVxuXG4vKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cblxuLyoqXG4gKiBBV1MgUmVzb3VyY2UgQ2xlYW51cCBTY3JpcHQgZm9yIE9uZSBPYnNlcnZhYmlsaXR5IFdvcmtzaG9wXG4gKlxuICogVGhpcyBzY3JpcHQgaWRlbnRpZmllcyBhbmQgZGVsZXRlcyBBV1MgcmVzb3VyY2VzIHRoYXQgYXJlIHRhZ2dlZCB3aXRoIHRoZSB3b3Jrc2hvcCB0YWdzXG4gKiBidXQgbWF5IG5vdCBoYXZlIGJlZW4gcHJvcGVybHkgY2xlYW5lZCB1cCB3aGVuIHN0YWNrcyB3ZXJlIGRlbGV0ZWQuXG4gKlxuICogVXNhZ2U6XG4gKiAgIG5wbSBydW4gY2xlYW51cCAtLSAtLXN0YWNrLW5hbWUgPFNUQUNLX05BTUU+XG4gKiAgIG5wbSBydW4gY2xlYW51cCAtLSAtLWRpc2NvdmVyXG4gKiAgIG5wbSBydW4gY2xlYW51cCAtLSAtLXN0YWNrLW5hbWUgPFNUQUNLX05BTUU+IC0tZHJ5LXJ1blxuICovXG5cbmltcG9ydCB7IENsb3VkV2F0Y2hMb2dzQ2xpZW50LCBEZWxldGVMb2dHcm91cENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWR3YXRjaC1sb2dzJztcbmltcG9ydCB7IEVDMkNsaWVudCwgRGVzY3JpYmVWb2x1bWVzQ29tbWFuZCwgRGVsZXRlVm9sdW1lQ29tbWFuZCwgRGVsZXRlU25hcHNob3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVjMic7XG5pbXBvcnQgeyBSRFNDbGllbnQsIERlbGV0ZURCQ2x1c3RlclNuYXBzaG90Q29tbWFuZCwgRGVsZXRlREJTbmFwc2hvdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtcmRzJztcbmltcG9ydCB7IEVDU0NsaWVudCwgRGVyZWdpc3RlclRhc2tEZWZpbml0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1lY3MnO1xuaW1wb3J0IHsgUzNDbGllbnQsIExpc3RPYmplY3RWZXJzaW9uc0NvbW1hbmQsIERlbGV0ZU9iamVjdHNDb21tYW5kLCBEZWxldGVCdWNrZXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IFJlc291cmNlR3JvdXBzVGFnZ2luZ0FQSUNsaWVudCwgR2V0UmVzb3VyY2VzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1yZXNvdXJjZS1ncm91cHMtdGFnZ2luZy1hcGknO1xuaW1wb3J0IHsgdGhyb3R0bGluZ0JhY2tPZmYgfSBmcm9tICcuL3V0aWxzL3Rocm90dGxlLWJhY2tvZmYnO1xuXG5pbnRlcmZhY2UgQ2xlYW51cE9wdGlvbnMge1xuICAgIHN0YWNrTmFtZT86IHN0cmluZztcbiAgICBkaXNjb3ZlcjogYm9vbGVhbjtcbiAgICBkcnlSdW46IGJvb2xlYW47XG4gICAgcmVnaW9uPzogc3RyaW5nO1xuICAgIHNraXBDb25maXJtYXRpb24/OiBib29sZWFuO1xuICAgIGNsZWFudXBNaXNzaW5nVGFncz86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBSZXNvdXJjZUNvdW50cyB7XG4gICAgY2xvdWR3YXRjaExvZ3M6IG51bWJlcjtcbiAgICBlYnNWb2x1bWVzOiBudW1iZXI7XG4gICAgZWJzU25hcHNob3RzOiBudW1iZXI7XG4gICAgcmRzQmFja3VwczogbnVtYmVyO1xuICAgIGVjc1Rhc2tEZWZpbml0aW9uczogbnVtYmVyO1xuICAgIHMzQnVja2V0czogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgVEFHUyA9IHtcbiAgICBlbnZpcm9ubWVudDogJ25vbi1wcm9kJyxcbiAgICBhcHBsaWNhdGlvbjogJ09uZSBPYnNlcnZhYmlsaXR5IFdvcmtzaG9wJyxcbiAgICBzdGFja05hbWU6IHByb2Nlc3MuZW52LlNUQUNLX05BTUUgfHwgJ01pc3NpbmdTdGFja05hbWUnLFxufTtcblxuY2xhc3MgV29ya3Nob3BSZXNvdXJjZUNsZWFudXAge1xuICAgIHByaXZhdGUgY2xvdWRXYXRjaExvZ3M6IENsb3VkV2F0Y2hMb2dzQ2xpZW50O1xuICAgIHByaXZhdGUgZWMyOiBFQzJDbGllbnQ7XG4gICAgcHJpdmF0ZSByZHM6IFJEU0NsaWVudDtcbiAgICBwcml2YXRlIGVjczogRUNTQ2xpZW50O1xuICAgIHByaXZhdGUgczM6IFMzQ2xpZW50O1xuICAgIHByaXZhdGUgcmVzb3VyY2VHcm91cHNUYWdnaW5nOiBSZXNvdXJjZUdyb3Vwc1RhZ2dpbmdBUElDbGllbnQ7XG4gICAgcHJpdmF0ZSByZWdpb246IHN0cmluZztcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgV09SS1NIT1BfVEFHUyA9IFRBR1M7XG5cbiAgICBjb25zdHJ1Y3RvcihyZWdpb246IHN0cmluZyA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScpIHtcbiAgICAgICAgY29uc3QgY2xpZW50Q29uZmlnID0geyByZWdpb24gfTtcbiAgICAgICAgdGhpcy5yZWdpb24gPSByZWdpb247XG5cbiAgICAgICAgdGhpcy5jbG91ZFdhdGNoTG9ncyA9IG5ldyBDbG91ZFdhdGNoTG9nc0NsaWVudChjbGllbnRDb25maWcpO1xuICAgICAgICB0aGlzLmVjMiA9IG5ldyBFQzJDbGllbnQoY2xpZW50Q29uZmlnKTtcbiAgICAgICAgdGhpcy5yZHMgPSBuZXcgUkRTQ2xpZW50KGNsaWVudENvbmZpZyk7XG4gICAgICAgIHRoaXMuZWNzID0gbmV3IEVDU0NsaWVudChjbGllbnRDb25maWcpO1xuICAgICAgICB0aGlzLnMzID0gbmV3IFMzQ2xpZW50KGNsaWVudENvbmZpZyk7XG4gICAgICAgIHRoaXMucmVzb3VyY2VHcm91cHNUYWdnaW5nID0gbmV3IFJlc291cmNlR3JvdXBzVGFnZ2luZ0FQSUNsaWVudChjbGllbnRDb25maWcpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBBV1MgYWNjb3VudCBhbmQgcmVnaW9uIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgYXN5bmMgZ2V0QXdzQWNjb3VudEluZm8oKTogUHJvbWlzZTx7IGFjY291bnRJZDogc3RyaW5nIHwgdW5kZWZpbmVkOyByZWdpb246IHN0cmluZyB9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gZ2V0IGFjY291bnQgSUQgZnJvbSBhbnkgQVdTIHJlc291cmNlIEFSTlxuICAgICAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRSZXNvdXJjZXNDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBSZXNvdXJjZXNQZXJQYWdlOiAxLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT4gdGhpcy5yZXNvdXJjZUdyb3Vwc1RhZ2dpbmcuc2VuZChjb21tYW5kKSk7XG5cbiAgICAgICAgICAgIGxldCBhY2NvdW50SWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5SZXNvdXJjZVRhZ01hcHBpbmdMaXN0ICYmIHJlc3BvbnNlLlJlc291cmNlVGFnTWFwcGluZ0xpc3QubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFybiA9IHJlc3BvbnNlLlJlc291cmNlVGFnTWFwcGluZ0xpc3RbMF0uUmVzb3VyY2VBUk47XG4gICAgICAgICAgICAgICAgaWYgKGFybikge1xuICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IGFjY291bnQgSUQgZnJvbSBBUk4gKGZvcm1hdDogYXJuOmF3czpzZXJ2aWNlOnJlZ2lvbjphY2NvdW50LWlkOnJlc291cmNlKVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhcm5QYXJ0cyA9IGFybi5zcGxpdCgnOicpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXJuUGFydHMubGVuZ3RoID49IDUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjY291bnRJZCA9IGFyblBhcnRzWzRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGFjY291bnRJZCxcbiAgICAgICAgICAgICAgICByZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGFjY291bnRJZDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIHJlZ2lvbjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGlzY292ZXIgYWxsIHVuaXF1ZSBzdGFjayBuYW1lcyBmcm9tIHJlc291cmNlcyB3aXRoIHdvcmtzaG9wIHRhZ3NcbiAgICAgKi9cbiAgICBhc3luYyBkaXNjb3ZlclN0YWNrTmFtZXMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBEaXNjb3ZlcmluZyBzdGFjayBuYW1lcyBmcm9tIGV4aXN0aW5nIHJlc291cmNlcy4uLlxcbicpO1xuXG4gICAgICAgIGNvbnN0IHN0YWNrTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gRmlyc3QsIHRyeSB0byBmaW5kIHJlc291cmNlcyB3aXRoIGJvdGggZW52aXJvbm1lbnQgQU5EIGFwcGxpY2F0aW9uIHRhZ3NcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCcgICBTZWFyY2hpbmcgZm9yIHJlc291cmNlcyB3aXRoIGJvdGggZW52aXJvbm1lbnQgYW5kIGFwcGxpY2F0aW9uIHRhZ3MuLi4nKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2VhcmNoUmVzb3VyY2VzV2l0aFRhZ3MoXG4gICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBLZXk6ICdlbnZpcm9ubWVudCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBWYWx1ZXM6IFt0aGlzLldPUktTSE9QX1RBR1MuZW52aXJvbm1lbnRdLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBLZXk6ICdhcHBsaWNhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICBWYWx1ZXM6IFt0aGlzLldPUktTSE9QX1RBR1MuYXBwbGljYXRpb25dLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgc3RhY2tOYW1lcyxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIElmIG5vIHN0YWNrIG5hbWVzIGZvdW5kLCBmYWxsYmFjayB0byBzZWFyY2hpbmcgYnkgYXBwbGljYXRpb24gdGFnIG9ubHlcbiAgICAgICAgICAgIGlmIChzdGFja05hbWVzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnICAgTm8gcmVzb3VyY2VzIGZvdW5kIHdpdGggYm90aCB0YWdzLiBGYWxsaW5nIGJhY2sgdG8gYXBwbGljYXRpb24gdGFnIG9ubHkuLi4nKTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaFJlc291cmNlc1dpdGhUYWdzKFxuICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgS2V5OiAnYXBwbGljYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFZhbHVlczogW3RoaXMuV09SS1NIT1BfVEFHUy5hcHBsaWNhdGlvbl0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICBzdGFja05hbWVzLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChzdGFja05hbWVzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnICAgTm8gd29ya3Nob3AgcmVzb3VyY2VzIGZvdW5kIHdpdGggcmVxdWlyZWQgdGFncy4nKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIEZvdW5kICR7c3RhY2tOYW1lcy5zaXplfSB1bmlxdWUgc3RhY2sgbmFtZShzKS5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBkaXNjb3ZlcmluZyBzdGFjayBuYW1lczonLCBlcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gWy4uLnN0YWNrTmFtZXNdLnNvcnQoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIZWxwZXIgbWV0aG9kIHRvIHNlYXJjaCBmb3IgcmVzb3VyY2VzIHdpdGggZ2l2ZW4gdGFnIGZpbHRlcnNcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNlYXJjaFJlc291cmNlc1dpdGhUYWdzKFxuICAgICAgICB0YWdGaWx0ZXJzOiBBcnJheTx7IEtleTogc3RyaW5nOyBWYWx1ZXM6IHN0cmluZ1tdIH0+LFxuICAgICAgICBzdGFja05hbWVzOiBTZXQ8c3RyaW5nPixcbiAgICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgbGV0IG5leHRUb2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgICBkbyB7XG4gICAgICAgICAgICBjb25zdCBjb21tYW5kV2l0aFRva2VuID0gbmV3IEdldFJlc291cmNlc0NvbW1hbmQoe1xuICAgICAgICAgICAgICAgIFRhZ0ZpbHRlcnM6IHRhZ0ZpbHRlcnMsXG4gICAgICAgICAgICAgICAgLi4uKG5leHRUb2tlbiAmJiB7IFBhZ2luYXRpb25Ub2tlbjogbmV4dFRva2VuIH0pLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT4gdGhpcy5yZXNvdXJjZUdyb3Vwc1RhZ2dpbmcuc2VuZChjb21tYW5kV2l0aFRva2VuKSk7XG5cbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5SZXNvdXJjZVRhZ01hcHBpbmdMaXN0KSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNwb25zZS5SZXNvdXJjZVRhZ01hcHBpbmdMaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEZpcnN0IHRyeSB0byBmaW5kIGV4cGxpY2l0IHN0YWNrTmFtZSB0YWdcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhY2tOYW1lVGFnID0gcmVzb3VyY2UuVGFncz8uZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICh0YWc6IHsgS2V5Pzogc3RyaW5nOyBWYWx1ZT86IHN0cmluZyB9KSA9PiB0YWcuS2V5ID09PSAnc3RhY2tOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhY2tOYW1lVGFnPy5WYWx1ZSAmJiBzdGFja05hbWVUYWcuVmFsdWUgIT09ICdNaXNzaW5nU3RhY2tOYW1lJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhY2tOYW1lcy5hZGQoc3RhY2tOYW1lVGFnLlZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiBFeHRyYWN0IHN0YWNrIG5hbWUgZnJvbSByZXNvdXJjZSBBUk4gcGF0dGVybnNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4dHJhY3RlZFN0YWNrTmFtZSA9IHRoaXMuZXh0cmFjdFN0YWNrTmFtZUZyb21Bcm4ocmVzb3VyY2UuUmVzb3VyY2VBUk4gfHwgJycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4dHJhY3RlZFN0YWNrTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YWNrTmFtZXMuYWRkKGV4dHJhY3RlZFN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5leHRUb2tlbiA9IHJlc3BvbnNlLlBhZ2luYXRpb25Ub2tlbjtcbiAgICAgICAgfSB3aGlsZSAobmV4dFRva2VuKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0IHN0YWNrIG5hbWUgZnJvbSBBUk4gd2hlbiBzdGFja05hbWUgdGFnIGlzIG1pc3NpbmdcbiAgICAgKi9cbiAgICBwcml2YXRlIGV4dHJhY3RTdGFja05hbWVGcm9tQXJuKGFybjogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKCFhcm4pIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gQ29tbW9uIHBhdHRlcm5zIGluIE9uZSBPYnNlcnZhYmlsaXR5IFdvcmtzaG9wIEFSTnM6XG4gICAgICAgIC8vIGFybjphd3M6ZWNzOnJlZ2lvbjphY2NvdW50OnRhc2stZGVmaW5pdGlvbi9EZXZNaWNyb3NlcnZpY2VzU3RhY2t0cmFmZmljZ2VuZXJhdG9ydGFza0RlZmluaXRpb241RjU3NDBERDozXG4gICAgICAgIC8vIGFybjphd3M6ZWNzOnJlZ2lvbjphY2NvdW50OnRhc2stZGVmaW5pdGlvbi9PbmVPYnNlcnZhYmlsaXR5TWljcm9zZXJ2aWNlc01pY3Jvc2VydmljZXBldGZvb2Ryc3Rhc2tEZWZpbml0aW9uNjkzMDMwRTY6MVxuXG4gICAgICAgIGNvbnN0IHBhdHRlcm5zID0gW1xuICAgICAgICAgICAgLy8gRUNTIFRhc2sgRGVmaW5pdGlvbiBwYXR0ZXJuOiBleHRyYWN0IHN0YWNrIG5hbWUgZnJvbSB0YXNrIGRlZmluaXRpb24gbmFtZVxuICAgICAgICAgICAgL3Rhc2stZGVmaW5pdGlvblxcLyhbXjpcXC9dKykvLFxuICAgICAgICAgICAgLy8gTGFtYmRhIGZ1bmN0aW9uIHBhdHRlcm46IGV4dHJhY3QgZnJvbSBmdW5jdGlvbiBuYW1lXG4gICAgICAgICAgICAvZnVuY3Rpb246KFteOl0rKS8sXG4gICAgICAgICAgICAvLyBDbG91ZFdhdGNoIGxvZyBncm91cCBwYXR0ZXJuOiBleHRyYWN0IGZyb20gbG9nIGdyb3VwIG5hbWVcbiAgICAgICAgICAgIC9sb2ctZ3JvdXA6KFteOl0rKS8sXG4gICAgICAgICAgICAvLyBTMyBidWNrZXQgcGF0dGVybjogZXh0cmFjdCBmcm9tIGJ1Y2tldCBuYW1lXG4gICAgICAgICAgICAvOjo6KFteXFwvXSspLyxcbiAgICAgICAgICAgIC8vIEVCUyB2b2x1bWUvc25hcHNob3QgcGF0dGVybjogZXh0cmFjdCBmcm9tIHRhZ3Mgb3IgbmFtZVxuICAgICAgICAgICAgL3ZvbHVtZVxcLyguKyl8c25hcHNob3RcXC8oLispLyxcbiAgICAgICAgICAgIC8vIFJEUyBwYXR0ZXJuOiBleHRyYWN0IGZyb20gREIgaWRlbnRpZmllclxuICAgICAgICAgICAgL2RiOihbXjpdKyl8Y2x1c3RlcjooW146XSspLyxcbiAgICAgICAgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXJuLm1hdGNoKHBhdHRlcm4pO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VOYW1lID0gbWF0Y2hbMV0gfHwgbWF0Y2hbMl0gfHwgbWF0Y2hbM107XG4gICAgICAgICAgICAgICAgaWYgKHJlc291cmNlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHBvdGVudGlhbCBzdGFjayBuYW1lIGZyb20gcmVzb3VyY2UgbmFtZVxuICAgICAgICAgICAgICAgICAgICAvLyBMb29rIGZvciBjb21tb24gc3RhY2sgbmFtZSBwYXR0ZXJuc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFja1BhdHRlcm5zID0gW1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gTWF0Y2ggcGF0dGVybnMgbGlrZSBcIkRldk1pY3Jvc2VydmljZXNTdGFja1wiLCBcIk9uZU9ic2VydmFiaWxpdHlNaWNyb3NlcnZpY2VzXCIsIGV0Yy5cbiAgICAgICAgICAgICAgICAgICAgICAgIC9eKERldlxcdypTdGFja3xPbmVPYnNlcnZhYmlsaXR5XFx3KikvLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gTWF0Y2ggcGF0dGVybnMgZW5kaW5nIHdpdGggXCJTdGFja1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAvXihcXHcqU3RhY2spLyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE1hdGNoIENESy1zdHlsZSBzdGFjayBuYW1lc1xuICAgICAgICAgICAgICAgICAgICAgICAgL14oW0EtWl1bYS16QS1aMC05XSpTdGFjaykvLFxuICAgICAgICAgICAgICAgICAgICBdO1xuXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc3RhY2tQYXR0ZXJuIG9mIHN0YWNrUGF0dGVybnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YWNrTWF0Y2ggPSByZXNvdXJjZU5hbWUubWF0Y2goc3RhY2tQYXR0ZXJuKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGFja01hdGNoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YWNrTWF0Y2hbMV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBJZiBubyBzdGFjayBwYXR0ZXJuIGZvdW5kLCB0cnkgdG8gZXh0cmFjdCBtZWFuaW5nZnVsIHByZWZpeFxuICAgICAgICAgICAgICAgICAgICBpZiAocmVzb3VyY2VOYW1lLmluY2x1ZGVzKCdEZXYnKSB8fCByZXNvdXJjZU5hbWUuaW5jbHVkZXMoJ09uZU9ic2VydmFiaWxpdHknKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIG5hbWVzIGxpa2UgXCJEZXZNaWNyb3NlcnZpY2VzU3RhY2t0cmFmZmljZ2VuZXJhdG9yXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZWZpeE1hdGNoID0gcmVzb3VyY2VOYW1lLm1hdGNoKC9eKERldlxcdyp8T25lT2JzZXJ2YWJpbGl0eVxcdyopLyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocHJlZml4TWF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcHJlZml4TWF0Y2hbMV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB3b3Jrc2hvcCByZXNvdXJjZXMgdXNpbmcgUmVzb3VyY2UgR3JvdXBzIEFQSVxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgZ2V0V29ya3Nob3BSZXNvdXJjZXMoXG4gICAgICAgIHJlc291cmNlVHlwZTogc3RyaW5nLFxuICAgICAgICBzdGFja05hbWU/OiBzdHJpbmcsXG4gICAgICAgIGNoZWNrTW9kZTogJ2V4YWN0JyB8ICdtaXNzaW5nLXN0YWNrbmFtZScgfCAnYXBwbGljYXRpb24tb25seScgPSAnZXhhY3QnLFxuICAgICk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBsZXQgbmV4dFRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHRhZ0ZpbHRlcnMgPSBbXTtcblxuICAgICAgICAgICAgc3dpdGNoIChjaGVja01vZGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6IHtcbiAgICAgICAgICAgICAgICAgICAgdGFnRmlsdGVycy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICAgICAgeyBLZXk6ICdlbnZpcm9ubWVudCcsIFZhbHVlczogW3RoaXMuV09SS1NIT1BfVEFHUy5lbnZpcm9ubWVudF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgS2V5OiAnYXBwbGljYXRpb24nLCBWYWx1ZXM6IFt0aGlzLldPUktTSE9QX1RBR1MuYXBwbGljYXRpb25dIH0sXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGFja05hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhZ0ZpbHRlcnMucHVzaCh7IEtleTogJ3N0YWNrTmFtZScsIFZhbHVlczogW3N0YWNrTmFtZV0gfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2FzZSAnbWlzc2luZy1zdGFja25hbWUnOiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ0ZpbHRlcnMucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgS2V5OiAnZW52aXJvbm1lbnQnLCBWYWx1ZXM6IFt0aGlzLldPUktTSE9QX1RBR1MuZW52aXJvbm1lbnRdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7IEtleTogJ2FwcGxpY2F0aW9uJywgVmFsdWVzOiBbdGhpcy5XT1JLU0hPUF9UQUdTLmFwcGxpY2F0aW9uXSB9LFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAvLyBOb3RlOiBXZSdsbCBmaWx0ZXIgb3V0IHJlc291cmNlcyBXSVRIIHN0YWNrTmFtZSBhZnRlciBnZXR0aW5nIHJlc3VsdHNcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2FzZSAnYXBwbGljYXRpb24tb25seSc6IHtcbiAgICAgICAgICAgICAgICAgICAgdGFnRmlsdGVycy5wdXNoKHsgS2V5OiAnYXBwbGljYXRpb24nLCBWYWx1ZXM6IFt0aGlzLldPUktTSE9QX1RBR1MuYXBwbGljYXRpb25dIH0pO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEdldFJlc291cmNlc0NvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZVR5cGVGaWx0ZXJzOiBbcmVzb3VyY2VUeXBlXSxcbiAgICAgICAgICAgICAgICAgICAgVGFnRmlsdGVyczogdGFnRmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgLi4uKG5leHRUb2tlbiAmJiB7IFBhZ2luYXRpb25Ub2tlbjogbmV4dFRva2VuIH0pLFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PiB0aGlzLnJlc291cmNlR3JvdXBzVGFnZ2luZy5zZW5kKGNvbW1hbmQpKTtcblxuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZS5SZXNvdXJjZVRhZ01hcHBpbmdMaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzcG9uc2UuUmVzb3VyY2VUYWdNYXBwaW5nTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXNvdXJjZS5SZXNvdXJjZUFSTikgY29udGludWU7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBtaXNzaW5nLXN0YWNrbmFtZSBtb2RlLCBmaWx0ZXIgb3V0IHJlc291cmNlcyB0aGF0IGhhdmUgdmFsaWQgc3RhY2tOYW1lXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2hlY2tNb2RlID09PSAnbWlzc2luZy1zdGFja25hbWUnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhY2tOYW1lVGFnID0gcmVzb3VyY2UuVGFncz8uZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHRhZzogeyBLZXk/OiBzdHJpbmc7IFZhbHVlPzogc3RyaW5nIH0pID0+IHRhZy5LZXkgPT09ICdzdGFja05hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YWNrTmFtZVRhZz8uVmFsdWUgJiYgc3RhY2tOYW1lVGFnLlZhbHVlICE9PSAnTWlzc2luZ1N0YWNrTmFtZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7IC8vIFNraXAgcmVzb3VyY2VzIHdpdGggdmFsaWQgc3RhY2tOYW1lXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXMucHVzaChyZXNvdXJjZS5SZXNvdXJjZUFSTik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBuZXh0VG9rZW4gPSByZXNwb25zZS5QYWdpbmF0aW9uVG9rZW47XG4gICAgICAgICAgICB9IHdoaWxlIChuZXh0VG9rZW4pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEVycm9yIGdldHRpbmcgd29ya3Nob3AgcmVzb3VyY2VzIGZvciAke3Jlc291cmNlVHlwZX06YCwgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc291cmNlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0IHJlc291cmNlIGlkZW50aWZpZXIgZnJvbSBBUk4gYmFzZWQgb24gcmVzb3VyY2UgdHlwZVxuICAgICAqL1xuICAgIHByaXZhdGUgZXh0cmFjdFJlc291cmNlSWQoYXJuOiBzdHJpbmcsIHJlc291cmNlVHlwZTogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBhcm4uc3BsaXQoJzonKTtcblxuICAgICAgICBzd2l0Y2ggKHJlc291cmNlVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnbG9nczpsb2ctZ3JvdXAnOiB7XG4gICAgICAgICAgICAgICAgLy8gYXJuOmF3czpsb2dzOnJlZ2lvbjphY2NvdW50OmxvZy1ncm91cDpOQU1FOipcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFydHMubGVuZ3RoID49IDYgPyBwYXJ0cy5zbGljZSg2KS5qb2luKCc6JykucmVwbGFjZSgvOlxcKiQvLCAnJykgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2VjMjp2b2x1bWUnOlxuICAgICAgICAgICAgY2FzZSAnZWMyOnNuYXBzaG90Jzoge1xuICAgICAgICAgICAgICAgIC8vIGFybjphd3M6ZWMyOnJlZ2lvbjphY2NvdW50OnZvbHVtZS92b2wteHh4IG9yIHNuYXBzaG90L3NuYXAteHh4XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcnRzLmxlbmd0aCA+PSA2ID8gcGFydHNbNV0uc3BsaXQoJy8nKVsxXSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAncmRzOmRiLXNuYXBzaG90JzpcbiAgICAgICAgICAgIGNhc2UgJ3JkczpjbHVzdGVyLXNuYXBzaG90Jzoge1xuICAgICAgICAgICAgICAgIC8vIGFybjphd3M6cmRzOnJlZ2lvbjphY2NvdW50OnNuYXBzaG90Om5hbWUgb3IgY2x1c3Rlci1zbmFwc2hvdDpuYW1lXG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcnRzLmxlbmd0aCA+PSA2ID8gcGFydHNbNl0gOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2Vjczp0YXNrLWRlZmluaXRpb24nOiB7XG4gICAgICAgICAgICAgICAgLy8gYXJuOmF3czplY3M6cmVnaW9uOmFjY291bnQ6dGFzay1kZWZpbml0aW9uL2ZhbWlseTpyZXZpc2lvblxuICAgICAgICAgICAgICAgIHJldHVybiBwYXJ0cy5sZW5ndGggPj0gNiA/IHBhcnRzWzVdLnNwbGl0KCcvJylbMV0gOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ3MzOmJ1Y2tldCc6IHtcbiAgICAgICAgICAgICAgICAvLyBhcm46YXdzOnMzOjo6YnVja2V0LW5hbWVcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFydHMubGVuZ3RoID49IDYgPyBwYXJ0c1s1XSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVjayBpZiByZXNvdXJjZSBoYXMgbWF0Y2hpbmcgd29ya3Nob3AgdGFncyAobGVnYWN5IG1ldGhvZCBmb3IgY29tcGF0aWJpbGl0eSlcbiAgICAgKi9cbiAgICBwcml2YXRlIGhhc1dvcmtzaG9wVGFncyhcbiAgICAgICAgdGFnczogQXJyYXk8eyBLZXk/OiBzdHJpbmc7IGtleT86IHN0cmluZzsgVmFsdWU/OiBzdHJpbmc7IHZhbHVlPzogc3RyaW5nIH0+LFxuICAgICAgICBzdGFja05hbWU/OiBzdHJpbmcsXG4gICAgICAgIGNoZWNrTW9kZTogJ2V4YWN0JyB8ICdtaXNzaW5nLXN0YWNrbmFtZScgfCAnYXBwbGljYXRpb24tb25seScgPSAnZXhhY3QnLFxuICAgICk6IGJvb2xlYW4ge1xuICAgICAgICBjb25zdCB0YWdNYXAgPSBuZXcgTWFwKHRhZ3MubWFwKCh0YWcpID0+IFt0YWcuS2V5IHx8IHRhZy5rZXksIHRhZy5WYWx1ZSB8fCB0YWcudmFsdWVdKSk7XG5cbiAgICAgICAgY29uc3QgaGFzUmVxdWlyZWRUYWdzID1cbiAgICAgICAgICAgIHRhZ01hcC5nZXQoJ2Vudmlyb25tZW50JykgPT09IHRoaXMuV09SS1NIT1BfVEFHUy5lbnZpcm9ubWVudCAmJlxuICAgICAgICAgICAgdGFnTWFwLmdldCgnYXBwbGljYXRpb24nKSA9PT0gdGhpcy5XT1JLU0hPUF9UQUdTLmFwcGxpY2F0aW9uO1xuXG4gICAgICAgIGNvbnN0IGhhc0FwcGxpY2F0aW9uVGFnID0gdGFnTWFwLmdldCgnYXBwbGljYXRpb24nKSA9PT0gdGhpcy5XT1JLU0hPUF9UQUdTLmFwcGxpY2F0aW9uO1xuICAgICAgICBjb25zdCBoYXNTdGFja05hbWVUYWcgPSB0YWdNYXAuaGFzKCdzdGFja05hbWUnKSAmJiB0YWdNYXAuZ2V0KCdzdGFja05hbWUnKSAhPT0gJ01pc3NpbmdTdGFja05hbWUnO1xuXG4gICAgICAgIHN3aXRjaCAoY2hlY2tNb2RlKSB7XG4gICAgICAgICAgICBjYXNlICdleGFjdCc6IHtcbiAgICAgICAgICAgICAgICBpZiAoc3RhY2tOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBoYXNSZXF1aXJlZFRhZ3MgJiYgdGFnTWFwLmdldCgnc3RhY2tOYW1lJykgPT09IHN0YWNrTmFtZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGhhc1JlcXVpcmVkVGFncztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnbWlzc2luZy1zdGFja25hbWUnOiB7XG4gICAgICAgICAgICAgICAgLy8gUmVzb3VyY2VzIHRoYXQgaGF2ZSB3b3Jrc2hvcCB0YWdzIGJ1dCBtaXNzaW5nIHZhbGlkIHN0YWNrTmFtZVxuICAgICAgICAgICAgICAgIHJldHVybiBoYXNSZXF1aXJlZFRhZ3MgJiYgIWhhc1N0YWNrTmFtZVRhZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnYXBwbGljYXRpb24tb25seSc6IHtcbiAgICAgICAgICAgICAgICAvLyBSZXNvdXJjZXMgdGhhdCBoYXZlIGFwcGxpY2F0aW9uIHRhZyAoZmFsbGJhY2sgbW9kZSlcbiAgICAgICAgICAgICAgICByZXR1cm4gaGFzQXBwbGljYXRpb25UYWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gaGFzUmVxdWlyZWRUYWdzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2sgZm9yIHJlc291cmNlcyB3aXRoIG1pc3Npbmcgc3RhY2tOYW1lIHRhZ3NcbiAgICAgKi9cbiAgICBhc3luYyBjaGVja0ZvclJlc291cmNlc1dpdGhNaXNzaW5nU3RhY2tOYW1lKCk6IFByb21pc2U8e1xuICAgICAgICBoYXNSZXNvdXJjZXM6IGJvb2xlYW47XG4gICAgICAgIGNvdW50OiBudW1iZXI7XG4gICAgICAgIHJlc291cmNlVHlwZXM6IHN0cmluZ1tdO1xuICAgIH0+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ/CflI0gQ2hlY2tpbmcgZm9yIHJlc291cmNlcyB3aXRoIG1pc3Npbmcgc3RhY2tOYW1lIHRhZ3MuLi5cXG4nKTtcblxuICAgICAgICBjb25zdCByZXNvdXJjZVR5cGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBsZXQgdG90YWxDb3VudCA9IDA7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIENoZWNrIENsb3VkV2F0Y2ggTG9nc1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoJyAgIPCfk4sgQ2hlY2tpbmcgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzLi4uJyk7XG4gICAgICAgICAgICBjb25zdCBjd0NvdW50ID0gYXdhaXQgdGhpcy5jb3VudFJlc291cmNlc1dpdGhNaXNzaW5nU3RhY2tOYW1lKCdsb2dzOmxvZy1ncm91cCcpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCBmb3VuZCAke2N3Q291bnR9YCk7XG4gICAgICAgICAgICBpZiAoY3dDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGVzLnB1c2goYENsb3VkV2F0Y2ggTG9nIEdyb3VwcyAoJHtjd0NvdW50fSlgKTtcbiAgICAgICAgICAgICAgICB0b3RhbENvdW50ICs9IGN3Q291bnQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIEVCUyBWb2x1bWVzXG4gICAgICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZSgnICAg8J+SviBDaGVja2luZyBFQlMgVm9sdW1lcy4uLicpO1xuICAgICAgICAgICAgY29uc3QgZWJzVm9sQ291bnQgPSBhd2FpdCB0aGlzLmNvdW50UmVzb3VyY2VzV2l0aE1pc3NpbmdTdGFja05hbWUoJ2VjMjp2b2x1bWUnKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgZm91bmQgJHtlYnNWb2xDb3VudH1gKTtcbiAgICAgICAgICAgIGlmIChlYnNWb2xDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGVzLnB1c2goYEVCUyBWb2x1bWVzICgke2Vic1ZvbENvdW50fSlgKTtcbiAgICAgICAgICAgICAgICB0b3RhbENvdW50ICs9IGVic1ZvbENvdW50O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBFQlMgU25hcHNob3RzXG4gICAgICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZSgnICAg8J+TuCBDaGVja2luZyBFQlMgU25hcHNob3RzLi4uJyk7XG4gICAgICAgICAgICBjb25zdCBlYnNTbmFwQ291bnQgPSBhd2FpdCB0aGlzLmNvdW50UmVzb3VyY2VzV2l0aE1pc3NpbmdTdGFja05hbWUoJ2VjMjpzbmFwc2hvdCcpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCBmb3VuZCAke2Vic1NuYXBDb3VudH1gKTtcbiAgICAgICAgICAgIGlmIChlYnNTbmFwQ291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlcy5wdXNoKGBFQlMgU25hcHNob3RzICgke2Vic1NuYXBDb3VudH0pYCk7XG4gICAgICAgICAgICAgICAgdG90YWxDb3VudCArPSBlYnNTbmFwQ291bnQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIFJEUyBCYWNrdXBzIChEQiBzbmFwc2hvdHMpXG4gICAgICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZSgnICAg8J+XhO+4jyBDaGVja2luZyBSRFMgQmFja3Vwcy4uLicpO1xuICAgICAgICAgICAgY29uc3QgcmRzRGF0YWJhc2VDb3VudCA9IGF3YWl0IHRoaXMuY291bnRSZXNvdXJjZXNXaXRoTWlzc2luZ1N0YWNrTmFtZSgncmRzOmRiLXNuYXBzaG90Jyk7XG4gICAgICAgICAgICBjb25zdCByZHNDbHVzdGVyQ291bnQgPSBhd2FpdCB0aGlzLmNvdW50UmVzb3VyY2VzV2l0aE1pc3NpbmdTdGFja05hbWUoJ3JkczpjbHVzdGVyLXNuYXBzaG90Jyk7XG4gICAgICAgICAgICBjb25zdCByZHNDb3VudCA9IHJkc0RhdGFiYXNlQ291bnQgKyByZHNDbHVzdGVyQ291bnQ7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgIGZvdW5kICR7cmRzQ291bnR9YCk7XG4gICAgICAgICAgICBpZiAocmRzQ291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlcy5wdXNoKGBSRFMgQmFja3VwcyAoJHtyZHNDb3VudH0pYCk7XG4gICAgICAgICAgICAgICAgdG90YWxDb3VudCArPSByZHNDb3VudDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgRUNTIFRhc2sgRGVmaW5pdGlvbnNcbiAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKCcgICDwn5OLIENoZWNraW5nIEVDUyBUYXNrIERlZmluaXRpb25zLi4uJyk7XG4gICAgICAgICAgICBjb25zdCBlY3NDb3VudCA9IGF3YWl0IHRoaXMuY291bnRSZXNvdXJjZXNXaXRoTWlzc2luZ1N0YWNrTmFtZSgnZWNzOnRhc2stZGVmaW5pdGlvbicpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCBmb3VuZCAke2Vjc0NvdW50fWApO1xuICAgICAgICAgICAgaWYgKGVjc0NvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHJlc291cmNlVHlwZXMucHVzaChgRUNTIFRhc2sgRGVmaW5pdGlvbnMgKCR7ZWNzQ291bnR9KWApO1xuICAgICAgICAgICAgICAgIHRvdGFsQ291bnQgKz0gZWNzQ291bnQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIFMzIEJ1Y2tldHNcbiAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKCcgICDwn6qjIENoZWNraW5nIFMzIEJ1Y2tldHMuLi4nKTtcbiAgICAgICAgICAgIGNvbnN0IHMzQ291bnQgPSBhd2FpdCB0aGlzLmNvdW50UmVzb3VyY2VzV2l0aE1pc3NpbmdTdGFja05hbWUoJ3MzOmJ1Y2tldCcpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCBmb3VuZCAke3MzQ291bnR9YCk7XG4gICAgICAgICAgICBpZiAoczNDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGVzLnB1c2goYFMzIEJ1Y2tldHMgKCR7czNDb3VudH0pYCk7XG4gICAgICAgICAgICAgICAgdG90YWxDb3VudCArPSBzM0NvdW50O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zb2xlLmxvZygpOyAvLyBBZGQgYmxhbmsgbGluZSBhZnRlciBwcm9ncmVzcyBpbmRpY2F0b3JzXG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaGFzUmVzb3VyY2VzOiB0b3RhbENvdW50ID4gMCxcbiAgICAgICAgICAgICAgICBjb3VudDogdG90YWxDb3VudCxcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGVzLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBjaGVja2luZyBmb3IgcmVzb3VyY2VzOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7IGhhc1Jlc291cmNlczogZmFsc2UsIGNvdW50OiAwLCByZXNvdXJjZVR5cGVzOiBbXSB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ291bnQgcmVzb3VyY2VzIHdpdGggbWlzc2luZyBzdGFja05hbWUgdGFnIHVzaW5nIFJlc291cmNlIEdyb3VwcyBBUElcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIGNvdW50UmVzb3VyY2VzV2l0aE1pc3NpbmdTdGFja05hbWUocmVzb3VyY2VUeXBlOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBhd2FpdCB0aGlzLmdldFdvcmtzaG9wUmVzb3VyY2VzKHJlc291cmNlVHlwZSwgdW5kZWZpbmVkLCAnbWlzc2luZy1zdGFja25hbWUnKTtcbiAgICAgICAgcmV0dXJuIHJlc291cmNlcy5sZW5ndGg7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2xlYW4gdXAgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzXG4gICAgICovXG4gICAgYXN5bmMgY2xlYW51cENsb3VkV2F0Y2hMb2dzKHN0YWNrTmFtZTogc3RyaW5nLCBkcnlSdW46IGJvb2xlYW4pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgICAgICBjb25zb2xlLmxvZygn8J+Xgu+4jyAgQ2xlYW5pbmcgdXAgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzLi4uJyk7XG5cbiAgICAgICAgbGV0IGRlbGV0ZWRDb3VudCA9IDA7XG4gICAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9ICdsb2dzOmxvZy1ncm91cCc7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGF3YWl0IHRoaXMuZ2V0V29ya3Nob3BSZXNvdXJjZXMocmVzb3VyY2VUeXBlLCBzdGFja05hbWUpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlQXJuIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IHRoaXMuZXh0cmFjdFJlc291cmNlSWQocmVzb3VyY2VBcm4sIHJlc291cmNlVHlwZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIWxvZ0dyb3VwTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAg4pqg77iPIENvdWxkIG5vdCBleHRyYWN0IGxvZyBncm91cCBuYW1lIGZyb20gQVJOOiAke3Jlc291cmNlQXJufWApO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoZHJ5UnVuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICBbRFJZIFJVTl0gV291bGQgZGVsZXRlIGxvZyBncm91cDogJHtsb2dHcm91cE5hbWV9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jbG91ZFdhdGNoTG9ncy5zZW5kKG5ldyBEZWxldGVMb2dHcm91cENvbW1hbmQoeyBsb2dHcm91cE5hbWUgfSkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBsb2cgZ3JvdXA6ICR7bG9nR3JvdXBOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgbG9nIGdyb3VwICR7bG9nR3JvdXBOYW1lfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWxldGVkQ291bnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBjbGVhbmluZyB1cCBDbG91ZFdhdGNoIGxvZ3M6JywgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlbGV0ZWRDb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCBFQlMgVm9sdW1lc1xuICAgICAqL1xuICAgIGFzeW5jIGNsZWFudXBFQlNWb2x1bWVzKHN0YWNrTmFtZTogc3RyaW5nLCBkcnlSdW46IGJvb2xlYW4pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgICAgICBjb25zb2xlLmxvZygn8J+SviBDbGVhbmluZyB1cCBFQlMgVm9sdW1lcy4uLicpO1xuXG4gICAgICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSAnZWMyOnZvbHVtZSc7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGF3YWl0IHRoaXMuZ2V0V29ya3Nob3BSZXNvdXJjZXMocmVzb3VyY2VUeXBlLCBzdGFja05hbWUpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlQXJuIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZvbHVtZUlkID0gdGhpcy5leHRyYWN0UmVzb3VyY2VJZChyZXNvdXJjZUFybiwgcmVzb3VyY2VUeXBlKTtcblxuICAgICAgICAgICAgICAgIGlmICghdm9sdW1lSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBDb3VsZCBub3QgZXh0cmFjdCB2b2x1bWUgSUQgZnJvbSBBUk46ICR7cmVzb3VyY2VBcm59YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHZvbHVtZSBleGlzdHMgYW5kIGlzIGF2YWlsYWJsZSAobm90IGF0dGFjaGVkKVxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlc2NyaWJlQ29tbWFuZCA9IG5ldyBEZXNjcmliZVZvbHVtZXNDb21tYW5kKHsgVm9sdW1lSWRzOiBbdm9sdW1lSWRdIH0pO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXNjcmliZVJlc3BvbnNlID0gYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT4gdGhpcy5lYzIuc2VuZChkZXNjcmliZUNvbW1hbmQpKTtcblxuICAgICAgICAgICAgICAgICAgICBjb25zdCB2b2x1bWUgPSBkZXNjcmliZVJlc3BvbnNlLlZvbHVtZXM/LlswXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF2b2x1bWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gVm9sdW1lICR7dm9sdW1lSWR9IG5vdCBmb3VuZCBpbiBkZXNjcmliZSByZXNwb25zZSwgc2tpcHBpbmdgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZvbHVtZS5TdGF0ZSAhPT0gJ2F2YWlsYWJsZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gU2tpcHBpbmcgdm9sdW1lICR7dm9sdW1lSWR9IGJlY2F1c2UgaXQgaXMgaW4gJHt2b2x1bWUuU3RhdGV9IHN0YXRlYCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yT2JqZWN0ID0gZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nOyBDb2RlPzogc3RyaW5nOyBtZXNzYWdlPzogc3RyaW5nIH07XG4gICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yT2JqZWN0Lm5hbWUgPT09ICdJbnZhbGlkVm9sdW1lLk5vdEZvdW5kJyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JPYmplY3QuQ29kZSA9PT0gJ0ludmFsaWRWb2x1bWUuTm90Rm91bmQnXG4gICAgICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBWb2x1bWUgJHt2b2x1bWVJZH0gbm8gbG9uZ2VyIGV4aXN0cywgc2tpcHBpbmdgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYCAgIOKdjCBFcnJvciBjaGVja2luZyB2b2x1bWUgJHt2b2x1bWVJZH06ICR7ZXJyb3JPYmplY3QubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpfWApO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoZHJ5UnVuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICBbRFJZIFJVTl0gV291bGQgZGVsZXRlIEVCUyB2b2x1bWU6ICR7dm9sdW1lSWR9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+IHRoaXMuZWMyLnNlbmQobmV3IERlbGV0ZVZvbHVtZUNvbW1hbmQoeyBWb2x1bWVJZDogdm9sdW1lSWQgfSkpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBFQlMgdm9sdW1lOiAke3ZvbHVtZUlkfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JPYmplY3QgPSBlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmc7IENvZGU/OiBzdHJpbmc7IG1lc3NhZ2U/OiBzdHJpbmcgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvck9iamVjdC5uYW1lID09PSAnSW52YWxpZFZvbHVtZS5Ob3RGb3VuZCcgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvck9iamVjdC5Db2RlID09PSAnSW52YWxpZFZvbHVtZS5Ob3RGb3VuZCdcbiAgICAgICAgICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gVm9sdW1lICR7dm9sdW1lSWR9IHdhcyBhbHJlYWR5IGRlbGV0ZWQsIGNvbnRpbnVpbmdgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIOKdjCBGYWlsZWQgdG8gZGVsZXRlIHZvbHVtZSAke3ZvbHVtZUlkfTogJHtlcnJvck9iamVjdC5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgY2xlYW5pbmcgdXAgRUJTIHZvbHVtZXM6JywgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlbGV0ZWRDb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCBFQlMgU25hcHNob3RzXG4gICAgICovXG4gICAgYXN5bmMgY2xlYW51cEVCU1NuYXBzaG90cyhzdGFja05hbWU6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfk7ggQ2xlYW5pbmcgdXAgRUJTIFNuYXBzaG90cy4uLicpO1xuXG4gICAgICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSAnZWMyOnNuYXBzaG90JztcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyhyZXNvdXJjZVR5cGUsIHN0YWNrTmFtZSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VBcm4gb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc25hcHNob3RJZCA9IHRoaXMuZXh0cmFjdFJlc291cmNlSWQocmVzb3VyY2VBcm4sIHJlc291cmNlVHlwZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXNuYXBzaG90SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBDb3VsZCBub3QgZXh0cmFjdCBzbmFwc2hvdCBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlbGV0ZSBFQlMgc25hcHNob3Q6ICR7c25hcHNob3RJZH1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVjMi5zZW5kKG5ldyBEZWxldGVTbmFwc2hvdENvbW1hbmQoeyBTbmFwc2hvdElkOiBzbmFwc2hvdElkIH0pKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAg4pyFIERlbGV0ZWQgRUJTIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICDinYwgRmFpbGVkIHRvIGRlbGV0ZSBzbmFwc2hvdCAke3NuYXBzaG90SWR9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCsrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGNsZWFuaW5nIHVwIEVCUyBzbmFwc2hvdHM6JywgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlbGV0ZWRDb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCBSRFMgQmFja3VwcyAoREIgU25hcHNob3RzIGFuZCBDbHVzdGVyIFNuYXBzaG90cylcbiAgICAgKi9cbiAgICBhc3luYyBjbGVhbnVwUkRTQmFja3VwcyhzdGFja05hbWU6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfl4TvuI8gIENsZWFuaW5nIHVwIFJEUyBCYWNrdXBzLi4uJyk7XG5cbiAgICAgICAgbGV0IGRlbGV0ZWRDb3VudCA9IDA7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIERCIHNuYXBzaG90c1xuICAgICAgICAgICAgY29uc3QgZGF0YWJhc2VTbmFwc2hvdFR5cGUgPSAncmRzOmRiLXNuYXBzaG90JztcbiAgICAgICAgICAgIGNvbnN0IGRhdGFiYXNlU25hcHNob3RzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyhkYXRhYmFzZVNuYXBzaG90VHlwZSwgc3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZUFybiBvZiBkYXRhYmFzZVNuYXBzaG90cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90SWQgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUlkKHJlc291cmNlQXJuLCBkYXRhYmFzZVNuYXBzaG90VHlwZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXNuYXBzaG90SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBDb3VsZCBub3QgZXh0cmFjdCBEQiBzbmFwc2hvdCBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlbGV0ZSBEQiBzbmFwc2hvdDogJHtzbmFwc2hvdElkfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmRzLnNlbmQobmV3IERlbGV0ZURCU25hcHNob3RDb21tYW5kKHsgREJTbmFwc2hvdElkZW50aWZpZXI6IHNuYXBzaG90SWQgfSkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBEQiBzbmFwc2hvdDogJHtzbmFwc2hvdElkfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgREIgc25hcHNob3QgJHtzbmFwc2hvdElkfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWxldGVkQ291bnQrKztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgREIgY2x1c3RlciBzbmFwc2hvdHNcbiAgICAgICAgICAgIGNvbnN0IGNsdXN0ZXJTbmFwc2hvdFR5cGUgPSAncmRzOmNsdXN0ZXItc25hcHNob3QnO1xuICAgICAgICAgICAgY29uc3QgY2x1c3RlclNuYXBzaG90cyA9IGF3YWl0IHRoaXMuZ2V0V29ya3Nob3BSZXNvdXJjZXMoY2x1c3RlclNuYXBzaG90VHlwZSwgc3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZUFybiBvZiBjbHVzdGVyU25hcHNob3RzKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc25hcHNob3RJZCA9IHRoaXMuZXh0cmFjdFJlc291cmNlSWQocmVzb3VyY2VBcm4sIGNsdXN0ZXJTbmFwc2hvdFR5cGUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzbmFwc2hvdElkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gQ291bGQgbm90IGV4dHJhY3QgY2x1c3RlciBzbmFwc2hvdCBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlbGV0ZSBEQiBjbHVzdGVyIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZHMuc2VuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IERlbGV0ZURCQ2x1c3RlclNuYXBzaG90Q29tbWFuZCh7IERCQ2x1c3RlclNuYXBzaG90SWRlbnRpZmllcjogc25hcHNob3RJZCB9KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBEQiBjbHVzdGVyIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICDinYwgRmFpbGVkIHRvIGRlbGV0ZSBjbHVzdGVyIHNuYXBzaG90ICR7c25hcHNob3RJZH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgY2xlYW5pbmcgdXAgUkRTIGJhY2t1cHM6JywgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlbGV0ZWRDb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCBFQ1MgVGFzayBEZWZpbml0aW9uc1xuICAgICAqL1xuICAgIGFzeW5jIGNsZWFudXBFQ1NUYXNrRGVmaW5pdGlvbnMoc3RhY2tOYW1lOiBzdHJpbmcsIGRyeVJ1bjogYm9vbGVhbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OLIENsZWFuaW5nIHVwIEVDUyBUYXNrIERlZmluaXRpb25zLi4uJyk7XG5cbiAgICAgICAgbGV0IGRlbGV0ZWRDb3VudCA9IDA7XG4gICAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9ICdlY3M6dGFzay1kZWZpbml0aW9uJztcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyhyZXNvdXJjZVR5cGUsIHN0YWNrTmFtZSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VBcm4gb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdGFza0RlZmluaXRpb24gPSByZXNvdXJjZUFybjsgLy8gRm9yIHRhc2sgZGVmaW5pdGlvbnMsIHdlIHVzZSB0aGUgZnVsbCBBUk5cblxuICAgICAgICAgICAgICAgIGlmIChkcnlSdW4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFtEUlkgUlVOXSBXb3VsZCBkZXJlZ2lzdGVyIHRhc2sgZGVmaW5pdGlvbjogJHt0YXNrRGVmaW5pdGlvbn1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVjcy5zZW5kKG5ldyBEZXJlZ2lzdGVyVGFza0RlZmluaXRpb25Db21tYW5kKHsgdGFza0RlZmluaXRpb24gfSkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVyZWdpc3RlcmVkIHRhc2sgZGVmaW5pdGlvbjogJHt0YXNrRGVmaW5pdGlvbn1gKTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIOKdjCBGYWlsZWQgdG8gZGVyZWdpc3RlciB0YXNrIGRlZmluaXRpb24gJHt0YXNrRGVmaW5pdGlvbn06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgY2xlYW5pbmcgdXAgRUNTIHRhc2sgZGVmaW5pdGlvbnM6JywgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlbGV0ZWRDb3VudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCBTMyBCdWNrZXRzICh3aXRoIGVtcHR5aW5nKVxuICAgICAqL1xuICAgIGFzeW5jIGNsZWFudXBTM0J1Y2tldHMoc3RhY2tOYW1lOiBzdHJpbmcsIGRyeVJ1bjogYm9vbGVhbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCfwn6qjIENsZWFuaW5nIHVwIFMzIEJ1Y2tldHMuLi4nKTtcblxuICAgICAgICBsZXQgZGVsZXRlZENvdW50ID0gMDtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gJ3MzOmJ1Y2tldCc7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGF3YWl0IHRoaXMuZ2V0V29ya3Nob3BSZXNvdXJjZXMocmVzb3VyY2VUeXBlLCBzdGFja05hbWUpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlQXJuIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUlkKHJlc291cmNlQXJuLCByZXNvdXJjZVR5cGUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gQ291bGQgbm90IGV4dHJhY3QgYnVja2V0IG5hbWUgZnJvbSBBUk46ICR7cmVzb3VyY2VBcm59YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChkcnlSdW4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFtEUlkgUlVOXSBXb3VsZCBlbXB0eSBhbmQgZGVsZXRlIFMzIGJ1Y2tldDogJHtidWNrZXROYW1lfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBGaXJzdCBlbXB0eSB0aGUgYnVja2V0XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmVtcHR5UzNCdWNrZXQoYnVja2V0TmFtZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZW4gZGVsZXRlIHRoZSBidWNrZXRcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+IHRoaXMuczMuc2VuZChuZXcgRGVsZXRlQnVja2V0Q29tbWFuZCh7IEJ1Y2tldDogYnVja2V0TmFtZSB9KSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKchSBEZWxldGVkIFMzIGJ1Y2tldDogJHtidWNrZXROYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgYnVja2V0ICR7YnVja2V0TmFtZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgY2xlYW5pbmcgdXAgUzMgYnVja2V0czonLCBlcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGVsZXRlZENvdW50O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVtcHR5IFMzIGJ1Y2tldCBieSBkZWxldGluZyBhbGwgb2JqZWN0cyBhbmQgdmVyc2lvbnNcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIGVtcHR5UzNCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGAgICDwn5eC77iPICBFbXB0eWluZyBTMyBidWNrZXQ6ICR7YnVja2V0TmFtZX1gKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGlzVHJ1bmNhdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGxldCBrZXlNYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGxldCB2ZXJzaW9uSWRNYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgd2hpbGUgKGlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbW1hbmQgPSBuZXcgTGlzdE9iamVjdFZlcnNpb25zQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgS2V5TWFya2VyOiBrZXlNYXJrZXIsXG4gICAgICAgICAgICAgICAgICAgIFZlcnNpb25JZE1hcmtlcjogdmVyc2lvbklkTWFya2VyLFxuICAgICAgICAgICAgICAgICAgICBNYXhLZXlzOiAxMDAwLFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdFJlc3BvbnNlID0gYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT4gdGhpcy5zMy5zZW5kKGxpc3RDb21tYW5kKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBvYmplY3RzOiBBcnJheTx7IEtleTogc3RyaW5nOyBWZXJzaW9uSWQ/OiBzdHJpbmcgfT4gPSBbXTtcblxuICAgICAgICAgICAgICAgIC8vIEFkZCBjdXJyZW50IHZlcnNpb25zXG4gICAgICAgICAgICAgICAgaWYgKGxpc3RSZXNwb25zZS5WZXJzaW9ucykge1xuICAgICAgICAgICAgICAgICAgICBvYmplY3RzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5saXN0UmVzcG9uc2UuVmVyc2lvbnMubWFwKCh2ZXJzaW9uKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEtleTogdmVyc2lvbi5LZXkhLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFZlcnNpb25JZDogdmVyc2lvbi5WZXJzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSksXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gQWRkIGRlbGV0ZSBtYXJrZXJzXG4gICAgICAgICAgICAgICAgaWYgKGxpc3RSZXNwb25zZS5EZWxldGVNYXJrZXJzKSB7XG4gICAgICAgICAgICAgICAgICAgIG9iamVjdHMucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmxpc3RSZXNwb25zZS5EZWxldGVNYXJrZXJzLm1hcCgobWFya2VyKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEtleTogbWFya2VyLktleSEsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVmVyc2lvbklkOiBtYXJrZXIuVmVyc2lvbklkLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIERlbGV0ZSBvYmplY3RzIGluIGJhdGNoZXNcbiAgICAgICAgICAgICAgICBpZiAob2JqZWN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUNvbW1hbmQgPSBuZXcgRGVsZXRlT2JqZWN0c0NvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgRGVsZXRlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0czogb2JqZWN0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBRdWlldDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+IHRoaXMuczMuc2VuZChkZWxldGVDb21tYW5kKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIERlbGV0ZWQgJHtvYmplY3RzLmxlbmd0aH0gb2JqZWN0c2ApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdFJlc3BvbnNlLklzVHJ1bmNhdGVkIHx8IGZhbHNlO1xuICAgICAgICAgICAgICAgIGtleU1hcmtlciA9IGxpc3RSZXNwb25zZS5OZXh0S2V5TWFya2VyO1xuICAgICAgICAgICAgICAgIHZlcnNpb25JZE1hcmtlciA9IGxpc3RSZXNwb25zZS5OZXh0VmVyc2lvbklkTWFya2VyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBlbXB0eSBidWNrZXQgJHtidWNrZXROYW1lfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biBjb21wbGV0ZSBjbGVhbnVwIGZvciBhIHNwZWNpZmljIHN0YWNrXG4gICAgICovXG4gICAgYXN5bmMgY2xlYW51cFN0YWNrKHN0YWNrTmFtZTogc3RyaW5nLCBkcnlSdW46IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8UmVzb3VyY2VDb3VudHM+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFxcbvCfp7kgJHtkcnlSdW4gPyAnW0RSWSBSVU5dICcgOiAnJ31DbGVhbmluZyB1cCByZXNvdXJjZXMgZm9yIHN0YWNrOiAke3N0YWNrTmFtZX1cXG5gKTtcblxuICAgICAgICBjb25zdCBjb3VudHM6IFJlc291cmNlQ291bnRzID0ge1xuICAgICAgICAgICAgY2xvdWR3YXRjaExvZ3M6IDAsXG4gICAgICAgICAgICBlYnNWb2x1bWVzOiAwLFxuICAgICAgICAgICAgZWJzU25hcHNob3RzOiAwLFxuICAgICAgICAgICAgcmRzQmFja3VwczogMCxcbiAgICAgICAgICAgIGVjc1Rhc2tEZWZpbml0aW9uczogMCxcbiAgICAgICAgICAgIHMzQnVja2V0czogMCxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDbGVhbiB1cCByZXNvdXJjZXMgaW4gcGFyYWxsZWwgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgICBjb25zdCBjbGVhbnVwUHJvbWlzZXMgPSBbXG4gICAgICAgICAgICB0aGlzLmNsZWFudXBDbG91ZFdhdGNoTG9ncyhzdGFja05hbWUsIGRyeVJ1biksXG4gICAgICAgICAgICB0aGlzLmNsZWFudXBFQlNWb2x1bWVzKHN0YWNrTmFtZSwgZHJ5UnVuKSxcbiAgICAgICAgICAgIHRoaXMuY2xlYW51cEVCU1NuYXBzaG90cyhzdGFja05hbWUsIGRyeVJ1biksXG4gICAgICAgICAgICB0aGlzLmNsZWFudXBSRFNCYWNrdXBzKHN0YWNrTmFtZSwgZHJ5UnVuKSxcbiAgICAgICAgICAgIHRoaXMuY2xlYW51cEVDU1Rhc2tEZWZpbml0aW9ucyhzdGFja05hbWUsIGRyeVJ1biksXG4gICAgICAgICAgICB0aGlzLmNsZWFudXBTM0J1Y2tldHMoc3RhY2tOYW1lLCBkcnlSdW4pLFxuICAgICAgICBdO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoY2xlYW51cFByb21pc2VzKTtcblxuICAgICAgICAgICAgY291bnRzLmNsb3Vkd2F0Y2hMb2dzID0gcmVzdWx0c1swXTtcbiAgICAgICAgICAgIGNvdW50cy5lYnNWb2x1bWVzID0gcmVzdWx0c1sxXTtcbiAgICAgICAgICAgIGNvdW50cy5lYnNTbmFwc2hvdHMgPSByZXN1bHRzWzJdO1xuICAgICAgICAgICAgY291bnRzLnJkc0JhY2t1cHMgPSByZXN1bHRzWzNdO1xuICAgICAgICAgICAgY291bnRzLmVjc1Rhc2tEZWZpbml0aW9ucyA9IHJlc3VsdHNbNF07XG4gICAgICAgICAgICBjb3VudHMuczNCdWNrZXRzID0gcmVzdWx0c1s1XTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBkdXJpbmcgY2xlYW51cDonLCBlcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY291bnRzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biBjbGVhbnVwIGZvciByZXNvdXJjZXMgd2l0aG91dCBzdGFja05hbWUgdGFnXG4gICAgICovXG4gICAgYXN5bmMgY2xlYW51cFJlc291cmNlc1dpdGhvdXRTdGFja05hbWVUYWcoZHJ5UnVuOiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPFJlc291cmNlQ291bnRzPiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBcXG7wn6e5ICR7ZHJ5UnVuID8gJ1tEUlkgUlVOXSAnIDogJyd9Q2xlYW5pbmcgdXAgcmVzb3VyY2VzIHdpdGhvdXQgdmFsaWQgc3RhY2tOYW1lIHRhZ3NcXG5gKTtcblxuICAgICAgICBjb25zdCBjb3VudHM6IFJlc291cmNlQ291bnRzID0ge1xuICAgICAgICAgICAgY2xvdWR3YXRjaExvZ3M6IDAsXG4gICAgICAgICAgICBlYnNWb2x1bWVzOiAwLFxuICAgICAgICAgICAgZWJzU25hcHNob3RzOiAwLFxuICAgICAgICAgICAgcmRzQmFja3VwczogMCxcbiAgICAgICAgICAgIGVjc1Rhc2tEZWZpbml0aW9uczogMCxcbiAgICAgICAgICAgIHMzQnVja2V0czogMCxcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgQ2xvdWRXYXRjaCBMb2dzIHdpdGhvdXQgc3RhY2tOYW1lXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+Xgu+4jyAgQ2xlYW5pbmcgdXAgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzIHdpdGhvdXQgc3RhY2tOYW1lLi4uJyk7XG4gICAgICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSAnbG9nczpsb2ctZ3JvdXAnO1xuICAgICAgICAgICAgY29uc3QgbG9nR3JvdXBzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyhyZXNvdXJjZVR5cGUsIHVuZGVmaW5lZCwgJ21pc3Npbmctc3RhY2tuYW1lJyk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VBcm4gb2YgbG9nR3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbG9nR3JvdXBOYW1lID0gdGhpcy5leHRyYWN0UmVzb3VyY2VJZChyZXNvdXJjZUFybiwgcmVzb3VyY2VUeXBlKTtcblxuICAgICAgICAgICAgICAgIGlmICghbG9nR3JvdXBOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gQ291bGQgbm90IGV4dHJhY3QgbG9nIGdyb3VwIG5hbWUgZnJvbSBBUk46ICR7cmVzb3VyY2VBcm59YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChkcnlSdW4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFtEUlkgUlVOXSBXb3VsZCBkZWxldGUgbG9nIGdyb3VwOiAke2xvZ0dyb3VwTmFtZX1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNsb3VkV2F0Y2hMb2dzLnNlbmQobmV3IERlbGV0ZUxvZ0dyb3VwQ29tbWFuZCh7IGxvZ0dyb3VwTmFtZSB9KSksXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKchSBEZWxldGVkIGxvZyBncm91cDogJHtsb2dHcm91cE5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICDinYwgRmFpbGVkIHRvIGRlbGV0ZSBsb2cgZ3JvdXAgJHtsb2dHcm91cE5hbWV9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvdW50cy5jbG91ZHdhdGNoTG9ncysrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCBFQlMgVm9sdW1lcyB3aXRob3V0IHN0YWNrTmFtZVxuICAgICAgICAgICAgY29uc29sZS5sb2coJ/Cfkr4gQ2xlYW5pbmcgdXAgRUJTIFZvbHVtZXMgd2l0aG91dCBzdGFja05hbWUuLi4nKTtcbiAgICAgICAgICAgIGNvbnN0IHZvbHVtZVR5cGUgPSAnZWMyOnZvbHVtZSc7XG4gICAgICAgICAgICBjb25zdCB2b2x1bWVzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyh2b2x1bWVUeXBlLCB1bmRlZmluZWQsICdtaXNzaW5nLXN0YWNrbmFtZScpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlQXJuIG9mIHZvbHVtZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2b2x1bWVJZCA9IHRoaXMuZXh0cmFjdFJlc291cmNlSWQocmVzb3VyY2VBcm4sIHZvbHVtZVR5cGUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCF2b2x1bWVJZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAg4pqg77iPIENvdWxkIG5vdCBleHRyYWN0IHZvbHVtZSBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdm9sdW1lIGV4aXN0cyBhbmQgaXMgYXZhaWxhYmxlIChub3QgYXR0YWNoZWQpXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpYmVDb21tYW5kID0gbmV3IERlc2NyaWJlVm9sdW1lc0NvbW1hbmQoeyBWb2x1bWVJZHM6IFt2b2x1bWVJZF0gfSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlc2NyaWJlUmVzcG9uc2UgPSBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PiB0aGlzLmVjMi5zZW5kKGRlc2NyaWJlQ29tbWFuZCkpO1xuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZvbHVtZSA9IGRlc2NyaWJlUmVzcG9uc2UuVm9sdW1lcz8uWzBdO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXZvbHVtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBWb2x1bWUgJHt2b2x1bWVJZH0gbm90IGZvdW5kIGluIGRlc2NyaWJlIHJlc3BvbnNlLCBza2lwcGluZ2ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBpZiAodm9sdW1lLlN0YXRlICE9PSAnYXZhaWxhYmxlJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBTa2lwcGluZyB2b2x1bWUgJHt2b2x1bWVJZH0gYmVjYXVzZSBpdCBpcyBpbiAke3ZvbHVtZS5TdGF0ZX0gc3RhdGVgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JPYmplY3QgPSBlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmc7IENvZGU/OiBzdHJpbmc7IG1lc3NhZ2U/OiBzdHJpbmcgfTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JPYmplY3QubmFtZSA9PT0gJ0ludmFsaWRWb2x1bWUuTm90Rm91bmQnIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvck9iamVjdC5Db2RlID09PSAnSW52YWxpZFZvbHVtZS5Ob3RGb3VuZCdcbiAgICAgICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAg4pqg77iPIFZvbHVtZSAke3ZvbHVtZUlkfSBubyBsb25nZXIgZXhpc3RzLCBza2lwcGluZ2ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgICAg4p2MIEVycm9yIGNoZWNraW5nIHZvbHVtZSAke3ZvbHVtZUlkfTogJHtlcnJvck9iamVjdC5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChkcnlSdW4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFtEUlkgUlVOXSBXb3VsZCBkZWxldGUgRUJTIHZvbHVtZTogJHt2b2x1bWVJZH1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhyb3R0bGluZ0JhY2tPZmYoKCkgPT4gdGhpcy5lYzIuc2VuZChuZXcgRGVsZXRlVm9sdW1lQ29tbWFuZCh7IFZvbHVtZUlkOiB2b2x1bWVJZCB9KSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKchSBEZWxldGVkIEVCUyB2b2x1bWU6ICR7dm9sdW1lSWR9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck9iamVjdCA9IGVycm9yIGFzIHsgbmFtZT86IHN0cmluZzsgQ29kZT86IHN0cmluZzsgbWVzc2FnZT86IHN0cmluZyB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yT2JqZWN0Lm5hbWUgPT09ICdJbnZhbGlkVm9sdW1lLk5vdEZvdW5kJyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yT2JqZWN0LkNvZGUgPT09ICdJbnZhbGlkVm9sdW1lLk5vdEZvdW5kJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBWb2x1bWUgJHt2b2x1bWVJZH0gd2FzIGFscmVhZHkgZGVsZXRlZCwgY29udGludWluZ2ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgdm9sdW1lICR7dm9sdW1lSWR9OiAke2Vycm9yT2JqZWN0Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb3VudHMuZWJzVm9sdW1lcysrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCBFQlMgU25hcHNob3RzIHdpdGhvdXQgc3RhY2tOYW1lXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+TuCBDbGVhbmluZyB1cCBFQlMgU25hcHNob3RzIHdpdGhvdXQgc3RhY2tOYW1lLi4uJyk7XG4gICAgICAgICAgICBjb25zdCBzbmFwc2hvdFR5cGUgPSAnZWMyOnNuYXBzaG90JztcbiAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90cyA9IGF3YWl0IHRoaXMuZ2V0V29ya3Nob3BSZXNvdXJjZXMoc25hcHNob3RUeXBlLCB1bmRlZmluZWQsICdtaXNzaW5nLXN0YWNrbmFtZScpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlQXJuIG9mIHNuYXBzaG90cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90SWQgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUlkKHJlc291cmNlQXJuLCBzbmFwc2hvdFR5cGUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzbmFwc2hvdElkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gQ291bGQgbm90IGV4dHJhY3Qgc25hcHNob3QgSUQgZnJvbSBBUk46ICR7cmVzb3VyY2VBcm59YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChkcnlSdW4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFtEUlkgUlVOXSBXb3VsZCBkZWxldGUgRUJTIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lYzIuc2VuZChuZXcgRGVsZXRlU25hcHNob3RDb21tYW5kKHsgU25hcHNob3RJZDogc25hcHNob3RJZCB9KSksXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKchSBEZWxldGVkIEVCUyBzbmFwc2hvdDogJHtzbmFwc2hvdElkfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgc25hcHNob3QgJHtzbmFwc2hvdElkfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb3VudHMuZWJzU25hcHNob3RzKys7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENsZWFuIHVwIFJEUyBCYWNrdXBzIHdpdGhvdXQgc3RhY2tOYW1lXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+XhO+4jyAgQ2xlYW5pbmcgdXAgUkRTIEJhY2t1cHMgd2l0aG91dCBzdGFja05hbWUuLi4nKTtcblxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgREIgc25hcHNob3RzXG4gICAgICAgICAgICBjb25zdCBkYXRhYmFzZVNuYXBzaG90VHlwZSA9ICdyZHM6ZGItc25hcHNob3QnO1xuICAgICAgICAgICAgY29uc3QgZGF0YWJhc2VTbmFwc2hvdHMgPSBhd2FpdCB0aGlzLmdldFdvcmtzaG9wUmVzb3VyY2VzKFxuICAgICAgICAgICAgICAgIGRhdGFiYXNlU25hcHNob3RUeXBlLFxuICAgICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAnbWlzc2luZy1zdGFja25hbWUnLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZUFybiBvZiBkYXRhYmFzZVNuYXBzaG90cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90SWQgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUlkKHJlc291cmNlQXJuLCBkYXRhYmFzZVNuYXBzaG90VHlwZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXNuYXBzaG90SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKaoO+4jyBDb3VsZCBub3QgZXh0cmFjdCBEQiBzbmFwc2hvdCBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlbGV0ZSBEQiBzbmFwc2hvdDogJHtzbmFwc2hvdElkfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmRzLnNlbmQobmV3IERlbGV0ZURCU25hcHNob3RDb21tYW5kKHsgREJTbmFwc2hvdElkZW50aWZpZXI6IHNuYXBzaG90SWQgfSkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBEQiBzbmFwc2hvdDogJHtzbmFwc2hvdElkfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZWxldGUgREIgc25hcHNob3QgJHtzbmFwc2hvdElkfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb3VudHMucmRzQmFja3VwcysrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCBEQiBjbHVzdGVyIHNuYXBzaG90c1xuICAgICAgICAgICAgY29uc3QgY2x1c3RlclNuYXBzaG90VHlwZSA9ICdyZHM6Y2x1c3Rlci1zbmFwc2hvdCc7XG4gICAgICAgICAgICBjb25zdCBjbHVzdGVyU25hcHNob3RzID0gYXdhaXQgdGhpcy5nZXRXb3Jrc2hvcFJlc291cmNlcyhcbiAgICAgICAgICAgICAgICBjbHVzdGVyU25hcHNob3RUeXBlLFxuICAgICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAnbWlzc2luZy1zdGFja25hbWUnLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZUFybiBvZiBjbHVzdGVyU25hcHNob3RzKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc25hcHNob3RJZCA9IHRoaXMuZXh0cmFjdFJlc291cmNlSWQocmVzb3VyY2VBcm4sIGNsdXN0ZXJTbmFwc2hvdFR5cGUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzbmFwc2hvdElkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDimqDvuI8gQ291bGQgbm90IGV4dHJhY3QgY2x1c3RlciBzbmFwc2hvdCBJRCBmcm9tIEFSTjogJHtyZXNvdXJjZUFybn1gKTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlbGV0ZSBEQiBjbHVzdGVyIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRocm90dGxpbmdCYWNrT2ZmKCgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZHMuc2VuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IERlbGV0ZURCQ2x1c3RlclNuYXBzaG90Q29tbWFuZCh7IERCQ2x1c3RlclNuYXBzaG90SWRlbnRpZmllcjogc25hcHNob3RJZCB9KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBEQiBjbHVzdGVyIHNuYXBzaG90OiAke3NuYXBzaG90SWR9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICDinYwgRmFpbGVkIHRvIGRlbGV0ZSBjbHVzdGVyIHNuYXBzaG90ICR7c25hcHNob3RJZH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY291bnRzLnJkc0JhY2t1cHMrKztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgRUNTIFRhc2sgRGVmaW5pdGlvbnMgd2l0aG91dCBzdGFja05hbWVcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5OLIENsZWFuaW5nIHVwIEVDUyBUYXNrIERlZmluaXRpb25zIHdpdGhvdXQgc3RhY2tOYW1lLi4uJyk7XG4gICAgICAgICAgICBjb25zdCB0YXNrRGVmaW5pdGlvblR5cGUgPSAnZWNzOnRhc2stZGVmaW5pdGlvbic7XG4gICAgICAgICAgICBjb25zdCB0YXNrRGVmaW5pdGlvbnMgPSBhd2FpdCB0aGlzLmdldFdvcmtzaG9wUmVzb3VyY2VzKHRhc2tEZWZpbml0aW9uVHlwZSwgdW5kZWZpbmVkLCAnbWlzc2luZy1zdGFja25hbWUnKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZUFybiBvZiB0YXNrRGVmaW5pdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0YXNrRGVmaW5pdGlvbiA9IHJlc291cmNlQXJuOyAvLyBGb3IgdGFzayBkZWZpbml0aW9ucywgd2UgdXNlIHRoZSBmdWxsIEFSTlxuXG4gICAgICAgICAgICAgICAgaWYgKGRyeVJ1bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgW0RSWSBSVU5dIFdvdWxkIGRlcmVnaXN0ZXIgdGFzayBkZWZpbml0aW9uOiAke3Rhc2tEZWZpbml0aW9ufWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZWNzLnNlbmQobmV3IERlcmVnaXN0ZXJUYXNrRGVmaW5pdGlvbkNvbW1hbmQoeyB0YXNrRGVmaW5pdGlvbiB9KSksXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKchSBEZXJlZ2lzdGVyZWQgdGFzayBkZWZpbml0aW9uOiAke3Rhc2tEZWZpbml0aW9ufWApO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4p2MIEZhaWxlZCB0byBkZXJlZ2lzdGVyIHRhc2sgZGVmaW5pdGlvbiAke3Rhc2tEZWZpbml0aW9ufTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb3VudHMuZWNzVGFza0RlZmluaXRpb25zKys7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENsZWFuIHVwIFMzIEJ1Y2tldHMgd2l0aG91dCBzdGFja05hbWVcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn6qjIENsZWFuaW5nIHVwIFMzIEJ1Y2tldHMgd2l0aG91dCBzdGFja05hbWUuLi4nKTtcbiAgICAgICAgICAgIGNvbnN0IGJ1Y2tldFR5cGUgPSAnczM6YnVja2V0JztcbiAgICAgICAgICAgIGNvbnN0IGJ1Y2tldHMgPSBhd2FpdCB0aGlzLmdldFdvcmtzaG9wUmVzb3VyY2VzKGJ1Y2tldFR5cGUsIHVuZGVmaW5lZCwgJ21pc3Npbmctc3RhY2tuYW1lJyk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VBcm4gb2YgYnVja2V0cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUlkKHJlc291cmNlQXJuLCBidWNrZXRUeXBlKTtcblxuICAgICAgICAgICAgICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgICAg4pqg77iPIENvdWxkIG5vdCBleHRyYWN0IGJ1Y2tldCBuYW1lIGZyb20gQVJOOiAke3Jlc291cmNlQXJufWApO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoZHJ5UnVuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICBbRFJZIFJVTl0gV291bGQgZW1wdHkgYW5kIGRlbGV0ZSBTMyBidWNrZXQ6ICR7YnVja2V0TmFtZX1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRmlyc3QgZW1wdHkgdGhlIGJ1Y2tldFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5lbXB0eVMzQnVja2V0KGJ1Y2tldE5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGVuIGRlbGV0ZSB0aGUgYnVja2V0XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aHJvdHRsaW5nQmFja09mZigoKSA9PiB0aGlzLnMzLnNlbmQobmV3IERlbGV0ZUJ1Y2tldENvbW1hbmQoeyBCdWNrZXQ6IGJ1Y2tldE5hbWUgfSkpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDinIUgRGVsZXRlZCBTMyBidWNrZXQ6ICR7YnVja2V0TmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIOKdjCBGYWlsZWQgdG8gZGVsZXRlIGJ1Y2tldCAke2J1Y2tldE5hbWV9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvdW50cy5zM0J1Y2tldHMrKztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGNvdW50cztcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBkdXJpbmcgY2xlYW51cCBvZiByZXNvdXJjZXMgd2l0aG91dCBzdGFja05hbWU6JywgZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuIGNvdW50cztcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBQYXJzZSBjb21tYW5kIGxpbmUgYXJndW1lbnRzXG4gKi9cbmZ1bmN0aW9uIHBhcnNlQXJndW1lbnRzKCk6IENsZWFudXBPcHRpb25zIHtcbiAgICBjb25zdCBhcmd1bWVudHNfID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpO1xuICAgIGNvbnN0IG9wdGlvbnM6IENsZWFudXBPcHRpb25zID0ge1xuICAgICAgICBkaXNjb3ZlcjogZmFsc2UsXG4gICAgICAgIGRyeVJ1bjogZmFsc2UsXG4gICAgfTtcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhcmd1bWVudHNfLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICBjb25zdCBhcmd1bWVudCA9IGFyZ3VtZW50c19baW5kZXhdO1xuXG4gICAgICAgIHN3aXRjaCAoYXJndW1lbnQpIHtcbiAgICAgICAgICAgIGNhc2UgJy0tc3RhY2stbmFtZSc6IHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLnN0YWNrTmFtZSA9IGFyZ3VtZW50c19bKytpbmRleF07XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICctLWRpc2NvdmVyJzoge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuZGlzY292ZXIgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSAnLS1kcnktcnVuJzoge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuZHJ5UnVuID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJy0tcmVnaW9uJzoge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMucmVnaW9uID0gYXJndW1lbnRzX1srK2luZGV4XTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJy0tc2tpcC1jb25maXJtYXRpb24nOiB7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy5za2lwQ29uZmlybWF0aW9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJy0tY2xlYW51cC1taXNzaW5nLXRhZ3MnOiB7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy5jbGVhbnVwTWlzc2luZ1RhZ3MgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSAnLS1oZWxwJzoge1xuICAgICAgICAgICAgICAgIHNob3dIZWxwKCk7XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDApO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgIGlmIChhcmd1bWVudC5zdGFydHNXaXRoKCctLScpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBVbmtub3duIG9wdGlvbjogJHthcmd1bWVudH1gKTtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0hlbHAoKTtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvcHRpb25zO1xufVxuXG4vKipcbiAqIFNob3cgaGVscCBtZXNzYWdlXG4gKi9cbmZ1bmN0aW9uIHNob3dIZWxwKCk6IHZvaWQge1xuICAgIGNvbnNvbGUubG9nKGBcbvCfp7kgQVdTIFJlc291cmNlIENsZWFudXAgU2NyaXB0IGZvciBPbmUgT2JzZXJ2YWJpbGl0eSBXb3Jrc2hvcFxuXG5VU0FHRTpcbiAgICBucG0gcnVuIGNsZWFudXAgLS0gW09QVElPTlNdXG5cbk9QVElPTlM6XG4gICAgLS1zdGFjay1uYW1lIDxuYW1lPiAgICAgICBTcGVjaWZpYyBzdGFjayBuYW1lIHRvIGNsZWFuIHVwXG4gICAgLS1kaXNjb3ZlciAgICAgICAgICAgICAgICBMaXN0IGFsbCBmb3VuZCB3b3Jrc2hvcCBzdGFjayBuYW1lc1xuICAgIC0tZHJ5LXJ1biAgICAgICAgICAgICAgICAgUHJldmlldyB3aGF0IHdvdWxkIGJlIGRlbGV0ZWQgKHJlY29tbWVuZGVkKVxuICAgIC0tcmVnaW9uIDxyZWdpb24+ICAgICAgICAgQVdTIHJlZ2lvbiAoZGVmYXVsdDogdXMtZWFzdC0xIG9yIEFXU19SRUdJT04pXG4gICAgLS1jbGVhbnVwLW1pc3NpbmctdGFncyAgICBDbGVhbiB1cCByZXNvdXJjZXMgd2l0aG91dCB2YWxpZCBzdGFja05hbWUgdGFnc1xuICAgIC0tc2tpcC1jb25maXJtYXRpb24gICAgICAgU2tpcCBjb25maXJtYXRpb24gcHJvbXB0cyAodXNlIHdpdGggY2F1dGlvbilcbiAgICAtLWhlbHAgICAgICAgICAgICAgICAgICAgIFNob3cgdGhpcyBoZWxwIG1lc3NhZ2VcblxuRVhBTVBMRVM6XG4gICAgIyBEaXNjb3ZlciBhbGwgd29ya3Nob3Agc3RhY2sgbmFtZXNcbiAgICBucG0gcnVuIGNsZWFudXAgLS0gLS1kaXNjb3ZlclxuXG4gICAgIyBQcmV2aWV3IGNsZWFudXAgZm9yIGEgc3BlY2lmaWMgc3RhY2sgKFJFQ09NTUVOREVEIEZJUlNUIFNURVApXG4gICAgbnBtIHJ1biBjbGVhbnVwIC0tIC0tc3RhY2stbmFtZSBNeVdvcmtzaG9wU3RhY2sgLS1kcnktcnVuXG5cbiAgICAjIEFjdHVhbGx5IHBlcmZvcm0gdGhlIGNsZWFudXBcbiAgICBucG0gcnVuIGNsZWFudXAgLS0gLS1zdGFjay1uYW1lIE15V29ya3Nob3BTdGFja1xuXG4gICAgIyBDbGVhbiB1cCByZXNvdXJjZXMgd2l0aG91dCB2YWxpZCBzdGFja05hbWUgdGFnc1xuICAgIG5wbSBydW4gY2xlYW51cCAtLSAtLWNsZWFudXAtbWlzc2luZy10YWdzIC0tZHJ5LXJ1blxuXG4gICAgIyBDbGVhbiB1cCBpbiBhIHNwZWNpZmljIHJlZ2lvblxuICAgIG5wbSBydW4gY2xlYW51cCAtLSAtLXN0YWNrLW5hbWUgTXlXb3Jrc2hvcFN0YWNrIC0tcmVnaW9uIHVzLXdlc3QtMlxuXG7imqDvuI8gIFNBRkVUWSBOT1RJQ0U6XG4gICAgVGhpcyBzY3JpcHQgcGVyZm9ybXMgZGVzdHJ1Y3RpdmUgb3BlcmF0aW9ucyB0aGF0IGNhbm5vdCBiZSB1bmRvbmUhXG4gICAgQWx3YXlzIHJ1biB3aXRoIC0tZHJ5LXJ1biBmaXJzdCB0byBzZWUgd2hhdCB3b3VsZCBiZSBkZWxldGVkLlxuYCk7XG59XG5cbi8qKlxuICogUHJpbnQgc3VtbWFyeSByZXBvcnRcbiAqL1xuZnVuY3Rpb24gcHJpbnRTdW1tYXJ5KGNvdW50czogUmVzb3VyY2VDb3VudHMsIGRyeVJ1bjogYm9vbGVhbik6IHZvaWQge1xuICAgIGNvbnN0IHRvdGFsID0gT2JqZWN0LnZhbHVlcyhjb3VudHMpLnJlZHVjZSgoc3VtLCBjb3VudCkgPT4gc3VtICsgY291bnQsIDApO1xuXG4gICAgY29uc29sZS5sb2coYFxcbvCfk4ogJHtkcnlSdW4gPyAnW0RSWSBSVU5dICcgOiAnJ31DbGVhbnVwIFN1bW1hcnk6YCk7XG4gICAgY29uc29sZS5sb2coYCAgIENsb3VkV2F0Y2ggTG9nIEdyb3VwczogJHtjb3VudHMuY2xvdWR3YXRjaExvZ3N9YCk7XG4gICAgY29uc29sZS5sb2coYCAgIEVCUyBWb2x1bWVzOiAke2NvdW50cy5lYnNWb2x1bWVzfWApO1xuICAgIGNvbnNvbGUubG9nKGAgICBFQlMgU25hcHNob3RzOiAke2NvdW50cy5lYnNTbmFwc2hvdHN9YCk7XG4gICAgY29uc29sZS5sb2coYCAgIFJEUyBCYWNrdXBzOiAke2NvdW50cy5yZHNCYWNrdXBzfWApO1xuICAgIGNvbnNvbGUubG9nKGAgICBFQ1MgVGFzayBEZWZpbml0aW9uczogJHtjb3VudHMuZWNzVGFza0RlZmluaXRpb25zfWApO1xuICAgIGNvbnNvbGUubG9nKGAgICBTMyBCdWNrZXRzOiAke2NvdW50cy5zM0J1Y2tldHN9YCk7XG4gICAgY29uc29sZS5sb2coYCAgIFRvdGFsIFJlc291cmNlczogJHt0b3RhbH1gKTtcblxuICAgIGlmICh0b3RhbCA9PT0gMCkge1xuICAgICAgICBjb25zb2xlLmxvZygnXFxu4pyoIE5vIHJlc291cmNlcyBmb3VuZCB0byBjbGVhbiB1cCEnKTtcbiAgICB9IGVsc2UgaWYgKGRyeVJ1bikge1xuICAgICAgICBjb25zb2xlLmxvZyhgXFxu4pqg77iPICBUaGlzIHdhcyBhIGRyeSBydW4uIFRvIGFjdHVhbGx5IGRlbGV0ZSB0aGVzZSAke3RvdGFsfSByZXNvdXJjZXMsIHJ1biB3aXRob3V0IC0tZHJ5LXJ1bmApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBcXG7inIUgU3VjY2Vzc2Z1bGx5IGNsZWFuZWQgdXAgJHt0b3RhbH0gcmVzb3VyY2VzIWApO1xuICAgIH1cbn1cblxuLyoqXG4gKiBQcm9tcHQgZm9yIHVzZXIgY29uZmlybWF0aW9uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHByb21wdENvbmZpcm1hdGlvbihzdGFja05hbWU6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGRyeVJ1bikgcmV0dXJuIHRydWU7XG5cbiAgICBjb25zdCB7IGNyZWF0ZUludGVyZmFjZSB9ID0gYXdhaXQgaW1wb3J0KCdub2RlOnJlYWRsaW5lJyk7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlYWRsaW5lID0gY3JlYXRlSW50ZXJmYWNlKHtcbiAgICAgICAgICAgIGlucHV0OiBwcm9jZXNzLnN0ZGluLFxuICAgICAgICAgICAgb3V0cHV0OiBwcm9jZXNzLnN0ZG91dCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVhZGxpbmUucXVlc3Rpb24oXG4gICAgICAgICAgICBgXFxu4pqg77iPICBZb3UgYXJlIGFib3V0IHRvIERFTEVURSByZXNvdXJjZXMgZm9yIHN0YWNrIFwiJHtzdGFja05hbWV9XCIuIFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUhXFxuYCArXG4gICAgICAgICAgICAgICAgJ1R5cGUgXCJ5ZXNcIiB0byBjb250aW51ZSBvciBhbnl0aGluZyBlbHNlIHRvIGNhbmNlbDogJyxcbiAgICAgICAgICAgIChhbnN3ZXI6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgICAgIHJlYWRsaW5lLmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShhbnN3ZXIudG9Mb3dlckNhc2UoKSA9PT0gJ3llcycpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBNYWluIGV4ZWN1dGlvbiBmdW5jdGlvblxuICovXG5hc3luYyBmdW5jdGlvbiBtYWluKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBwYXJzZUFyZ3VtZW50cygpO1xuXG4gICAgICAgIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgICAgICAgaWYgKCFvcHRpb25zLmRpc2NvdmVyICYmICFvcHRpb25zLnN0YWNrTmFtZSAmJiAhb3B0aW9ucy5jbGVhbnVwTWlzc2luZ1RhZ3MpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvcjogTXVzdCBwcm92aWRlIGVpdGhlciAtLXN0YWNrLW5hbWUgPG5hbWU+LCAtLWRpc2NvdmVyLCBvciAtLWNsZWFudXAtbWlzc2luZy10YWdzJyk7XG4gICAgICAgICAgICBzaG93SGVscCgpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coJ/Cfp7kgQVdTIFJlc291cmNlIENsZWFudXAgU2NyaXB0IGZvciBPbmUgT2JzZXJ2YWJpbGl0eSBXb3Jrc2hvcFxcbicpO1xuXG4gICAgICAgIC8vIEluaXRpYWxpemUgY2xlYW51cCBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IGNsZWFudXAgPSBuZXcgV29ya3Nob3BSZXNvdXJjZUNsZWFudXAob3B0aW9ucy5yZWdpb24pO1xuXG4gICAgICAgIC8vIERpc3BsYXkgQVdTIGFjY291bnQgYW5kIHJlZ2lvbiBpbmZvcm1hdGlvblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgYXdzSW5mbyA9IGF3YWl0IGNsZWFudXAuZ2V0QXdzQWNjb3VudEluZm8oKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5ONIEFXUyBDb25maWd1cmF0aW9uOicpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIEFjY291bnQgSUQ6ICR7YXdzSW5mby5hY2NvdW50SWQgfHwgJ1VuYWJsZSB0byBkZXRlcm1pbmUnfWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFJlZ2lvbjogJHthd3NJbmZvLnJlZ2lvbn1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ/Cfk40gQVdTIENvbmZpZ3VyYXRpb246Jyk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgQWNjb3VudCBJRDogVW5hYmxlIHRvIGRldGVybWluZWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIFJlZ2lvbjogJHtvcHRpb25zLnJlZ2lvbiB8fCAndXMtZWFzdC0xJ31gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAob3B0aW9ucy5kaXNjb3Zlcikge1xuICAgICAgICAgICAgLy8gRGlzY292ZXJ5IG1vZGVcbiAgICAgICAgICAgIGNvbnN0IHN0YWNrTmFtZXMgPSBhd2FpdCBjbGVhbnVwLmRpc2NvdmVyU3RhY2tOYW1lcygpO1xuXG4gICAgICAgICAgICBpZiAoc3RhY2tOYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gd29ya3Nob3AgcmVzb3VyY2VzIGZvdW5kLicpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdcXG5UbyBjbGVhbiB1cCByZXNvdXJjZXMgd2l0aG91dCBwcm9wZXIgc3RhY2tOYW1lIHRhZ3MsIHJ1bjonKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnbnBtIHJ1biBjbGVhbnVwIC0tIC0tY2xlYW51cC1taXNzaW5nLXRhZ3MgLS1kcnktcnVuJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdcXG5Gb3VuZCB0aGUgZm9sbG93aW5nIHdvcmtzaG9wIHN0YWNrIG5hbWVzOicpO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc3RhY2tOYW1lIG9mIHN0YWNrTmFtZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAgIOKAoiAke3N0YWNrTmFtZX1gKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnXFxuVG8gY2xlYW4gdXAgYSBzcGVjaWZpYyBzdGFjaywgcnVuOicpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCducG0gcnVuIGNsZWFudXAgLS0gLS1zdGFjay1uYW1lIDxTVEFDS19OQU1FPiAtLWRyeS1ydW4nKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnXFxuVG8gY2xlYW4gdXAgcmVzb3VyY2VzIHdpdGhvdXQgcHJvcGVyIHN0YWNrTmFtZSB0YWdzLCBydW46Jyk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ25wbSBydW4gY2xlYW51cCAtLSAtLWNsZWFudXAtbWlzc2luZy10YWdzIC0tZHJ5LXJ1bicpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnMuY2xlYW51cE1pc3NpbmdUYWdzKSB7XG4gICAgICAgICAgICAvLyBDbGVhbiB1cCByZXNvdXJjZXMgd2l0aG91dCBzdGFja05hbWUgdGFnc1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0NoZWNraW5nIGZvciByZXNvdXJjZXMgd2l0aCBtaXNzaW5nIG9yIGludmFsaWQgc3RhY2tOYW1lIHRhZ3MuLi5cXG4nKTtcblxuICAgICAgICAgICAgY29uc3QgbWlzc2luZ1RhZ3NDaGVjayA9IGF3YWl0IGNsZWFudXAuY2hlY2tGb3JSZXNvdXJjZXNXaXRoTWlzc2luZ1N0YWNrTmFtZSgpO1xuXG4gICAgICAgICAgICBpZiAoIW1pc3NpbmdUYWdzQ2hlY2suaGFzUmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KcqCBObyByZXNvdXJjZXMgZm91bmQgd2l0aCBtaXNzaW5nIHN0YWNrTmFtZSB0YWdzIScpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7bWlzc2luZ1RhZ3NDaGVjay5jb3VudH0gcmVzb3VyY2VzIHdpdGggbWlzc2luZyBzdGFja05hbWUgdGFnczpgKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VUeXBlIG9mIG1pc3NpbmdUYWdzQ2hlY2sucmVzb3VyY2VUeXBlcykge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICDigKIgJHtyZXNvdXJjZVR5cGV9YCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghb3B0aW9ucy5za2lwQ29uZmlybWF0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgcHJvbXB0Q29uZmlybWF0aW9uKCdyZXNvdXJjZXMgd2l0aG91dCBzdGFja05hbWUgdGFncycsIG9wdGlvbnMuZHJ5UnVuKTtcbiAgICAgICAgICAgICAgICBpZiAoIWNvbmZpcm1lZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn4p2MIE9wZXJhdGlvbiBjYW5jZWxsZWQgYnkgdXNlci4nKTtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY291bnRzID0gYXdhaXQgY2xlYW51cC5jbGVhbnVwUmVzb3VyY2VzV2l0aG91dFN0YWNrTmFtZVRhZyhvcHRpb25zLmRyeVJ1bik7XG4gICAgICAgICAgICBwcmludFN1bW1hcnkoY291bnRzLCBvcHRpb25zLmRyeVJ1bik7XG4gICAgICAgIH0gZWxzZSBpZiAob3B0aW9ucy5zdGFja05hbWUpIHtcbiAgICAgICAgICAgIC8vIFN0YWNrLXNwZWNpZmljIGNsZWFudXBcbiAgICAgICAgICAgIGlmICghb3B0aW9ucy5za2lwQ29uZmlybWF0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgcHJvbXB0Q29uZmlybWF0aW9uKG9wdGlvbnMuc3RhY2tOYW1lLCBvcHRpb25zLmRyeVJ1bik7XG4gICAgICAgICAgICAgICAgaWYgKCFjb25maXJtZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KdjCBPcGVyYXRpb24gY2FuY2VsbGVkIGJ5IHVzZXIuJyk7XG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNvdW50cyA9IGF3YWl0IGNsZWFudXAuY2xlYW51cFN0YWNrKG9wdGlvbnMuc3RhY2tOYW1lLCBvcHRpb25zLmRyeVJ1bik7XG4gICAgICAgICAgICBwcmludFN1bW1hcnkoY291bnRzLCBvcHRpb25zLmRyeVJ1bik7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdcXG7inYwgRmF0YWwgZXJyb3IgZHVyaW5nIGNsZWFudXA6JywgZXJyb3IpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgfVxufVxuXG4vLyBSdW4gdGhlIHNjcmlwdCBpZiBleGVjdXRlZCBkaXJlY3RseVxuaWYgKHJlcXVpcmUubWFpbiA9PT0gbW9kdWxlKSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHVuaWNvcm4vcHJlZmVyLXRvcC1sZXZlbC1hd2FpdFxuICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBtYWluKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgVW5oYW5kbGVkIGVycm9yOicsIGVycm9yKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgIH0pKCk7XG59XG4iXX0=