<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Documentation

This folder contains documentation and diagrams for the One Observability Demo project.

## Contents

### Documentation Files

- **[codebuild-cdk-deployment-template.md](./codebuild-cdk-deployment-template.md)** - Comprehensive guide for the simplified CodeBuild CDK deployment template, including architecture, implementation details, retry handling, and troubleshooting

### Diagrams

- **[diagrams/architecture-diagram.png](./diagrams/architecture-diagram.png)** - Complete infrastructure architecture showing all components and their relationships
- **[diagrams/deployment-flow.png](./diagrams/deployment-flow.png)** - Step-by-step deployment process flow diagram

## Quick Start

For deploying CDK projects using the automated template, see the **[CodeBuild CDK Deployment Template Guide](./codebuild-cdk-deployment-template.md)**.

## Usage

These diagrams and documentation provide visual and detailed explanations of:

1. **System Architecture**: How different AWS services interact in the deployment process
2. **Process Flow**: The sequence of operations during CDK deployment and pipeline monitoring
3. **Component Relationships**: Dependencies between CloudFormation resources, Lambda functions, and CDK-created infrastructure
4. **Implementation Details**: Step-by-step breakdown of the deployment process
5. **Retry Handling**: Intelligent retry mechanisms for robust deployments
6. **Troubleshooting**: Common issues and debugging techniques

## Generating New Diagrams

If you need to regenerate or create new diagrams, you can use the MCP diagram generation tools available in the development environment. The diagrams are created using the Python `diagrams` package with AWS icons.

Example workflow:
1. Use the `generate_diagram` MCP tool with appropriate code
2. Save diagrams to the `docs/diagrams/` folder
3. Update documentation references as needed
4. Commit both diagrams and documentation updates

## File Organization

```
docs/
├── README.md                              # This file
├── codebuild-cdk-deployment-template.md   # Template documentation
└── diagrams/
    ├── architecture-diagram.png           # Infrastructure architecture
    └── deployment-flow.png               # Deployment process flow
```

## Template Location

The actual CloudFormation template file is located at:
- **[codebuild-deployment-template-simplified.yaml](../src/templates/codebuild-deployment-template-simplified.yaml)**

This separation keeps the executable template in the source directory while maintaining all documentation in this centralized docs folder.
