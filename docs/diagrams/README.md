<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Diagrams

This folder contains visual diagrams for the One Observability Demo project.

## Available Diagrams

### Architecture Diagrams

- **[architecture-diagram.png](./architecture-diagram.png)**
  - **Purpose**: Complete infrastructure architecture overview
  - **Shows**: All AWS components and their relationships
  - **Components**: CloudFormation stack, S3 bucket, Lambda functions, CodeBuild project, IAM roles, and CDK-created pipeline
  - **Used in**: [CodeBuild CDK Deployment Template Documentation](../codebuild-cdk-deployment-template.md#architecture)

### Process Flow Diagrams

- **[deployment-flow.png](./deployment-flow.png)**
  - **Purpose**: Step-by-step deployment process visualization
  - **Shows**: Sequential flow from stack creation to completion
  - **Components**: Initial setup, CodeBuild execution, pipeline monitoring, and completion phases
  - **Used in**: [CodeBuild CDK Deployment Template Documentation](../codebuild-cdk-deployment-template.md#deployment-flow)

## Diagram Details

### Architecture Diagram
```
External Resources → CloudFormation Stack → CDK Created Resources
     ↓                       ↓                        ↓
- GitHub Repo          - S3 Bucket              - CDK Pipeline
- Config File          - Lambda Functions       - Pipeline Stages
- Workshop User        - CodeBuild Project      - Deployed Infrastructure
                       - IAM Roles
                       - Wait Condition
```

### Deployment Flow Diagram
```
Start → Setup → CodeBuild → CDK Deploy → Pipeline Monitor → Complete
  ↓       ↓         ↓           ↓             ↓              ↓
Stack   S3 &     Clone &    Bootstrap &   Extract ARN &   Signal CF
Create  IAM      Config     Deploy CDK    Monitor Status   Success/Fail
```

## Generation Information

These diagrams were generated using:
- **Tool**: Python `diagrams` package with AWS icons
- **Method**: MCP diagram generation tools
- **Format**: PNG images
- **Style**: Top-to-bottom flow with clustered components

## Updating Diagrams

To regenerate or modify these diagrams:

1. Use the MCP `generate_diagram` tool
2. Save new diagrams to this folder
3. Update references in documentation
4. Commit changes to version control

## File Naming Convention

- Use kebab-case for filenames
- Include diagram type in name (e.g., `architecture-`, `flow-`, `process-`)
- Use descriptive names that indicate content
- Always use `.png` extension for consistency
