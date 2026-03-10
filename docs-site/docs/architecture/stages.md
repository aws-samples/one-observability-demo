# Deployment Stages

## 1. Core Stage

Deploys foundational infrastructure required by all other stages.

- VPC with public/private subnets, NAT gateways
- VPC Endpoints for private AWS service connectivity (SSM, ECR, CloudWatch, X-Ray, STS, EventBridge, S3, DynamoDB)
- Security groups and IAM roles
- CloudTrail audit logging
- EventBridge event bus
- OpenSearch Serverless collection and ingestion pipeline

![Core Stage Resources](../assets/diagrams/core-stage-resources.png)

## 2. Containers Stage

Builds and pushes container images for all microservices using a dedicated CodePipeline.

| Service | Language | Architecture |
|---------|----------|-------------|
| `payforadoption-go` | Go | AMD64 |
| `petlistadoption-py` | Python/FastAPI | AMD64 |
| `petsearch-java` | Java/Spring Boot | AMD64 |
| `petsite-net` | .NET | AMD64 |
| `petfood-rs` | Rust/Axum | AMD64 |
| `petfoodagent-strands-py` | Python/Strands | ARM64 |

Pipeline: Source Stage → Parallel Build Stage (all 6 services)

## 3. Storage Stage

Deploys data persistence and messaging resources.

- **Amazon DynamoDB** — Pet adoption, pet foods, and pet foods cart tables
- **Amazon Aurora PostgreSQL** — Relational database for structured data
- **Amazon S3** — Workshop assets bucket with pet images, CloudFront CDN
- **Amazon SQS** — Message queue for decoupled communication

Post-deployment steps: DynamoDB seeding and RDS seeding run as CodeBuild steps.

![Storage Stage Resources](../assets/diagrams/storage-stage-resources.png)

## 4. Compute Stage

Deploys container orchestration platforms.

- **Amazon ECS** — Fargate cluster for microservice tasks
- **Amazon EKS** — Kubernetes cluster with managed node groups
- **Application Load Balancers** — Traffic distribution for ECS and EKS
- **Container Insights** — Enabled on both clusters

![Compute Stage Resources](../assets/diagrams/compute-stage-resources-corrected.png)

!!! note
    Lambda functions and microservice task definitions are deployed in the Microservices Stage, not here. This stage only creates the clusters and load balancers.

## 5. Microservices Stage

Deploys all microservices, serverless functions, canaries, and WAF rules.

### Microservices

- 4 ECS services: payforadoption-go, petlistadoptions-py, petsearch-java, petfood-rs
- 1 EKS deployment: petsite-net (with CloudFront distribution and WAF)
- 1 Bedrock AgentCore deployment: petfoodagent-strands-py

### Lambda Functions

| Function | Runtime | Purpose |
|----------|---------|---------|
| StatusUpdater | Node.js | Updates pet adoption status in DynamoDB |
| UserCreator | Node.js | Creates Cognito users |
| RdsSeeder | Node.js | Seeds Aurora PostgreSQL |
| TrafficGenerator | Node.js | Generates synthetic traffic |
| PetfoodStockProcessor | Node.js | Processes food stock events from EventBridge |
| PetfoodImageGenerator | Node.js | Generates pet food images via Bedrock |
| PetfoodCleanupProcessor | Node.js | Cleans up expired food listings |

### Canaries

- **TrafficGeneratorCanary** — CloudWatch Synthetics canary for continuous traffic
- **HousekeepingCanary** — Periodic cleanup of stale resources

### WAF

- Regional WAF on ALB
- Global WAF on CloudFront (optional, controlled by feature flag)

## Stage Dependencies

```mermaid
flowchart TD
    Core["Core Stage"] --> Containers["Containers Stage"]
    Core --> Storage["Storage Stage"]
    Core --> Compute["Compute Stage"]
    Containers --> Microservices["Microservices Stage"]
    Storage --> Microservices
    Compute --> Microservices
```
