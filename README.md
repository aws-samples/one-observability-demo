## One Observability Demo

This repo contains a sample application which is used in the One Observability Demo workshop here - https://observability.workshop.aws/

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## Deployment Instructions

### Prerequisites

- IAM role with elevated privileges
- AWS CLI installed and configured
- Appropriate AWS permissions for CloudFormation, CodeBuild, and related services

### CloudFormation Templates

This repository provides CloudFormation templates for automated deployment:

- **[codebuild-deployment-template.yaml](./src/templates/codebuild-deployment-template.yaml)** - CodeBuild CDK deployment template with intelligent retry handling

### Quick Start

Deploy the workshop using the CodeBuild CDK deployment template:

```bash
aws cloudformation create-stack \
  --stack-name OneObservability-Workshop-CDK \
  --template-body file://src/templates/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

For detailed parameter descriptions and advanced usage, refer to the [full documentation](./docs/codebuild-cdk-deployment-template.md).

## Cleanup

After completing the workshop, clean up your AWS resources to avoid ongoing charges.

For comprehensive cleanup instructions, troubleshooting, and safety guidelines, see:

**🧹 [Cleanup Script Documentation](./docs/CLEANUP_SCRIPT.md)**

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

