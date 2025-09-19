#!/usr/bin/env ts-node

/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * AWS Resource Cleanup Script for One Observability Workshop
 *
 * This script identifies and deletes AWS resources that are tagged with the workshop tags
 * but may not have been properly cleaned up when stacks were deleted.
 *
 * SAFETY: The script automatically performs a dry-run first to show what would be deleted,
 * then prompts for confirmation before proceeding with actual deletion.
 *
 * Usage:
 *   npm run cleanup -- --stack-name <STACK_NAME>
 *   npm run cleanup -- --discover
 *   npm run cleanup -- --cleanup-missing-tags
 */

import { CloudWatchLogsClient, DeleteLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs';
import { EC2Client, DescribeVolumesCommand, DeleteVolumeCommand, DeleteSnapshotCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DeleteDBClusterSnapshotCommand, DeleteDBSnapshotCommand } from '@aws-sdk/client-rds';
import { ECSClient, DeregisterTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { ResourceGroupsTaggingAPIClient, GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';
import {
    SSMClient,
    GetParametersByPathCommand,
    DeleteParameterCommand,
    ListTagsForResourceCommand,
    GetParameterCommand,
} from '@aws-sdk/client-ssm';
import { LambdaClient, ListFunctionsCommand, DeleteFunctionCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import {
    IAMClient,
    ListRolesCommand,
    DeleteRoleCommand,
    ListAttachedRolePoliciesCommand,
    DetachRolePolicyCommand,
    ListRolePoliciesCommand,
    DeleteRolePolicyCommand,
    ListPoliciesCommand,
    DeletePolicyCommand,
    GetRoleCommand,
    GetPolicyCommand,
} from '@aws-sdk/client-iam';
import { throttlingBackOff } from './utils/throttle-backoff';

interface CleanupOptions {
    stackName?: string;
    discover: boolean;
    region?: string;
    skipConfirmation?: boolean;
    cleanupMissingTags?: boolean;
    troubleshootStepFunction?: boolean;
    analyzeCleanupLogs?: boolean;
}

interface ResourceCounts {
    cloudwatchLogs: number;
    ebsVolumes: number;
    ebsSnapshots: number;
    rdsBackups: number;
    ecsTaskDefinitions: number;
    s3Buckets: number;
    ssmParameters: number;
    lambdaFunctions: number;
    iamRoles: number;
    iamPolicies: number;
}

export const TAGS = {
    environment: 'non-prod',
    application: 'One Observability Workshop',
    stackName: process.env.STACK_NAME || 'MissingStackName',
};

class WorkshopResourceCleanup {
    private cloudWatchLogs: CloudWatchLogsClient;
    private ec2: EC2Client;
    private rds: RDSClient;
    private ecs: ECSClient;
    private s3: S3Client;
    private resourceGroupsTagging: ResourceGroupsTaggingAPIClient;
    private ssm: SSMClient;
    private lambda: LambdaClient;
    private iam: IAMClient;
    private region: string;

    private readonly WORKSHOP_TAGS = TAGS;

    constructor(region: string = process.env.AWS_REGION || 'us-east-1') {
        const clientConfig = { region };
        this.region = region;

        this.cloudWatchLogs = new CloudWatchLogsClient(clientConfig);
        this.ec2 = new EC2Client(clientConfig);
        this.rds = new RDSClient(clientConfig);
        this.ecs = new ECSClient(clientConfig);
        this.s3 = new S3Client(clientConfig);
        this.resourceGroupsTagging = new ResourceGroupsTaggingAPIClient(clientConfig);
        this.ssm = new SSMClient(clientConfig);
        this.lambda = new LambdaClient(clientConfig);
        this.iam = new IAMClient(clientConfig);
    }

    /**
     * Get AWS account and region information
     */
    async getAwsAccountInfo(): Promise<{ accountId: string | undefined; region: string }> {
        try {
            // Try to get account ID from any AWS resource ARN
            const command = new GetResourcesCommand({
                ResourcesPerPage: 1,
            });

            const response = await throttlingBackOff(() => this.resourceGroupsTagging.send(command));

            let accountId: string | undefined;
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
        } catch {
            return {
                accountId: undefined,
                region: this.region,
            };
        }
    }

    /**
     * Discover all unique stack names from resources with workshop tags
     */
    async discoverStackNames(): Promise<string[]> {
        console.log('🔍 Discovering stack names from existing resources...\n');

        const stackNames = new Set<string>();

        try {
            // First, try to find resources with both environment AND application tags
            console.log('   Searching for resources with both environment and application tags...');
            await this.searchResourcesWithTags(
                [
                    {
                        Key: 'environment',
                        Values: [this.WORKSHOP_TAGS.environment],
                    },
                    {
                        Key: 'application',
                        Values: [this.WORKSHOP_TAGS.application],
                    },
                ],
                stackNames,
            );

            // If no stack names found, fallback to searching by application tag only
            if (stackNames.size === 0) {
                console.log('   No resources found with both tags. Falling back to application tag only...');
                await this.searchResourcesWithTags(
                    [
                        {
                            Key: 'application',
                            Values: [this.WORKSHOP_TAGS.application],
                        },
                    ],
                    stackNames,
                );
            }

            if (stackNames.size === 0) {
                console.log('   No workshop resources found with required tags.');
            } else {
                console.log(`   Found ${stackNames.size} unique stack name(s).`);
            }
        } catch (error) {
            console.error('❌ Error discovering stack names:', error);
        }

        return [...stackNames].sort();
    }

    /**
     * Helper method to search for resources with given tag filters
     */
    private async searchResourcesWithTags(
        tagFilters: Array<{ Key: string; Values: string[] }>,
        stackNames: Set<string>,
    ): Promise<void> {
        let nextToken: string | undefined;
        do {
            const commandWithToken = new GetResourcesCommand({
                TagFilters: tagFilters,
                ...(nextToken && { PaginationToken: nextToken }),
            });

            const response = await throttlingBackOff(() => this.resourceGroupsTagging.send(commandWithToken));

            if (response.ResourceTagMappingList) {
                for (const resource of response.ResourceTagMappingList) {
                    // First try to find explicit stackName tag
                    const stackNameTag = resource.Tags?.find(
                        (tag: { Key?: string; Value?: string }) => tag.Key === 'stackName',
                    );

                    if (stackNameTag?.Value && stackNameTag.Value !== 'MissingStackName') {
                        stackNames.add(stackNameTag.Value);
                    } else {
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
    private extractStackNameFromArn(arn: string): string | undefined {
        if (!arn) return undefined;

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
    private async getWorkshopResources(
        resourceType: string,
        stackName?: string,
        checkMode: 'exact' | 'missing-stackname' | 'application-only' = 'exact',
    ): Promise<string[]> {
        const resources: string[] = [];
        let nextToken: string | undefined;

        try {
            const tagFilters = [];

            switch (checkMode) {
                case 'exact': {
                    tagFilters.push(
                        { Key: 'environment', Values: [this.WORKSHOP_TAGS.environment] },
                        { Key: 'application', Values: [this.WORKSHOP_TAGS.application] },
                    );
                    if (stackName) {
                        tagFilters.push({ Key: 'stackName', Values: [stackName] });
                    }
                    break;
                }

                case 'missing-stackname': {
                    tagFilters.push(
                        { Key: 'environment', Values: [this.WORKSHOP_TAGS.environment] },
                        { Key: 'application', Values: [this.WORKSHOP_TAGS.application] },
                    );
                    // Note: We'll filter out resources WITH stackName after getting results
                    break;
                }

                case 'application-only': {
                    tagFilters.push({ Key: 'application', Values: [this.WORKSHOP_TAGS.application] });
                    break;
                }
            }

            do {
                const command = new GetResourcesCommand({
                    ResourceTypeFilters: [resourceType],
                    TagFilters: tagFilters,
                    ...(nextToken && { PaginationToken: nextToken }),
                });

                const response = await throttlingBackOff(() => this.resourceGroupsTagging.send(command));

                if (response.ResourceTagMappingList) {
                    for (const resource of response.ResourceTagMappingList) {
                        if (!resource.ResourceARN) continue;

                        // For missing-stackname mode, filter out resources that have valid stackName
                        if (checkMode === 'missing-stackname') {
                            const stackNameTag = resource.Tags?.find(
                                (tag: { Key?: string; Value?: string }) => tag.Key === 'stackName',
                            );
                            if (stackNameTag?.Value && stackNameTag.Value !== 'MissingStackName') {
                                continue; // Skip resources with valid stackName
                            }
                        }

                        resources.push(resource.ResourceARN);
                    }
                }

                nextToken = response.PaginationToken;
            } while (nextToken);
        } catch (error) {
            console.error(`❌ Error getting workshop resources for ${resourceType}:`, error);
        }

        return resources;
    }

    /**
     * Extract resource identifier from ARN based on resource type
     */
    private extractResourceId(arn: string, resourceType: string): string | undefined {
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
    private hasWorkshopTags(
        tags: Array<{ Key?: string; key?: string; Value?: string; value?: string }>,
        stackName?: string,
        checkMode: 'exact' | 'missing-stackname' | 'application-only' = 'exact',
    ): boolean {
        const tagMap = new Map(tags.map((tag) => [tag.Key || tag.key, tag.Value || tag.value]));

        const hasRequiredTags =
            tagMap.get('environment') === this.WORKSHOP_TAGS.environment &&
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
     * Count SSM Parameters with workshop tags
     */
    async countSSMParameters(stackName?: string): Promise<number> {
        let count = 0;

        try {
            let nextToken: string | undefined;

            do {
                const listCommand = new GetParametersByPathCommand({
                    Path: '/',
                    Recursive: true,
                    NextToken: nextToken,
                    MaxResults: 10,
                });

                const listResponse = await throttlingBackOff(() => this.ssm.send(listCommand));

                if (listResponse.Parameters) {
                    for (const parameter of listResponse.Parameters) {
                        if (!parameter.Name) continue;

                        // Check if this parameter has workshop tags or naming patterns
                        if (await this.isWorkshopSSMParameter(parameter.Name, stackName)) {
                            count++;
                        }
                    }
                }

                nextToken = listResponse.NextToken;
            } while (nextToken);
        } catch (error) {
            console.error('Error counting SSM parameters:', error);
        }

        return count;
    }

    /**
     * Count Lambda Functions with workshop tags
     */
    async countLambdaFunctions(stackName?: string): Promise<number> {
        let count = 0;

        try {
            let nextMarker: string | undefined;

            do {
                const listCommand = new ListFunctionsCommand({
                    Marker: nextMarker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.lambda.send(listCommand));

                if (listResponse.Functions) {
                    for (const function_ of listResponse.Functions) {
                        if (!function_.FunctionName || !function_.FunctionArn) continue;

                        // Check if this function belongs to the workshop
                        if (await this.isWorkshopLambdaFunction(function_.FunctionArn, stackName)) {
                            count++;
                        }
                    }
                }

                nextMarker = listResponse.NextMarker;
            } while (nextMarker);
        } catch (error) {
            console.error('Error counting Lambda functions:', error);
        }

        return count;
    }

    /**
     * Count IAM Roles with workshop tags
     */
    async countIAMRoles(stackName?: string): Promise<number> {
        let count = 0;

        try {
            let marker: string | undefined;
            let isTruncated = false;

            do {
                const listCommand = new ListRolesCommand({
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse.Roles) {
                    for (const role of listResponse.Roles) {
                        if (!role.RoleName || !role.Arn) continue;

                        // Check if this role belongs to the workshop
                        if (await this.isWorkshopIAMRole(role.RoleName, stackName)) {
                            count++;
                        }
                    }
                }

                marker = listResponse.Marker;
                isTruncated = listResponse.IsTruncated || false;
            } while (isTruncated);
        } catch (error) {
            console.error('Error counting IAM roles:', error);
        }

        return count;
    }

    /**
     * Count IAM Policies with workshop tags
     */
    async countIAMPolicies(stackName?: string): Promise<number> {
        let count = 0;

        try {
            let marker: string | undefined;
            let isTruncated = false;

            do {
                const listCommand = new ListPoliciesCommand({
                    Scope: 'Local', // Only customer-managed policies
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse.Policies) {
                    for (const policy of listResponse.Policies) {
                        if (!policy.PolicyName || !policy.Arn) continue;

                        // Check if this policy belongs to the workshop
                        if (await this.isWorkshopIAMPolicy(policy.Arn!, policy.PolicyName!, stackName)) {
                            count++;
                        }
                    }
                }

                marker = listResponse.Marker;
                isTruncated = listResponse.IsTruncated || false;
            } while (isTruncated);
        } catch (error) {
            console.error('Error counting IAM policies:', error);
        }

        return count;
    }

    /**
     * Check for resources with missing stackName tags
     */
    async checkForResourcesWithMissingStackName(): Promise<{
        hasResources: boolean;
        count: number;
        resourceTypes: string[];
    }> {
        console.log('🔍 Checking for resources with missing stackName tags...\n');

        const resourceTypes: string[] = [];
        let totalCount = 0;

        try {
            // Check CloudWatch Logs
            process.stdout.write('   📋 Checking CloudWatch Log Groups...');
            const cwCount = await this.countResourcesWithMissingStackName('logs:log-group');
            console.log(` found ${cwCount}`);

            // Check EBS Volumes
            process.stdout.write('   💾 Checking EBS Volumes...');
            const ebsVolCount = await this.countResourcesWithMissingStackName('ec2:volume');
            console.log(` found ${ebsVolCount}`);

            // Check EBS Snapshots
            process.stdout.write('   📸 Checking EBS Snapshots...');
            const ebsSnapCount = await this.countResourcesWithMissingStackName('ec2:snapshot');
            console.log(` found ${ebsSnapCount}`);

            // Check RDS Backups (DB snapshots)
            process.stdout.write('   🗄️ Checking RDS Backups...');
            const rdsDatabaseCount = await this.countResourcesWithMissingStackName('rds:db-snapshot');
            const rdsClusterCount = await this.countResourcesWithMissingStackName('rds:cluster-snapshot');
            const rdsCount = rdsDatabaseCount + rdsClusterCount;
            console.log(` found ${rdsCount}`);

            // Check ECS Task Definitions
            process.stdout.write('   📋 Checking ECS Task Definitions...');
            const ecsCount = await this.countResourcesWithMissingStackName('ecs:task-definition');
            console.log(` found ${ecsCount}`);

            // Check S3 Buckets
            process.stdout.write('   🪣 Checking S3 Buckets...');
            const s3Count = await this.countResourcesWithMissingStackName('s3:bucket');
            console.log(` found ${s3Count}`);

            // Check SSM Parameters
            process.stdout.write('   🔧 Checking SSM Parameters...');
            const ssmCount = await this.countSSMParameters();
            console.log(` found ${ssmCount}`);

            // Check Lambda Functions
            process.stdout.write('   ⚡ Checking Lambda Functions...');
            const lambdaCount = await this.countLambdaFunctions();
            console.log(` found ${lambdaCount}`);

            // Check IAM Roles
            process.stdout.write('   👤 Checking IAM Roles...');
            const iamRoleCount = await this.countIAMRoles();
            console.log(` found ${iamRoleCount}`);

            // Check IAM Policies
            process.stdout.write('   📋 Checking IAM Policies...');
            const iamPolicyCount = await this.countIAMPolicies();
            console.log(` found ${iamPolicyCount}`);

            // Collect all resource types with counts > 0
            resourceTypes.push(
                ...([
                    cwCount > 0 && `CloudWatch Log Groups (${cwCount})`,
                    ebsVolCount > 0 && `EBS Volumes (${ebsVolCount})`,
                    ebsSnapCount > 0 && `EBS Snapshots (${ebsSnapCount})`,
                    rdsCount > 0 && `RDS Backups (${rdsCount})`,
                    ecsCount > 0 && `ECS Task Definitions (${ecsCount})`,
                    s3Count > 0 && `S3 Buckets (${s3Count})`,
                    ssmCount > 0 && `SSM Parameters (${ssmCount})`,
                    lambdaCount > 0 && `Lambda Functions (${lambdaCount})`,
                    iamRoleCount > 0 && `IAM Roles (${iamRoleCount})`,
                    iamPolicyCount > 0 && `IAM Policies (${iamPolicyCount})`,
                ].filter(Boolean) as string[]),
            );
            totalCount =
                cwCount +
                ebsVolCount +
                ebsSnapCount +
                rdsCount +
                ecsCount +
                s3Count +
                ssmCount +
                lambdaCount +
                iamRoleCount +
                iamPolicyCount;

            console.log(); // Add blank line after progress indicators

            return {
                hasResources: totalCount > 0,
                count: totalCount,
                resourceTypes,
            };
        } catch (error) {
            console.error('❌ Error checking for resources:', error);
            return { hasResources: false, count: 0, resourceTypes: [] };
        }
    }

    /**
     * Count resources with missing stackName tag using Resource Groups API
     */
    private async countResourcesWithMissingStackName(resourceType: string): Promise<number> {
        const resources = await this.getWorkshopResources(resourceType, undefined, 'missing-stackname');
        return resources.length;
    }

    /**
     * Helper method to check if SSM parameter belongs to workshop
     */
    private async isWorkshopSSMParameter(parameterName: string, stackName?: string): Promise<boolean> {
        try {
            // First try to get parameter tags - this is the authoritative method
            const getParameterResponse = await throttlingBackOff(() =>
                this.ssm.send(new GetParameterCommand({ Name: parameterName, WithDecryption: false })),
            );

            // Note: SSM GetParameter doesn't include tags. We need to use ListTagsForResource
            if (getParameterResponse.Parameter?.ARN) {
                try {
                    const tagsResponse = await throttlingBackOff(() =>
                        this.ssm.send(
                            new ListTagsForResourceCommand({
                                ResourceType: 'Parameter',
                                ResourceId: parameterName,
                            }),
                        ),
                    );

                    if (tagsResponse.TagList && tagsResponse.TagList.length > 0) {
                        // If the parameter has tags, use them to determine if it's a workshop parameter
                        const tags = tagsResponse.TagList.map((tag) => ({
                            Key: tag.Key,
                            Value: tag.Value,
                        }));
                        return this.hasWorkshopTags(tags, stackName);
                    }
                } catch {
                    // If we can't get tags, fall back to naming pattern
                }
            }

            // Fallback: Workshop SSM parameters typically follow patterns like:
            // /one-observability/*, /workshop/*, /*Stack* patterns
            const workshopPatterns = [
                /\/one-observability\//i,
                /\/workshop\//i,
                /\/dev.*stack/i,
                /\/microservices/i,
                /\/petstore/i,
                /\/petsite/i,
                /\/observability/i,
            ];

            if (stackName) {
                // Also check for stack-specific patterns
                workshopPatterns.push(
                    new RegExp(`/${stackName.toLowerCase()}/`, 'i'),
                    new RegExp(`${stackName.toLowerCase()}`, 'i'),
                );
            }

            return workshopPatterns.some((pattern) => pattern.test(parameterName));
        } catch {
            // If we can't access the parameter, it's not a workshop parameter
            return false;
        }
    }

    /**
     * Helper method to check if Lambda function belongs to workshop
     */
    private async isWorkshopLambdaFunction(functionArn: string, stackName?: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getFunctionResponse = await throttlingBackOff(() =>
                this.lambda.send(new GetFunctionCommand({ FunctionName: functionArn })),
            );

            if (getFunctionResponse.Tags) {
                // If the function has tags, use them to determine if it's a workshop function
                const tags = Object.entries(getFunctionResponse.Tags).map(([key, value]) => ({
                    Key: key,
                    Value: value,
                }));
                return this.hasWorkshopTags(tags, stackName);
            } else {
                // If the function has no tags, it's not a workshop function
                // Workshop functions should always be properly tagged
                return false;
            }
        } catch {
            // If we can't get the function or there's an error, it's not a workshop function
            return false;
        }
    }

    /**
     * Helper method to check if IAM role belongs to workshop
     */
    private async isWorkshopIAMRole(roleName: string, stackName?: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getRoleResponse = await throttlingBackOff(() =>
                this.iam.send(new GetRoleCommand({ RoleName: roleName })),
            );

            // If the role has tags, use them to determine if it's a workshop role
            // If the role has no tags, it's not a workshop role (Workshop roles should always be properly tagged)
            return getRoleResponse.Role?.Tags ? this.hasWorkshopTags(getRoleResponse.Role.Tags, stackName) : false;
        } catch {
            // If we can't get the role or there's an error, it's not a workshop role
            return false;
        }
    }

    /**
     * Helper method to check if IAM policy belongs to workshop
     */
    private async isWorkshopIAMPolicy(policyArn: string, policyName: string, stackName?: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getPolicyResponse = await throttlingBackOff(() =>
                this.iam.send(new GetPolicyCommand({ PolicyArn: policyArn })),
            );

            return getPolicyResponse.Policy?.Tags
                ? this.hasWorkshopTags(getPolicyResponse.Policy.Tags, stackName)
                : false;
        } catch {
            // If we can't get the policy or there's an error, it's not a workshop policy
            return false;
        }
    }

    /**
     * Helper method to check if SSM parameter belongs to workshop but has missing stackName
     */
    private async isWorkshopSSMParameterWithoutStackName(parameterName: string): Promise<boolean> {
        try {
            // First try to get parameter tags - this is the authoritative method
            const getParameterResponse = await throttlingBackOff(() =>
                this.ssm.send(new GetParameterCommand({ Name: parameterName, WithDecryption: false })),
            );

            // Note: SSM GetParameter doesn't include tags. We need to use ListTagsForResource
            if (getParameterResponse.Parameter?.ARN) {
                try {
                    const tagsResponse = await throttlingBackOff(() =>
                        this.ssm.send(
                            new ListTagsForResourceCommand({
                                ResourceType: 'Parameter',
                                ResourceId: parameterName,
                            }),
                        ),
                    );

                    if (tagsResponse.TagList && tagsResponse.TagList.length > 0) {
                        // If the parameter has tags, use them to determine if it's a workshop parameter without stackName
                        const tags = tagsResponse.TagList.map((tag) => ({
                            Key: tag.Key,
                            Value: tag.Value,
                        }));
                        return this.hasWorkshopTags(tags, undefined, 'missing-stackname');
                    }
                } catch {
                    // If we can't get tags, fall back to naming pattern
                }
            }

            return false; // If no tags or can't determine, not a workshop resource
        } catch {
            // If we can't access the parameter, it's not a workshop parameter
            return false;
        }
    }

    /**
     * Helper method to check if Lambda function belongs to workshop but has missing stackName
     */
    private async isWorkshopLambdaFunctionWithoutStackName(functionArn: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getFunctionResponse = await throttlingBackOff(() =>
                this.lambda.send(new GetFunctionCommand({ FunctionName: functionArn })),
            );

            if (getFunctionResponse.Tags) {
                // If the function has tags, use them to determine if it's a workshop function without stackName
                const tags = Object.entries(getFunctionResponse.Tags).map(([key, value]) => ({
                    Key: key,
                    Value: value,
                }));
                return this.hasWorkshopTags(tags, undefined, 'missing-stackname');
            } else {
                // If the function has no tags, it's not a workshop function
                return false;
            }
        } catch {
            // If we can't get the function or there's an error, it's not a workshop function
            return false;
        }
    }

    /**
     * Helper method to check if IAM role belongs to workshop but has missing stackName
     */
    private async isWorkshopIAMRoleWithoutStackName(roleName: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getRoleResponse = await throttlingBackOff(() =>
                this.iam.send(new GetRoleCommand({ RoleName: roleName })),
            );

            return getRoleResponse.Role?.Tags
                ? this.hasWorkshopTags(getRoleResponse.Role.Tags, undefined, 'missing-stackname')
                : false;
        } catch {
            // If we can't get the role or there's an error, it's not a workshop role
            return false;
        }
    }

    /**
     * Helper method to check if IAM policy belongs to workshop but has missing stackName
     */
    private async isWorkshopIAMPolicyWithoutStackName(policyArn: string): Promise<boolean> {
        try {
            // Always check tags first - this is the authoritative method
            const getPolicyResponse = await throttlingBackOff(() =>
                this.iam.send(new GetPolicyCommand({ PolicyArn: policyArn })),
            );

            return getPolicyResponse.Policy?.Tags
                ? this.hasWorkshopTags(getPolicyResponse.Policy.Tags, undefined, 'missing-stackname')
                : false;
        } catch {
            // If we can't get the policy or there's an error, it's not a workshop policy
            return false;
        }
    }

    /**
     * Clean up CloudWatch Log Groups
     */
    async cleanupCloudWatchLogs(stackName: string, dryRun: boolean): Promise<number> {
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
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.cloudWatchLogs.send(new DeleteLogGroupCommand({ logGroupName })),
                        );
                        console.log(`   ✅ Deleted log group: ${logGroupName}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete log group ${logGroupName}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up CloudWatch logs:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up EBS Volumes
     */
    async cleanupEBSVolumes(stackName: string, dryRun: boolean): Promise<number> {
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
                    const describeCommand = new DescribeVolumesCommand({ VolumeIds: [volumeId] });
                    const describeResponse = await throttlingBackOff(() => this.ec2.send(describeCommand));

                    const volume = describeResponse.Volumes?.[0];
                    if (!volume) {
                        console.log(`   ⚠️ Volume ${volumeId} not found in describe response, skipping`);
                        continue;
                    }

                    if (volume.State !== 'available') {
                        console.log(`   ⚠️ Skipping volume ${volumeId} because it is in ${volume.State} state`);
                        continue;
                    }
                } catch (error: unknown) {
                    const errorObject = error as { name?: string; Code?: string; message?: string };
                    if (
                        errorObject.name === 'InvalidVolume.NotFound' ||
                        errorObject.Code === 'InvalidVolume.NotFound'
                    ) {
                        console.log(`   ⚠️ Volume ${volumeId} no longer exists, skipping`);
                        continue;
                    }
                    console.error(`   ❌ Error checking volume ${volumeId}: ${errorObject.message || String(error)}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS volume: ${volumeId}`);
                } else {
                    try {
                        await throttlingBackOff(() => this.ec2.send(new DeleteVolumeCommand({ VolumeId: volumeId })));
                        console.log(`   ✅ Deleted EBS volume: ${volumeId}`);
                    } catch (error: unknown) {
                        const errorObject = error as { name?: string; Code?: string; message?: string };
                        if (
                            errorObject.name === 'InvalidVolume.NotFound' ||
                            errorObject.Code === 'InvalidVolume.NotFound'
                        ) {
                            console.log(`   ⚠️ Volume ${volumeId} was already deleted, continuing`);
                        } else {
                            console.error(
                                `   ❌ Failed to delete volume ${volumeId}: ${errorObject.message || String(error)}`,
                            );
                        }
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up EBS volumes:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up EBS Snapshots
     */
    async cleanupEBSSnapshots(stackName: string, dryRun: boolean): Promise<number> {
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
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId })),
                        );
                        console.log(`   ✅ Deleted EBS snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up EBS snapshots:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up RDS Backups (DB Snapshots and Cluster Snapshots)
     */
    async cleanupRDSBackups(stackName: string, dryRun: boolean): Promise<number> {
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
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: snapshotId })),
                        );
                        console.log(`   ✅ Deleted DB snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete DB snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
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
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.rds.send(
                                new DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: snapshotId }),
                            ),
                        );
                        console.log(`   ✅ Deleted DB cluster snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete cluster snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up RDS backups:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up ECS Task Definitions
     */
    async cleanupECSTaskDefinitions(stackName: string, dryRun: boolean): Promise<number> {
        console.log('📋 Cleaning up ECS Task Definitions...');

        let deletedCount = 0;
        const resourceType = 'ecs:task-definition';

        try {
            const resources = await this.getWorkshopResources(resourceType, stackName);

            for (const resourceArn of resources) {
                const taskDefinition = resourceArn; // For task definitions, we use the full ARN

                if (dryRun) {
                    console.log(`   [DRY RUN] Would deregister task definition: ${taskDefinition}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition })),
                        );
                        console.log(`   ✅ Deregistered task definition: ${taskDefinition}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to deregister task definition ${taskDefinition}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up ECS task definitions:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up S3 Buckets (with emptying)
     */
    async cleanupS3Buckets(stackName: string, dryRun: boolean): Promise<number> {
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
                } else {
                    try {
                        // First empty the bucket
                        await this.emptyS3Bucket(bucketName);

                        // Then delete the bucket
                        await throttlingBackOff(() => this.s3.send(new DeleteBucketCommand({ Bucket: bucketName })));
                        console.log(`   ✅ Deleted S3 bucket: ${bucketName}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                deletedCount++;
            }
        } catch (error) {
            console.error('❌ Error cleaning up S3 buckets:', error);
        }

        return deletedCount;
    }

    /**
     * Empty S3 bucket by deleting all objects and versions
     */
    private async emptyS3Bucket(bucketName: string): Promise<void> {
        console.log(`   🗂️  Emptying S3 bucket: ${bucketName}`);

        try {
            let isTruncated = true;
            let keyMarker: string | undefined;
            let versionIdMarker: string | undefined;

            while (isTruncated) {
                const listCommand = new ListObjectVersionsCommand({
                    Bucket: bucketName,
                    KeyMarker: keyMarker,
                    VersionIdMarker: versionIdMarker,
                    MaxKeys: 1000,
                });

                const listResponse = await throttlingBackOff(() => this.s3.send(listCommand));

                const objects: Array<{ Key: string; VersionId?: string }> = [];

                // Add current versions and delete markers
                if (listResponse.Versions) {
                    objects.push(
                        ...listResponse.Versions.map((version) => ({
                            Key: version.Key!,
                            VersionId: version.VersionId,
                        })),
                    );
                }

                if (listResponse.DeleteMarkers) {
                    objects.push(
                        ...listResponse.DeleteMarkers.map((marker) => ({
                            Key: marker.Key!,
                            VersionId: marker.VersionId,
                        })),
                    );
                }

                // Delete objects in batches
                if (objects.length > 0) {
                    const deleteCommand = new DeleteObjectsCommand({
                        Bucket: bucketName,
                        Delete: {
                            Objects: objects,
                            Quiet: true,
                        },
                    });

                    await throttlingBackOff(() => this.s3.send(deleteCommand));
                    console.log(`     Deleted ${objects.length} objects`);
                }

                isTruncated = listResponse.IsTruncated || false;
                keyMarker = listResponse.NextKeyMarker;
                versionIdMarker = listResponse.NextVersionIdMarker;
            }
        } catch (error: unknown) {
            console.error(
                `   ❌ Failed to empty bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }
    }

    /**
     * Clean up SSM Parameters
     */
    async cleanupSSMParameters(stackName: string, dryRun: boolean): Promise<number> {
        console.log('🔧 Cleaning up SSM Parameters...');

        let deletedCount = 0;

        try {
            // Note: SSM Parameters don't have ARNs in Resource Groups API in the same way
            // We need to use a different approach - list parameters and check tags
            let nextToken: string | undefined;

            do {
                const listCommand = new GetParametersByPathCommand({
                    Path: '/',
                    Recursive: true,
                    NextToken: nextToken,
                    MaxResults: 10,
                });

                const listResponse = await throttlingBackOff(() => this.ssm.send(listCommand));

                if (listResponse.Parameters) {
                    for (const parameter of listResponse.Parameters) {
                        if (!parameter.Name) continue;

                        // Check if this parameter has workshop tags
                        if (await this.isWorkshopSSMParameter(parameter.Name, stackName)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete SSM parameter: ${parameter.Name}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.ssm.send(new DeleteParameterCommand({ Name: parameter.Name! })),
                                    );
                                    console.log(`   ✅ Deleted SSM parameter: ${parameter.Name}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete SSM parameter ${parameter.Name}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            deletedCount++;
                        }
                    }
                }

                nextToken = listResponse.NextToken;
            } while (nextToken);
        } catch (error) {
            console.error('❌ Error cleaning up SSM parameters:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up Lambda Functions
     */
    async cleanupLambdaFunctions(stackName: string, dryRun: boolean): Promise<number> {
        console.log('⚡ Cleaning up Lambda Functions...');

        let deletedCount = 0;

        try {
            let nextMarker: string | undefined;

            do {
                const listCommand = new ListFunctionsCommand({
                    Marker: nextMarker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.lambda.send(listCommand));

                if (listResponse.Functions) {
                    for (const function_ of listResponse.Functions) {
                        if (!function_.FunctionName || !function_.FunctionArn) continue;

                        // Check if this function belongs to the workshop
                        if (await this.isWorkshopLambdaFunction(function_.FunctionArn, stackName)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete Lambda function: ${function_.FunctionName}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.lambda.send(
                                            new DeleteFunctionCommand({ FunctionName: function_.FunctionName! }),
                                        ),
                                    );
                                    console.log(`   ✅ Deleted Lambda function: ${function_.FunctionName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete Lambda function ${function_.FunctionName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            deletedCount++;
                        }
                    }
                }

                nextMarker = listResponse.NextMarker;
            } while (nextMarker);
        } catch (error) {
            console.error('❌ Error cleaning up Lambda functions:', error);
        }

        return deletedCount;
    }

    /**
     * Clean up IAM Roles
     */
    async cleanupIAMRoles(stackName: string, dryRun: boolean): Promise<number> {
        console.log('👤 Cleaning up IAM Roles...');

        let deletedCount = 0;

        try {
            let marker: string | undefined;
            let isTruncated = false;

            do {
                const listCommand = new ListRolesCommand({
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse.Roles) {
                    for (const role of listResponse.Roles) {
                        if (!role.RoleName || !role.Arn) continue;

                        // Check if this role belongs to the workshop
                        if (await this.isWorkshopIAMRole(role.RoleName, stackName)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete IAM role: ${role.RoleName}`);
                            } else {
                                try {
                                    // First detach all managed policies
                                    await this.detachRolePolicies(role.RoleName);

                                    // Delete inline policies
                                    await this.deleteInlineRolePolicies(role.RoleName);

                                    // Finally delete the role
                                    await throttlingBackOff(() =>
                                        this.iam.send(new DeleteRoleCommand({ RoleName: role.RoleName! })),
                                    );
                                    console.log(`   ✅ Deleted IAM role: ${role.RoleName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete IAM role ${role.RoleName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            deletedCount++;
                        }
                    }
                }

                marker = listResponse.Marker;
                isTruncated = listResponse.IsTruncated || false;
            } while (isTruncated);
        } catch (error) {
            console.error('❌ Error cleaning up IAM roles:', error);
        }

        return deletedCount;
    }

    /**
     * Helper method to detach managed policies from role
     */
    private async detachRolePolicies(roleName: string): Promise<void> {
        try {
            const listPoliciesCommand = new ListAttachedRolePoliciesCommand({ RoleName: roleName });
            const policiesResponse = await throttlingBackOff(() => this.iam.send(listPoliciesCommand));

            if (policiesResponse.AttachedPolicies) {
                for (const policy of policiesResponse.AttachedPolicies) {
                    if (policy.PolicyArn) {
                        await throttlingBackOff(() =>
                            this.iam.send(
                                new DetachRolePolicyCommand({
                                    RoleName: roleName,
                                    PolicyArn: policy.PolicyArn!,
                                }),
                            ),
                        );
                    }
                }
            }
        } catch (error) {
            console.warn(`   ⚠️ Warning: Could not detach policies from role ${roleName}: ${error}`);
        }
    }

    /**
     * Helper method to delete inline policies from role
     */
    private async deleteInlineRolePolicies(roleName: string): Promise<void> {
        try {
            const listInlinePoliciesCommand = new ListRolePoliciesCommand({ RoleName: roleName });
            const inlinePoliciesResponse = await throttlingBackOff(() => this.iam.send(listInlinePoliciesCommand));

            if (inlinePoliciesResponse.PolicyNames) {
                for (const policyName of inlinePoliciesResponse.PolicyNames) {
                    await throttlingBackOff(() =>
                        this.iam.send(
                            new DeleteRolePolicyCommand({
                                RoleName: roleName,
                                PolicyName: policyName,
                            }),
                        ),
                    );
                }
            }
        } catch (error) {
            console.warn(`   ⚠️ Warning: Could not delete inline policies from role ${roleName}: ${error}`);
        }
    }

    /**
     * Clean up IAM Policies
     */
    async cleanupIAMPolicies(stackName: string, dryRun: boolean): Promise<number> {
        console.log('📋 Cleaning up IAM Policies...');

        let deletedCount = 0;

        try {
            let marker: string | undefined;
            let isTruncated = false;

            do {
                const listCommand = new ListPoliciesCommand({
                    Scope: 'Local', // Only customer-managed policies
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse.Policies) {
                    for (const policy of listResponse.Policies) {
                        if (!policy.PolicyName || !policy.Arn) continue;

                        // Check if this policy belongs to the workshop
                        if (await this.isWorkshopIAMPolicy(policy.Arn!, policy.PolicyName!, stackName)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete IAM policy: ${policy.PolicyName}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.iam.send(new DeletePolicyCommand({ PolicyArn: policy.Arn! })),
                                    );
                                    console.log(`   ✅ Deleted IAM policy: ${policy.PolicyName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete IAM policy ${policy.PolicyName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            deletedCount++;
                        }
                    }
                }

                marker = listResponse.Marker;
                isTruncated = listResponse.IsTruncated || false;
            } while (isTruncated);
        } catch (error) {
            console.error('❌ Error cleaning up IAM policies:', error);
        }

        return deletedCount;
    }

    /**
     * Run complete cleanup for a specific stack
     */
    async cleanupStack(stackName: string, dryRun: boolean = false): Promise<ResourceCounts> {
        console.log(`\n🧹 ${dryRun ? '[DRY RUN] ' : ''}Cleaning up resources for stack: ${stackName}\n`);

        const counts: ResourceCounts = {
            cloudwatchLogs: 0,
            ebsVolumes: 0,
            ebsSnapshots: 0,
            rdsBackups: 0,
            ecsTaskDefinitions: 0,
            s3Buckets: 0,
            ssmParameters: 0,
            lambdaFunctions: 0,
            iamRoles: 0,
            iamPolicies: 0,
        };

        // Clean up resources in parallel for better performance
        const cleanupPromises = [
            this.cleanupCloudWatchLogs(stackName, dryRun),
            this.cleanupEBSVolumes(stackName, dryRun),
            this.cleanupEBSSnapshots(stackName, dryRun),
            this.cleanupRDSBackups(stackName, dryRun),
            this.cleanupECSTaskDefinitions(stackName, dryRun),
            this.cleanupS3Buckets(stackName, dryRun),
            this.cleanupSSMParameters(stackName, dryRun),
            this.cleanupLambdaFunctions(stackName, dryRun),
            this.cleanupIAMRoles(stackName, dryRun),
            this.cleanupIAMPolicies(stackName, dryRun),
        ];

        try {
            const results = await Promise.all(cleanupPromises);

            counts.cloudwatchLogs = results[0];
            counts.ebsVolumes = results[1];
            counts.ebsSnapshots = results[2];
            counts.rdsBackups = results[3];
            counts.ecsTaskDefinitions = results[4];
            counts.s3Buckets = results[5];
            counts.ssmParameters = results[6];
            counts.lambdaFunctions = results[7];
            counts.iamRoles = results[8];
            counts.iamPolicies = results[9];
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }

        return counts;
    }

    /**
     * Run cleanup for resources without stackName tag
     */
    async cleanupResourcesWithoutStackNameTag(dryRun: boolean = false): Promise<ResourceCounts> {
        console.log(`\n🧹 ${dryRun ? '[DRY RUN] ' : ''}Cleaning up resources without valid stackName tags\n`);

        const counts: ResourceCounts = {
            cloudwatchLogs: 0,
            ebsVolumes: 0,
            ebsSnapshots: 0,
            rdsBackups: 0,
            ecsTaskDefinitions: 0,
            s3Buckets: 0,
            ssmParameters: 0,
            lambdaFunctions: 0,
            iamRoles: 0,
            iamPolicies: 0,
        };

        try {
            // Clean up CloudWatch Logs without stackName
            console.log('🗂️  Cleaning up CloudWatch Log Groups without stackName...');
            const logGroupType = 'logs:log-group';
            const logGroups = await this.getWorkshopResources(logGroupType, undefined, 'missing-stackname');

            for (const resourceArn of logGroups) {
                const logGroupName = this.extractResourceId(resourceArn, logGroupType);

                if (!logGroupName) {
                    console.log(`   ⚠️ Could not extract log group name from ARN: ${resourceArn}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete log group: ${logGroupName}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.cloudWatchLogs.send(new DeleteLogGroupCommand({ logGroupName })),
                        );
                        console.log(`   ✅ Deleted log group: ${logGroupName}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete log group ${logGroupName}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.cloudwatchLogs++;
            }

            // Clean up EBS Volumes without stackName
            console.log('💾 Cleaning up EBS Volumes without stackName...');
            const ebsVolumeType = 'ec2:volume';
            const ebsVolumes = await this.getWorkshopResources(ebsVolumeType, undefined, 'missing-stackname');

            for (const resourceArn of ebsVolumes) {
                const volumeId = this.extractResourceId(resourceArn, ebsVolumeType);

                if (!volumeId) {
                    console.log(`   ⚠️ Could not extract volume ID from ARN: ${resourceArn}`);
                    continue;
                }

                // Check if volume exists and is available (not attached)
                try {
                    const describeCommand = new DescribeVolumesCommand({ VolumeIds: [volumeId] });
                    const describeResponse = await throttlingBackOff(() => this.ec2.send(describeCommand));

                    const volume = describeResponse.Volumes?.[0];
                    if (!volume) {
                        console.log(`   ⚠️ Volume ${volumeId} not found in describe response, skipping`);
                        continue;
                    }

                    if (volume.State !== 'available') {
                        console.log(`   ⚠️ Skipping volume ${volumeId} because it is in ${volume.State} state`);
                        continue;
                    }
                } catch (error: unknown) {
                    const errorObject = error as { name?: string; Code?: string; message?: string };
                    if (
                        errorObject.name === 'InvalidVolume.NotFound' ||
                        errorObject.Code === 'InvalidVolume.NotFound'
                    ) {
                        console.log(`   ⚠️ Volume ${volumeId} no longer exists, skipping`);
                        continue;
                    }
                    console.error(`   ❌ Error checking volume ${volumeId}: ${errorObject.message || String(error)}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS volume: ${volumeId}`);
                } else {
                    try {
                        await throttlingBackOff(() => this.ec2.send(new DeleteVolumeCommand({ VolumeId: volumeId })));
                        console.log(`   ✅ Deleted EBS volume: ${volumeId}`);
                    } catch (error: unknown) {
                        const errorObject = error as { name?: string; Code?: string; message?: string };
                        if (
                            errorObject.name === 'InvalidVolume.NotFound' ||
                            errorObject.Code === 'InvalidVolume.NotFound'
                        ) {
                            console.log(`   ⚠️ Volume ${volumeId} was already deleted, continuing`);
                        } else {
                            console.error(
                                `   ❌ Failed to delete volume ${volumeId}: ${errorObject.message || String(error)}`,
                            );
                        }
                        continue;
                    }
                }
                counts.ebsVolumes++;
            }

            // Clean up EBS Snapshots without stackName
            console.log('📸 Cleaning up EBS Snapshots without stackName...');
            const ebsSnapshotType = 'ec2:snapshot';
            const ebsSnapshots = await this.getWorkshopResources(ebsSnapshotType, undefined, 'missing-stackname');

            for (const resourceArn of ebsSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, ebsSnapshotType);

                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete EBS snapshot: ${snapshotId}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId })),
                        );
                        console.log(`   ✅ Deleted EBS snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.ebsSnapshots++;
            }

            // Clean up RDS Backups without stackName
            console.log('🗄️  Cleaning up RDS Backups without stackName...');

            // DB snapshots
            const rdsDatabaseSnapshotType = 'rds:db-snapshot';
            const rdsDatabaseSnapshots = await this.getWorkshopResources(
                rdsDatabaseSnapshotType,
                undefined,
                'missing-stackname',
            );

            for (const resourceArn of rdsDatabaseSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, rdsDatabaseSnapshotType);

                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract DB snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB snapshot: ${snapshotId}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: snapshotId })),
                        );
                        console.log(`   ✅ Deleted DB snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete DB snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.rdsBackups++;
            }

            // DB cluster snapshots
            const rdsClusterSnapshotType = 'rds:cluster-snapshot';
            const rdsClusterSnapshots = await this.getWorkshopResources(
                rdsClusterSnapshotType,
                undefined,
                'missing-stackname',
            );

            for (const resourceArn of rdsClusterSnapshots) {
                const snapshotId = this.extractResourceId(resourceArn, rdsClusterSnapshotType);

                if (!snapshotId) {
                    console.log(`   ⚠️ Could not extract cluster snapshot ID from ARN: ${resourceArn}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would delete DB cluster snapshot: ${snapshotId}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.rds.send(
                                new DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: snapshotId }),
                            ),
                        );
                        console.log(`   ✅ Deleted DB cluster snapshot: ${snapshotId}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete cluster snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.rdsBackups++;
            }

            // Clean up ECS Task Definitions without stackName
            console.log('📋 Cleaning up ECS Task Definitions without stackName...');
            const ecsTaskDefinitionType = 'ecs:task-definition';
            const ecsTaskDefinitions = await this.getWorkshopResources(
                ecsTaskDefinitionType,
                undefined,
                'missing-stackname',
            );

            for (const resourceArn of ecsTaskDefinitions) {
                const taskDefinition = resourceArn; // For task definitions, we use the full ARN

                if (dryRun) {
                    console.log(`   [DRY RUN] Would deregister task definition: ${taskDefinition}`);
                } else {
                    try {
                        await throttlingBackOff(() =>
                            this.ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition })),
                        );
                        console.log(`   ✅ Deregistered task definition: ${taskDefinition}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to deregister task definition ${taskDefinition}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.ecsTaskDefinitions++;
            }

            // Clean up S3 Buckets without stackName
            console.log('🪣 Cleaning up S3 Buckets without stackName...');
            const s3BucketType = 's3:bucket';
            const s3Buckets = await this.getWorkshopResources(s3BucketType, undefined, 'missing-stackname');

            for (const resourceArn of s3Buckets) {
                const bucketName = this.extractResourceId(resourceArn, s3BucketType);

                if (!bucketName) {
                    console.log(`   ⚠️ Could not extract bucket name from ARN: ${resourceArn}`);
                    continue;
                }

                if (dryRun) {
                    console.log(`   [DRY RUN] Would empty and delete S3 bucket: ${bucketName}`);
                } else {
                    try {
                        // First empty the bucket
                        await this.emptyS3Bucket(bucketName);

                        // Then delete the bucket
                        await throttlingBackOff(() => this.s3.send(new DeleteBucketCommand({ Bucket: bucketName })));
                        console.log(`   ✅ Deleted S3 bucket: ${bucketName}`);
                    } catch (error: unknown) {
                        console.error(
                            `   ❌ Failed to delete bucket ${bucketName}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }
                }
                counts.s3Buckets++;
            }

            // Clean up SSM Parameters without stackName
            console.log('🔧 Cleaning up SSM Parameters without stackName...');
            let nextToken: string | undefined;

            do {
                const listCommand = new GetParametersByPathCommand({
                    Path: '/',
                    Recursive: true,
                    NextToken: nextToken,
                    MaxResults: 10,
                });

                const listResponse = await throttlingBackOff(() => this.ssm.send(listCommand));

                if (listResponse.Parameters) {
                    for (const parameter of listResponse.Parameters) {
                        if (!parameter.Name) continue;

                        // Check if this parameter has workshop tags but missing stackName
                        if (await this.isWorkshopSSMParameterWithoutStackName(parameter.Name)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete SSM parameter: ${parameter.Name}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.ssm.send(new DeleteParameterCommand({ Name: parameter.Name! })),
                                    );
                                    console.log(`   ✅ Deleted SSM parameter: ${parameter.Name}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete SSM parameter ${parameter.Name}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            counts.ssmParameters++;
                        }
                    }
                }

                nextToken = listResponse.NextToken;
            } while (nextToken);

            // Clean up Lambda Functions without stackName
            console.log('⚡ Cleaning up Lambda Functions without stackName...');
            let nextMarker: string | undefined;

            do {
                const listCommand = new ListFunctionsCommand({
                    Marker: nextMarker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.lambda.send(listCommand));

                if (listResponse.Functions) {
                    for (const function_ of listResponse.Functions) {
                        if (!function_.FunctionName || !function_.FunctionArn) continue;

                        // Check if this function has workshop tags but missing stackName
                        if (await this.isWorkshopLambdaFunctionWithoutStackName(function_.FunctionArn)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete Lambda function: ${function_.FunctionName}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.lambda.send(
                                            new DeleteFunctionCommand({ FunctionName: function_.FunctionName! }),
                                        ),
                                    );
                                    console.log(`   ✅ Deleted Lambda function: ${function_.FunctionName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete Lambda function ${function_.FunctionName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            counts.lambdaFunctions++;
                        }
                    }
                }

                nextMarker = listResponse.NextMarker;
            } while (nextMarker);

            // Clean up IAM Roles without stackName
            console.log('👤 Cleaning up IAM Roles without stackName...');
            let marker: string | undefined;
            let isTruncated = false;

            do {
                const listCommand = new ListRolesCommand({
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse.Roles) {
                    for (const role of listResponse.Roles) {
                        if (!role.RoleName || !role.Arn) continue;

                        // Check if this role has workshop tags but missing stackName
                        if (await this.isWorkshopIAMRoleWithoutStackName(role.RoleName)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete IAM role: ${role.RoleName}`);
                            } else {
                                try {
                                    // First detach all managed policies
                                    await this.detachRolePolicies(role.RoleName);

                                    // Delete inline policies
                                    await this.deleteInlineRolePolicies(role.RoleName);

                                    // Finally delete the role
                                    await throttlingBackOff(() =>
                                        this.iam.send(new DeleteRoleCommand({ RoleName: role.RoleName! })),
                                    );
                                    console.log(`   ✅ Deleted IAM role: ${role.RoleName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete IAM role ${role.RoleName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            counts.iamRoles++;
                        }
                    }
                }

                marker = listResponse.Marker;
                isTruncated = listResponse.IsTruncated || false;
            } while (isTruncated);

            // Clean up IAM Policies without stackName
            console.log('📋 Cleaning up IAM Policies without stackName...');
            marker = undefined;
            isTruncated = false;

            do {
                const listCommand: ListPoliciesCommand = new ListPoliciesCommand({
                    Scope: 'Local', // Only customer-managed policies
                    Marker: marker,
                    MaxItems: 50,
                });

                const listResponse = await throttlingBackOff(() => this.iam.send(listCommand));

                if (listResponse && 'Policies' in listResponse && listResponse.Policies) {
                    for (const policy of listResponse.Policies) {
                        if (!policy.PolicyName || !policy.Arn) continue;

                        // Check if this policy has workshop tags but missing stackName
                        if (await this.isWorkshopIAMPolicyWithoutStackName(policy.Arn!)) {
                            if (dryRun) {
                                console.log(`   [DRY RUN] Would delete IAM policy: ${policy.PolicyName}`);
                            } else {
                                try {
                                    await throttlingBackOff(() =>
                                        this.iam.send(new DeletePolicyCommand({ PolicyArn: policy.Arn! })),
                                    );
                                    console.log(`   ✅ Deleted IAM policy: ${policy.PolicyName}`);
                                } catch (error: unknown) {
                                    console.error(
                                        `   ❌ Failed to delete IAM policy ${policy.PolicyName}: ${error instanceof Error ? error.message : String(error)}`,
                                    );
                                    continue;
                                }
                            }
                            counts.iamPolicies++;
                        }
                    }
                }

                marker = listResponse?.Marker;
                isTruncated = listResponse?.IsTruncated || false;
            } while (isTruncated);

            return counts;
        } catch (error) {
            console.error('❌ Error during cleanup of resources without stackName:', error);
            return counts;
        }
    }
}

/**
 * Parse command line arguments
 */
function parseArguments(): CleanupOptions {
    const arguments_ = process.argv.slice(2);
    const options: CleanupOptions = {
        discover: false,
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
            case '--discover-by-patterns': {
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
function showHelp(): void {
    console.log(`
🧹 AWS Resource Cleanup Script for One Observability Workshop

USAGE:
    npm run cleanup -- [OPTIONS]

OPTIONS:
    --stack-name <name>       Specific stack name to clean up
    --discover                List all found workshop stack names
    --region <region>         AWS region (default: us-east-1 or AWS_REGION)
    --cleanup-missing-tags    Clean up resources without valid stackName tags
    --skip-confirmation       Skip confirmation prompts (use with caution)
    --help                    Show this help message

EXAMPLES:
    # Discover all workshop stack names
    npm run cleanup -- --discover

    # Clean up a specific stack (shows preview first, then asks for confirmation)
    npm run cleanup -- --stack-name MyWorkshopStack

    # Clean up resources without valid stackName tags
    npm run cleanup -- --cleanup-missing-tags

    # Clean up in a specific region
    npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2

⚠️  SAFETY NOTICE:
    This script performs destructive operations that cannot be undone!
    The script automatically shows a preview first, then asks for confirmation before proceeding.
`);
}

/**
 * Print summary report
 */
function printSummary(counts: ResourceCounts, dryRun: boolean): void {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    console.log(`\n📊 ${dryRun ? '[DRY RUN] ' : ''}Cleanup Summary:`);
    console.log(`   CloudWatch Log Groups: ${counts.cloudwatchLogs}`);
    console.log(`   EBS Volumes: ${counts.ebsVolumes}`);
    console.log(`   EBS Snapshots: ${counts.ebsSnapshots}`);
    console.log(`   RDS Backups: ${counts.rdsBackups}`);
    console.log(`   ECS Task Definitions: ${counts.ecsTaskDefinitions}`);
    console.log(`   S3 Buckets: ${counts.s3Buckets}`);
    console.log(`   SSM Parameters: ${counts.ssmParameters}`);
    console.log(`   Lambda Functions: ${counts.lambdaFunctions}`);
    console.log(`   IAM Roles: ${counts.iamRoles}`);
    console.log(`   IAM Policies: ${counts.iamPolicies}`);
    console.log(`   Total Resources: ${total}`);

    if (total === 0) {
        console.log('\n✨ No resources found to clean up!');
    } else if (dryRun) {
        console.log(`\n⚠️  This was a dry run. To actually delete these ${total} resources, run without --dry-run`);
    } else {
        console.log(`\n✅ Successfully cleaned up ${total} resources!`);
    }
}

/**
 * Prompt for user confirmation
 */
async function promptConfirmation(stackName: string, dryRun: boolean): Promise<boolean> {
    if (dryRun) return true;

    const { createInterface } = await import('node:readline');
    return new Promise((resolve) => {
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        readline.question(
            `\n⚠️  You are about to DELETE resources for stack "${stackName}". This action cannot be undone!\n` +
                'Type "yes" to continue or anything else to cancel: ',
            (answer: string) => {
                readline.close();
                resolve(answer.toLowerCase() === 'yes');
            },
        );
    });
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
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
        } catch {
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
                console.log('npm run cleanup -- --cleanup-missing-tags');
            } else {
                console.log('\nFound the following workshop stack names:');
                for (const stackName of stackNames) {
                    console.log(`   • ${stackName}`);
                }

                console.log('\nTo clean up a specific stack, run:');
                console.log('npm run cleanup -- --stack-name <STACK_NAME>');
                console.log('\nTo clean up resources without proper stackName tags, run:');
                console.log('npm run cleanup -- --cleanup-missing-tags');
            }
        } else if (options.cleanupMissingTags) {
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

            // Always perform dry run first
            console.log('\n🔍 Performing dry run to show what would be deleted...\n');
            const dryRunCounts = await cleanup.cleanupResourcesWithoutStackNameTag(true);
            printSummary(dryRunCounts, true);

            if (dryRunCounts && Object.values(dryRunCounts).some((count) => count > 0)) {
                if (!options.skipConfirmation) {
                    const confirmed = await promptConfirmation('resources without stackName tags', false);
                    if (!confirmed) {
                        console.log('❌ Operation cancelled by user.');
                        process.exit(0);
                    }
                }

                // Perform actual cleanup
                console.log('\n🗑️  Performing actual cleanup...\n');
                const actualCounts = await cleanup.cleanupResourcesWithoutStackNameTag(false);
                printSummary(actualCounts, false);
            }
        } else if (options.stackName) {
            // Stack-specific cleanup - always perform dry run first
            console.log(`\n🔍 Performing dry run for stack "${options.stackName}" to show what would be deleted...\n`);
            const dryRunCounts = await cleanup.cleanupStack(options.stackName, true);
            printSummary(dryRunCounts, true);

            if (dryRunCounts && Object.values(dryRunCounts).some((count) => count > 0)) {
                if (!options.skipConfirmation) {
                    const confirmed = await promptConfirmation(options.stackName, false);
                    if (!confirmed) {
                        console.log('❌ Operation cancelled by user.');
                        process.exit(0);
                    }
                }

                // Perform actual cleanup
                console.log('\n🗑️  Performing actual cleanup...\n');
                const actualCounts = await cleanup.cleanupStack(options.stackName, false);
                printSummary(actualCounts, false);
            }
        }
    } catch (error) {
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
        } catch (error) {
            console.error('❌ Unhandled error:', error);
            process.exit(1);
        }
    })();
}
