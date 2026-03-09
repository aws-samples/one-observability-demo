<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Documentation

This folder contains operational documentation for the One Observability Demo project.

## Contents

### Deployment
- **[codebuild-cdk-deployment-template.md](./codebuild-cdk-deployment-template.md)** — Guide for the CodeBuild CDK deployment template, including architecture, retry handling, and troubleshooting
- **[codeconnection-parameter-store-integration.md](./codeconnection-parameter-store-integration.md)** — Setting up GitHub CodeConnection and SSM Parameter Store for pipeline configuration
- **[application-redeployment.md](./application-redeployment.md)** — Redeploying individual microservices without a full pipeline run

### Data & Seeding
- **[SEEDING_GUIDE.md](./SEEDING_GUIDE.md)** — Seeding DynamoDB and RDS with workshop data
- **[SEEDING_IMAGE_GENERATION.md](./SEEDING_IMAGE_GENERATION.md)** — Generating pet food images via Bedrock

### Operations
- **[CLEANUP_SCRIPT.md](./CLEANUP_SCRIPT.md)** — Cleanup script for removing all workshop resources
- **[CDK_CLEANUP.md](./CDK_CLEANUP.md)** — CDK-specific cleanup procedures and troubleshooting
- **[ecs-port-forwarding.md](./ecs-port-forwarding.md)** — ECS Exec port forwarding for debugging

### Architecture
- **[architecture.md](./architecture.md)** — Infrastructure architecture, pipeline stages, microservice details, and observability patterns

### API Documentation
- **[modules.md](./modules.md)** — Index of generated TypeDoc API documentation (published to GitHub Pages)

## Diagrams

Architecture diagrams are in the [`generated-diagrams/`](../generated-diagrams/) directory at the repository root. These are generated using the Python `diagrams` package with AWS icons.

## Template Location

The CloudFormation deployment template is at:
- **[../src/templates/codebuild-deployment-template.yaml](../src/templates/codebuild-deployment-template.yaml)**
