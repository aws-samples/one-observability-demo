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
- **Container Runtime**: One of the following (checked in priority order):
  - Docker (recommended)
  - Finch
  - Podman

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
   ./src/cdk/scripts/redeploy-app.sh
   ```

3. Follow the interactive prompts:
   - Select the application to redeploy
   - For ECS applications: Select cluster and service
   - For EKS applications: Follow the provided kubectl instructions

### Available Applications

The script automatically reads from `src/cdk/bin/environment.ts` and presents these applications:

| Application | Host Type | Description |
|-------------|-----------|-------------|
| payforadoption-go | ECS | Payment processing service (Go) |
| petlistadoption-go | ECS | Pet listing service (Go) |
| petsearch-java | ECS | Pet search service (Java) |
| petsite | EKS | Frontend web application |
| trafficgenerator | ECS | Load testing service |

## Cross-Platform Building

The script automatically handles cross-platform builds for ARM development machines targeting x86/amd64 AWS instances:

- **Docker**: Uses `buildx` with `--platform linux/amd64`
- **Finch/Podman**: Uses `--platform linux/amd64` flag

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

For EKS-hosted applications (like `petsite`), the script provides kubectl commands for manual restart:

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