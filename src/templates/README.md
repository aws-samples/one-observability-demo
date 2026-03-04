<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# CloudFormation Templates

This folder contains CloudFormation templates for the One Observability Demo project.

## Templates

- **[codebuild-deployment-template.yaml](./codebuild-deployment-template.yaml)** - CodeBuild CDK deployment template with intelligent retry handling

## Documentation

For comprehensive documentation, usage instructions, architecture diagrams, and implementation details, see:

**📖 [CodeBuild CDK Deployment Template Documentation](../../docs/codebuild-cdk-deployment-template.md)**

This documentation includes:
- Architecture diagrams
- Deployment flow charts
- Implementation details
- Retry handling mechanisms
- Usage examples
- Troubleshooting guides
- Security considerations

## Quick Start

```bash
aws cloudformation create-stack \
  --stack-name MyWorkshop-CDK-Deployment \
  --template-body file://codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=feat/cdkpipeline \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

For detailed parameter descriptions and advanced usage, refer to the [full documentation](../../docs/codebuild-cdk-deployment-template.md).
