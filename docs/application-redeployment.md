<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Application Redeployment Guide

This guide explains how to use the application redeployment script to quickly deploy new versions of microservices for testing and development.

## Overview

The `redeploy-app.sh` script automates the process of:
1. Building container images with cross-platform support
2. Pushing images to Amazon ECR
3. Triggering service redeployments on ECS or providing EKS instructions

## Prerequisites

### Required Tools
- **AWS CLI**: Configured with credentials for your target account
- **Container Runtime**: One of the following:
  - Docker (recommended)
  - Finch
  - Podman

  The script will auto-detect available tools in priority order (docker → finch → podman), or you can specify your preferred tool as the first argument to the script.

### Configuration File
- **Environment File**: `src/cdk/.env` must exist with the following variables:
  - `AWS_REGION`: Target AWS region
  - `AWS_ACCOUNT_ID`: Your AWS account ID

### AWS Permissions
Your AWS credentials must have permissions for:
- ECR: `GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`, `PutImage`
- ECS: `ListClusters`, `ListServices`, `DescribeServices`, `UpdateService`
- STS: `GetCallerIdentity`

### Infrastructure Requirements
- One Observability Demo infrastructure must be deployed
- ECR repositories must exist for the applications
- ECS clusters and services (for ECS-hosted applications)
- EKS cluster with kubectl access (for EKS-hosted applications)

## Usage

### Basic Usage

1. Navigate to the repository root:
   ```bash
   cd /path/to/one-observability-demo
   ```

2. Run the script:
   ```bash
   # Auto-detect OCI tool (docker, finch, or podman)
   ./src/cdk/scripts/redeploy-app.sh

   # Or specify a specific OCI tool
   ./src/cdk/scripts/redeploy-app.sh docker
   ./src/cdk/scripts/redeploy-app.sh finch
   ./src/cdk/scripts/redeploy-app.sh podman
   ```

3. Follow the interactive prompts:
   - Select the application to redeploy
   - Select the target platform (amd64 or arm64)
   - For ECS applications: Select cluster and service
   - For EKS applications: Follow the provided kubectl instructions

### Available Applications

The script automatically reads from `src/cdk/bin/environment.ts` and presents all configured applications:

| Application | Host Type | Description |
|-------------|-----------|-------------|
| payforadoption-go | ECS | Payment processing service (Go) |
| petlistadoption-py | ECS | Pet listing service (Python/FastAPI) |
| petsearch-java | ECS | Pet search service (Java/Spring Boot) |
| petsite-net | EKS | Frontend web application (.NET) |
| petfood-rs | ECS | Food catalog and cart API (Rust/Axum) |
| petfoodagent-strands-py | None | AI agent (Bedrock AgentCore, container build only) |

## Platform Selection

The script prompts you to select the target platform architecture:

- **amd64 (default)**: For x86_64 AWS instances (most common)
- **arm64**: For ARM-based AWS instances (Graviton)

The script automatically handles cross-platform builds:

- **Docker**: Uses `buildx` with `--platform` flag
- **Finch/Podman**: Uses `--platform` flag with QEMU emulation

## ECS Deployment Process

For ECS-hosted applications, the script:

1. Lists all available ECS clusters
2. Auto-selects if only one cluster exists, otherwise prompts for selection
3. Lists all services in the selected cluster
4. Prompts for service selection
5. Triggers a forced redeployment using `aws ecs update-service --force-new-deployment`

### Monitoring ECS Deployments

After triggering a redeployment, monitor progress with:

```bash
# Check service status
aws ecs describe-services --cluster <cluster-name> --services <service-name>

# Watch deployment events
aws ecs describe-services --cluster <cluster-name> --services <service-name> \
  --query 'services[0].events[0:5]' --output table
```

## EKS Deployment Process

For EKS-hosted applications (like `petsite-net`), the script provides kubectl commands for manual restart:

```bash
# Restart deployment
kubectl rollout restart deployment/petsite

# Check deployment status
kubectl rollout status deployment/petsite

# View pods
kubectl get pods -l app=petsite
```

## Troubleshooting

### Common Issues

**Error: No OCI runner found**
- Install Docker, Finch, or Podman
- Ensure the tool is in your PATH

**Error: Not logged into AWS**
- Configure AWS CLI: `aws configure`
- Or use AWS SSO: `aws sso login`

**Error: ECR login failed**
- Verify AWS credentials have ECR permissions
- Check if ECR repositories exist in your account

**Error: No ECS clusters found**
- Ensure One Observability Demo infrastructure is deployed
- Verify you're in the correct AWS region

**Error: Cross-platform build failed**
- For Docker: Enable buildx with `docker buildx create --use`
- For Podman: Update to latest version with multi-arch support

### Debug Mode

Run with debug output:
```bash
bash -x ./src/cdk/scripts/redeploy-app.sh
```

### Manual ECR Operations

If needed, perform ECR operations manually:

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker buildx build --platform linux/amd64 \
  -t 123456789012.dkr.ecr.us-east-1.amazonaws.com/petsite:latest \
  --push .
```

## Script Configuration

### Environment File

The script reads AWS configuration from `src/cdk/.env`:

```bash
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
```

### Application Configuration

The script reads application configurations from `src/cdk/bin/environment.ts`, specifically the `APPLICATION_LIST` constant. To add new applications:

1. Define the application in `environment.ts`
2. Add it to the `APPLICATION_LIST` array
3. The script will automatically detect it

## Security Considerations

- The script uses your current AWS credentials
- Container images are pushed to ECR in your account
- ECS service updates trigger new task deployments
- Ensure your development images don't contain sensitive data

## Performance Tips

- Use Docker buildx for faster multi-platform builds
- Consider using ECR image scanning for security
- Monitor ECS service metrics during deployments
- Use ECS deployment circuit breaker for safer rollouts