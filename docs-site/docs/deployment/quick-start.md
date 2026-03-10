# Quick Start

## Prerequisites

- IAM role with elevated privileges
- AWS CLI installed and configured
- Appropriate AWS permissions for CloudFormation, CodeBuild, and related services

## Deploy the Workshop

```bash
aws cloudformation create-stack \
  --stack-name OneObservability-Workshop-CDK \
  --template-body file://src/templates/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

## With Custom Configuration

```bash
aws cloudformation create-stack \
  --stack-name OneObservability-Workshop-CDK \
  --template-body file://src/templates/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pConfigFileUrl,ParameterValue=https://example.com/config.json \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk \
    ParameterKey=pUserDefinedTagKey1,ParameterValue=Environment \
    ParameterKey=pUserDefinedTagValue1,ParameterValue=Workshop
```

## Local Development

For faster iteration without the full pipeline:

```bash
# Navigate to CDK directory
cd src/cdk

# Copy and configure environment
cp .env.sample .env
# Edit .env with your AWS account details

# Run deploy check
./scripts/deploy-check.sh

# List stacks
cdk -a "npx ts-node bin/local.ts" list

# Deploy all
cdk -a "npx ts-node bin/local.ts" deploy --all
```

## What Gets Deployed

The deployment creates a CDK Pipeline that provisions resources in 5 stages:

1. **Core** — VPC, security groups, VPC endpoints, CloudTrail, EventBridge, OpenSearch
2. **Containers** — Container image builds for all 6 microservices
3. **Storage** — DynamoDB, Aurora PostgreSQL, S3, SQS, data seeding
4. **Compute** — ECS cluster, EKS cluster, load balancers
5. **Microservices** — Service deployments, Lambda functions, canaries, WAF

For full architecture details, see the [Architecture Overview](../architecture/overview.md).

## Cleanup

After completing the workshop:

```bash
# Primary cleanup
cdk destroy --all

# Find remaining resources
npm run cleanup -- --discover

# Clean specific leftovers
npm run cleanup -- --stack-name MyStack --dry-run
npm run cleanup -- --stack-name MyStack
```

See [Cleanup Script](../operations/cleanup.md) and [CDK Cleanup](../operations/cdk-cleanup.md) for detailed instructions.
