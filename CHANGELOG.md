<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Changelog

All notable changes to the One Observability Demo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note**: Releases prior to 3.0.0 were not tracked with a formal changelog or
> semantic versioning. The version history below begins with the adoption of
> structured release management.

## [Unreleased]

### Changed
- **Security scanning**: Enabled `fail-on-findings` on GitHub Actions ASH workflow and pre-commit ASH hook so builds and commits fail when actionable vulnerabilities are detected
- **Pre-commit hooks**: Upgraded all hook revisions to latest versions via `pre-commit autoupdate`

## [3.0.0] - 2026-03-07

### Added
- **Pet Food microservice** (`petfood-rs`): Rust/Axum service on ECS Fargate with OpenTelemetry Rust SDK, DynamoDB persistence, EventBridge event emission, and custom Prometheus metrics
- **Pet Food Agent** (`petfoodagent-strands-py`): Python AI agent deployed on Amazon Bedrock AgentCore (ARM64), using Strands Agents SDK for natural-language food recommendations
- **Pet Food serverless functions**: Stock processor, image generator (Bedrock Titan), and cleanup processor — all triggered via EventBridge
- **Application Signals integration**: `ApplicationSignalsIntegration` L2 construct on petsearch-java with SLO definitions
- **OpenSearch Serverless**: Collection and ingestion pipeline for centralized log analytics
- **VPC Endpoints construct**: Interface and gateway endpoints for private AWS service connectivity (SSM, ECR, CloudWatch, X-Ray, STS, EventBridge, S3, DynamoDB)
- **CodeConnection support**: Pipeline source can use AWS CodeConnection (GitHub) in addition to S3 bucket
- **Parameter Store configuration**: Centralized config management via SSM Parameter Store with `retrieve-config.sh`
- **CDK cleanup automation**: Step Functions state machine with async polling for reliable cleanup of CDK stacks, S3 buckets, and bootstrap resources
- **Cleanup script** (`cleanup-resources.ts`): Tag-based discovery and deletion of orphaned workshop resources (log groups, EBS volumes, snapshots, RDS backups, ECS task definitions, S3 buckets)
- **DynamoDB seeding script**: Interactive and non-interactive modes for seeding pet adoption and pet food tables
- **Image generation script**: Bedrock Titan Image Generator v2 for pet and food images with retry logic and validation
- **Application redeployment script**: Cross-platform container builds with auto-detection of Docker/Finch/Podman
- **ECS port forwarding script**: Session Manager-based port forwarding to ECS tasks
- **Workshop NAG pack**: Custom CDK Nag rule pack with workshop-specific suppressions
- **Canaries**: CloudWatch Synthetics canaries for traffic generation and housekeeping
- **GitHub Actions**: Documentation workflow (TypeDoc → GitHub Pages), security scanning (ASH), acceptance tests, pre-commit checks
- **Documentation**: Comprehensive TypeDoc API documentation with `@packageDocumentation` on all 44 source files and JSDoc on all high-impact classes/interfaces
- **README documentation table**: Guides section in README linking to all docs for non-technical audiences

### Changed
- **Pipeline architecture**: 5 deployment stages across 2 waves plus standalone Microservices stage (Core Wave → Backend Wave → Microservices)
- **Pet List Adoptions**: Migrated from Go to Python/FastAPI (`petlistadoption-py`) with ADOT auto-instrumentation and Prometheus metrics
- **Pet Site**: Renamed to `petsite-net`, deployed on EKS with CloudFront distribution, regional/global WAF, and Application Signals
- **Observability stack**: Per-service instrumentation strategy — OTel Go SDK (payforadoption), ADOT auto-instrumentation (petlistadoption), Application Signals (petsearch), CloudWatch agent (petsite), OTel Rust SDK (petfood)
- **FireLens log routing**: Fluent Bit sidecar on all ECS tasks for structured log delivery to CloudWatch Logs
- **Container Insights**: Enabled on both ECS and EKS clusters
- **Architecture documentation**: Rewritten with accurate microservice count (6), correct languages, correct stage structure, and regenerated diagrams
- **GitHub Pages documentation**: HTML site with TypeDoc default theme, PR preview deployments to live URLs, and all guides included as project documents

### Fixed
- Documentation accuracy: Fixed microservice count (6 not 5), languages (Python not Go for petlistadoptions), pipeline stage structure, and diagram references
- Removed broken image references from `codebuild-cdk-deployment-template.md`
- Cleaned up 8 stale diagram files from `generated-diagrams/`

## [2.0.0] - 2025-01-01

> Releases before 3.0.0 were not formally tracked. The entries below are
> reconstructed from commit history and may be incomplete.

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
