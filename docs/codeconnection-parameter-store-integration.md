# CodeConnection and Parameter Store Integration

This document describes the implementation of CodeConnection integration and Parameter Store configuration management for the One Observability Workshop CDK pipeline.

## Overview

The pipeline now supports two modes of operation:

1. **CodeConnection Mode**: Uses AWS CodeConnection to connect directly to GitHub repositories
2. **S3 Fallback Mode**: Uses S3 bucket as the source (existing functionality)

Additionally, configuration management has been moved from local `.env` files to AWS Systems Manager Parameter Store for better security and centralization.

## Implementation Details

### CloudFormation Template Updates

**File**: `src/templates/codebuild-deployment-template.yaml`

#### New Parameters

- `pCodeConnectionArn`: Optional CodeConnection ARN for GitHub integration
- `pParameterStoreBasePath`: Base path in Parameter Store for configuration storage (default: `/oneobservability/workshop`)

#### Updated IAM Permissions

The CodeBuild service role now includes Parameter Store permissions:

```yaml
- Effect: Allow
  Action:
      - ssm:GetParameter
      - ssm:GetParameters
      - ssm:GetParametersByPath
  Resource: !Sub '${pParameterStoreBasePath}*'
```

#### Updated BuildSpec

The initial CodeBuild job now:

1. Stores configuration in Parameter Store instead of customizing `.env` files
2. Handles conditional repository source setup (CodeConnection vs S3)

### CDK Pipeline Updates

**File**: `src/cdk/lib/pipeline.ts`

#### Interface Changes

```typescript
export interface CDKPipelineProperties extends StackProps {
    // ... existing properties
    /** Optional CodeConnection ARN for GitHub integration */
    codeConnectionArn?: string;
    /** Base path in Parameter Store for configuration storage */
    parameterStoreBasePath?: string;
    /** CloudFormation stack name for parameter retrieval */
    stackName?: string;
}
```

#### Conditional Source Selection

```typescript
if (properties.codeConnectionArn) {
    // Use CodeConnection as pipeline source
    pipelineSource = CodePipelineSource.connection(
        `${properties.organizationName}/${properties.repositoryName}`,
        properties.branchName,
        { connectionArn: properties.codeConnectionArn },
    );
} else {
    // Fallback to S3 bucket source
    configBucket = Bucket.fromBucketName(this, 'ConfigBucket', properties.configBucketName);
    pipelineSource = CodePipelineSource.s3(configBucket, bucketKey, {
        trigger: S3Trigger.POLL,
    });
}
```

#### Parameter Store Integration

Both the synthesis step and exports dashboard step now use a reusable script to retrieve configuration from Parameter Store.

### Configuration Retrieval Script

**File**: `src/cdk/scripts/retrieve-config.sh`

This reusable bash script:

1. Accepts Parameter Store base path as parameter
2. Retrieves all parameters under the specified path
3. Creates `.env` file with proper formatting
4. Provides fallback to local `.env` file if Parameter Store is not configured

Usage:

```bash
./scripts/retrieve-config.sh "/oneobservability/workshop"
```

## Usage

### Deploying with CodeConnection

1. Create a CodeConnection in AWS Console
2. Deploy the CloudFormation template with the CodeConnection ARN:

```bash
aws cloudformation deploy \
  --template-file src/templates/codebuild-deployment-template.yaml \
  --stack-name one-observability-pipeline \
  --parameter-overrides \
    pCodeConnectionArn=arn:aws:codeconnections:region:account:connection/connection-id \
    pParameterStoreBasePath=/oneobservability/workshop \
  --capabilities CAPABILITY_IAM
```

### Deploying with S3 Fallback

Deploy without the CodeConnection ARN parameter:

```bash
aws cloudformation deploy \
  --template-file src/templates/codebuild-deployment-template.yaml \
  --stack-name one-observability-pipeline \
  --parameter-overrides \
    pParameterStoreBasePath=/oneobservability/workshop \
  --capabilities CAPABILITY_IAM
```

### Parameter Store Configuration

Store your configuration parameters in Parameter Store:

```bash
# Example configuration parameters
aws ssm put-parameter \
  --name "/oneobservability/workshop/CUSTOM_ENABLE_WAF" \
  --value "true" \
  --type "String"

aws ssm put-parameter \
  --name "/oneobservability/workshop/AWS_REGION" \
  --value "us-east-1" \
  --type "String"

aws ssm put-parameter \
  --name "/oneobservability/workshop/ORGANIZATION_NAME" \
  --value "aws-samples" \
  --type "String"
```

## Benefits

1. **Security**: Configuration stored centrally in Parameter Store instead of local files
2. **Flexibility**: Supports both CodeConnection and S3 sources
3. **Consistency**: Same configuration retrieval mechanism across all pipeline steps
4. **Maintainability**: Reusable script reduces code duplication
5. **Auditability**: Parameter Store provides audit trails for configuration changes

## Migration Path

Existing deployments using S3 bucket source will continue to work unchanged. To migrate to CodeConnection:

1. Create a CodeConnection in AWS Console
2. Update the CloudFormation stack with the CodeConnection ARN
3. Migrate configuration from `.env` files to Parameter Store
4. Redeploy the pipeline

The pipeline will automatically detect and use the CodeConnection when available, falling back to S3 bucket source otherwise.
