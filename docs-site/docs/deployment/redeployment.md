# Application Redeployment

The `redeploy-app.sh` script automates building container images, pushing to ECR, and triggering service redeployments.

## Prerequisites

- AWS CLI configured with credentials
- Container runtime: Docker (recommended), Finch, or Podman
- `src/cdk/.env` with `AWS_REGION` and `AWS_ACCOUNT_ID`
- Deployed One Observability Demo infrastructure

## Usage

```bash
# Auto-detect container tool
./src/cdk/scripts/redeploy-app.sh

# Specify a tool
./src/cdk/scripts/redeploy-app.sh docker
./src/cdk/scripts/redeploy-app.sh finch
```

The script prompts you to:

1. Select the application to redeploy
2. Select the target platform (amd64 or arm64)
3. For ECS apps: select cluster and service
4. For EKS apps: follow the provided kubectl instructions

## Available Applications

| Application | Host | Description |
|-------------|------|-------------|
| payforadoption-go | ECS | Payment processing (Go) |
| petlistadoption-py | ECS | Pet listing (Python/FastAPI) |
| petsearch-java | ECS | Pet search (Java/Spring Boot) |
| petsite-net | EKS | Frontend (.NET) |
| petfood-rs | ECS | Food catalog (Rust/Axum) |
| petfoodagent-strands-py | AgentCore | AI agent (container build only) |

## Monitoring ECS Deployments

```bash
# Check service status
aws ecs describe-services --cluster <cluster> --services <service>

# Watch deployment events
aws ecs describe-services --cluster <cluster> --services <service> \
  --query 'services[0].events[0:5]' --output table
```

## EKS Deployments

```bash
kubectl rollout restart deployment/petsite
kubectl rollout status deployment/petsite
kubectl get pods -l app=petsite
```
