# Changelog

All notable changes to the One Observability Demo are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Security scanning: Enabled `fail-on-findings` on GitHub Actions ASH workflow and pre-commit ASH hook
- Security scanning: Switched to official ASH reusable workflow with Grype and Syft enabled
- Security scanning: Disabled cfn-nag scanner (redundant with Checkov/cdk-nag)
- Pre-commit hooks: Upgraded all hook revisions to latest versions

## [3.1.0] - 2026-08-19

### Added

- **Waggle AI agents** (`waggle_ai_agents`): multi-agent system on Bedrock AgentCore (ARM64) — a Strands orchestrator delegating to four framework-diverse sub-agents: nutrition (LangGraph), ordering (CrewAI), adoption (LlamaIndex), concierge (OpenAI Agents SDK), each on a different model so one trace spans several frameworks
- **AgentCore Memory**: short and long-term strategies for recall across turns and sessions
- **AgentCore Gateway**: single entry point fronting the sub-agents
- **Bedrock Guardrail**: content filtering on the orchestrator
- **Nutrition Knowledge Base**: RAG over S3 Vectors across a 10-document nutrition corpus
- **Waggle chat widget** (`petsite-net`): floating chat streaming orchestrator responses over SigV4-signed requests, resolving the AgentCore endpoint from SSM at startup
- **`ENABLE_WAGGLE_AI_AGENTS`**: feature flag gating the agent stack; the pre-rename `ENABLE_PET_FOOD_AGENT` is still honored

### Changed

- CDK: upgraded `aws-cdk-lib` 2.241 to 2.265 (plus alpha modules) for AgentCore and S3 Vectors support
- PetSite UI: refreshed navigation, cards, and dark-mode contrast around the chat widget

### Removed

- **Pet Food Agent** (`petfoodagent-strands-py`): superseded by the Waggle AI agents

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
