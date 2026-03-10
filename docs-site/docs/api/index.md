# API Reference

The CDK construct library is documented with TypeDoc. The API reference is generated from JSDoc comments in the source code under `src/cdk/lib/`.

## CDK Constructs

| Construct | Description |
|-----------|-------------|
| `NetworkConstruct` | VPC with public/private subnets and NAT gateways |
| `VpcEndpointsConstruct` | Interface and gateway endpoints for AWS services |
| `EcsConstruct` | ECS Fargate cluster configuration |
| `EksConstruct` | EKS cluster with managed node groups |
| `EcsServiceConstruct` | ECS service with FireLens logging and observability |
| `EksDeploymentConstruct` | EKS Kubernetes deployment |
| `DatabaseConstruct` | Aurora PostgreSQL database |
| `DynamoDbConstruct` | DynamoDB tables |
| `QueueConstruct` | SQS message queues |
| `EventBusConstruct` | EventBridge event bus |
| `CloudTrailConstruct` | CloudTrail audit logging |
| `CloudWatchConstruct` | CloudWatch dashboards and alarms |
| `WafConstruct` | WAF web ACLs |
| `CanaryConstruct` | CloudWatch Synthetics canaries |
| `LambdaConstruct` | Lambda function definitions |
| `MicroserviceConstruct` | High-level microservice orchestration |
| `AssetsConstruct` | S3 assets with CloudFront CDN |
| `OpenSearchApplicationConstruct` | OpenSearch Serverless application |
| `OpenSearchCollectionConstruct` | OpenSearch Serverless collection |
| `OpenSearchPipelineConstruct` | OpenSearch ingestion pipeline |

## Pipeline Stages

| Stage | Description |
|-------|-------------|
| `CoreStage` | Networking, security, observability infrastructure |
| `ContainersStage` | Container image builds for all microservices |
| `StorageStage` | Databases, queues, object storage |
| `ComputeStage` | ECS and EKS clusters, load balancers |
| `ApplicationsStage` | Microservice deployments, Lambda functions, canaries |

## Microservice Definitions

| Module | Description |
|--------|-------------|
| `PayForAdoption` | Go payment processing service |
| `PetSearch` | Java/Spring Boot search service |
| `PetListAdoptions` | Python/FastAPI listing service |
| `PetSite` | .NET web frontend |
| `PetFood` | Rust/Axum food catalog |
| `PetFoodAgent` | Python AI agent |

## Source

Browse the CDK source code at [`src/cdk/lib/`](https://github.com/aws-samples/one-observability-demo/tree/main/src/cdk/lib).
