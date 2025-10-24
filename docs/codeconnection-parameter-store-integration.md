# CodeConnection and Parameter Store Integration

This document describes the implementation of CodeConnection integration and Parameter Store configuration management for the One Observability Workshop CDK pipeline.

## Overview

The pipeline now supports two modes of operation:

1. **CodeConnection Mode**: Uses AWS CodeConnection to connect directly to GitHub repositories
2. **S3 Fallback Mode**: Uses S3 bucket as the source (existing functionality)

Additionally, configuration management has been moved from local `.env` files to AWS Systems Manager Parameter Store for better security and centralization. The implementation uses a **single parameter** approach for efficiency, storing the entire configuration as one parameter instead of multiple individual parameters.

## Implementation Details

### CloudFormation Template Updates

**File**: `src/templates/codebuild-deployment-template.yaml`

#### New Parameters

- `pCodeConnectionArn`: Optional CodeConnection ARN for GitHub integration
- `pParameterStoreBasePath`: Base path in Parameter Store for configuration storage (default: `/petstore`)

#### New CloudFormation Resources

- `rWorkshopConfigParameter`: Parameter Store parameter created as CloudFormation resource for proper lifecycle management

```yaml
rWorkshopConfigParameter:
    Type: AWS::SSM::Parameter
    Properties:
        Name: !Sub '${pParameterStoreBasePath}/${AWS::StackName}/config'
        Type: String
        Value: '# Configuration will be populated by CodeBuild'
        Description: !Sub 'Workshop configuration for stack ${AWS::StackName}'
```

#### Updated IAM Permissions

The CodeBuild service role now includes Parameter Store permissions:

```yaml
- PolicyName: ParameterStoreAccess
  PolicyDocument:
      Version: '2012-10-17'
      Statement:
          - Effect: Allow
            Action:
                - ssm:GetParameter
                - ssm:GetParameters
                - ssm:GetParametersByPath
                - ssm:PutParameter
                - ssm:DeleteParameter
            Resource: !Sub 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter${pParameterStoreBasePath}/*'
```

#### Updated BuildSpec

The initial CodeBuild job now:

1. Populates the CloudFormation-created Parameter Store parameter with the entire configuration
2. Handles conditional repository source setup (CodeConnection vs S3)
3. No longer stores CodeConnection ARN separately in Parameter Store (it's included in the main configuration)

### CDK Pipeline Updates

#### Environment Configuration

**File**: `src/cdk/bin/environment.ts`

Added support for CodeConnection ARN via environment variable:

```typescript
export const CODE_CONNECTION_ARN = process.env.CODE_CONNECTION_ARN;
```

#### Workshop Entry Point

**File**: `src/cdk/bin/workshop.ts`

Updated the CDKPipeline constructor to include new parameters:

```typescript
const pipeline = new CDKPipeline(this, 'Pipeline', {
    // ... existing properties
    codeConnectionArn: context.codeConnectionArn || CODE_CONNECTION_ARN,
    parameterStoreBasePath: context.parameterStoreBasePath,
    stackName: stackName,
});
```

#### Local Development Configuration

**File**: `src/cdk/bin/local.ts`

Updated the ContainersStack configuration with conditional source selection:

```typescript
if (codeConnectionArn) {
    // Use CodeConnection as pipeline source
    repositorySource = RepositorySource.connection({
        organizationName,
        repositoryName,
        branchName,
        connectionArn: codeConnectionArn,
    });
} else {
    // Fallback to S3 bucket source
    repositorySource = RepositorySource.s3({
        configBucketName,
        repositoryName,
        branchName,
    });
}
```

#### Parameter Store Integration

Both the synthesis step and exports dashboard step now use a reusable script to retrieve configuration from Parameter Store with the single parameter approach.

### Configuration Retrieval Script

**File**: `src/cdk/scripts/retrieve-config.sh`

This reusable bash script:

1. Accepts Parameter Store parameter name as argument
2. Retrieves the single configuration parameter containing the entire `.env` file content
3. Creates `.env` file from the Parameter Store content
4. Provides fallback to local `.env` file if Parameter Store retrieval fails

Usage:

```bash
./scripts/retrieve-config.sh "/petstore/stack-name/config"
```

The script implements the **single parameter approach** for optimal performance, retrieving all configuration in one API call instead of multiple calls for individual parameters.

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

The configuration is automatically populated by the CloudFormation template's CodeBuild process. The **single parameter** contains the entire `.env` file content:

```bash
# Example: View the configuration parameter created by CloudFormation
aws ssm get-parameter \
  --name "/petstore/your-stack-name/config" \
  --with-decryption

# The parameter value contains the entire configuration as a single .env format:
# CUSTOM_ENABLE_WAF=true
# AWS_REGION=us-east-1
# ORGANIZATION_NAME=aws-samples
# CODE_CONNECTION_ARN=arn:aws:codeconnections:region:account:connection/connection-id
# ... (all other configuration variables)
```

**Note**: The parameter is managed by CloudFormation and automatically populated during the initial CodeBuild process. Manual configuration changes should be made by updating the source configuration file and rerunning the pipeline.

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
