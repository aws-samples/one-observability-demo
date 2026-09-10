# Microservices Overview

The One Observability Demo deploys 6 microservices, each written in a different language and using a different observability instrumentation strategy.

## Service Map

```mermaid
flowchart TD
    User["User"] --> PetSite["petsite-net<br/>.NET / EKS"]
    PetSite --> PetSearch["petsearch-java<br/>Java / ECS"]
    PetSite --> PetList["petlistadoptions-py<br/>Python / ECS"]
    PetSite --> PayFor["payforadoption-go<br/>Go / ECS"]
    PetSite --> PetFood["petfood-rs<br/>Rust / ECS"]
    PetSite --> Waggle["waggle-ai-agents<br/>Python / AgentCore"]
    PetFood --> EB["EventBridge"]
    EB --> StockProcessor["Stock Processor λ"]
    EB --> ImageGen["Image Generator λ"]
    PetList --> Aurora["Aurora PostgreSQL"]
    PayFor --> Aurora
    PayFor --> DynamoDB["DynamoDB"]
    PetFood --> DynamoDB
    PetSearch --> DynamoDB
```

## Services at a Glance

| Service | Language | Platform | Observability | Description |
|---------|----------|----------|---------------|-------------|
| [`payforadoption-go`](payforadoption-go.md) | Go | ECS Fargate | OTel Go SDK + CloudWatch agent | Payment processing |
| [`petsearch-java`](petsearch-java.md) | Java/Spring Boot | ECS Fargate | Application Signals | Pet search |
| [`petlistadoptions-py`](petlistadoptions-py.md) | Python/FastAPI | ECS Fargate | ADOT auto-instrumentation | Pet listing and adoptions |
| [`petsite-net`](petsite-net.md) | .NET | EKS | CloudWatch agent | Web frontend |
| [`petfood-rs`](petfood-rs.md) | Rust/Axum | ECS Fargate | OTel Rust SDK + Prometheus | Food catalog and cart |
| [`waggle-ai-agents`](waggle-ai-agents.md) | Python (5 frameworks) | Bedrock AgentCore | ADOT per framework | Waggle, the PetStore assistant |

## Container Build Pipeline

All container images are built in parallel during the Containers Stage using a dedicated CodePipeline:

1. **Source** — Retrieves source from S3 bucket or CodeConnection (GitHub)
2. **Build** — Parallel container builds for all services, pushed to ECR
