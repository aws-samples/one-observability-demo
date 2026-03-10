# Changelog

All notable changes to the One Observability Demo are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Security scanning: Enabled `fail-on-findings` on GitHub Actions ASH workflow and pre-commit ASH hook
- Security scanning: Switched to official ASH reusable workflow with Grype and Syft enabled
- Security scanning: Disabled cfn-nag scanner (redundant with Checkov/cdk-nag)
- Pre-commit hooks: Upgraded all hook revisions to latest versions

## [3.0.0] - 2026-03-07

### Added

- **Pet Food microservice** (`petfood-rs`): Rust/Axum on ECS Fargate with OTel Rust SDK, DynamoDB, EventBridge, Prometheus metrics
- **Pet Food Agent** (`petfoodagent-strands-py`): Python AI agent on Bedrock AgentCore using Strands Agents SDK
- **Pet Food serverless functions**: Stock processor, image generator (Bedrock Titan), cleanup processor via EventBridge
- **Application Signals integration**: L2 construct on petsearch-java with SLO definitions
- **OpenSearch Serverless**: Collection and ingestion pipeline for centralized log analytics
- **VPC Endpoints construct**: Interface and gateway endpoints for private connectivity
- **CodeConnection support**: Pipeline source via AWS CodeConnection (GitHub)
- **Parameter Store configuration**: Centralized config via SSM with `retrieve-config.sh`
- **CDK cleanup automation**: Step Functions state machine with async polling
- **Cleanup script**: Tag-based discovery and deletion of orphaned resources
- **DynamoDB seeding script**: Interactive and non-interactive modes
- **Image generation script**: Bedrock Titan Image Generator v2 with retry logic
- **Application redeployment script**: Cross-platform container builds
- **ECS port forwarding script**: Session Manager-based port forwarding
- **Workshop NAG pack**: Custom CDK Nag rule pack
- **Canaries**: CloudWatch Synthetics for traffic generation and housekeeping
- **GitHub Actions**: Documentation, security scanning, acceptance tests, pre-commit
- **Documentation**: Comprehensive TypeDoc API docs with JSDoc on all source files

### Changed

- Pipeline architecture: 5 stages across 2 waves plus standalone Microservices stage
- Pet List Adoptions: Migrated from Go to Python/FastAPI with ADOT auto-instrumentation
- Pet Site: Renamed to `petsite-net`, deployed on EKS with CloudFront and WAF
- Observability: Per-service instrumentation strategy across 5 different approaches
- FireLens log routing on all ECS tasks
- Container Insights on both ECS and EKS clusters

### Fixed

- Documentation accuracy: microservice count, languages, stage structure, diagram references

## [2.0.0] - 2025-01-01

### Added

- CDK Pipeline with CodePipeline V2
- ECS and EKS container orchestration
- Pay for Adoption (Go), Pet Search (Java), Pet Site (.NET) microservices
- Aurora PostgreSQL and DynamoDB data stores
- CloudFormation CodeBuild deployment template with retry handling
- X-Ray distributed tracing and CloudWatch metrics

## [1.0.0] - 2024-12-01

### Added

- Initial release of One Observability Demo workshop infrastructure
