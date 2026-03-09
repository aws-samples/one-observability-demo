## One Observability Demo

This repo contains a sample application which is used in the One Observability Demo workshop here - https://observability.workshop.aws/

## Documentation

### Guides

| Guide | Description |
|-------|-------------|
| [Architecture Overview](./docs/architecture.md) | System architecture, microservices, pipeline stages, and observability design |
| [Deployment Template](./docs/codebuild-cdk-deployment-template.md) | CodeBuild CDK deployment parameters and advanced usage |
| [Cleanup Script](./docs/CLEANUP_SCRIPT.md) | Post-workshop resource cleanup instructions and troubleshooting |
| [CDK Cleanup](./docs/CDK_CLEANUP.md) | CDK-specific stack teardown procedures |
| [Seeding Guide](./docs/SEEDING_GUIDE.md) | Database and application seeding instructions |
| [Image Generation Seeding](./docs/SEEDING_IMAGE_GENERATION.md) | Pet food image generation setup |
| [Application Redeployment](./docs/application-redeployment.md) | How to redeploy individual microservices |
| [CodeConnection Setup](./docs/codeconnection-parameter-store-integration.md) | GitHub CodeConnection and Parameter Store integration |
| [ECS Port Forwarding](./docs/ecs-port-forwarding.md) | Local access to ECS services via port forwarding |

### API Reference

The CDK construct library is documented with TypeDoc. View the generated API reference at the [GitHub Pages site](https://aws-samples.github.io/one-observability-demo/) or browse the source under [`src/cdk/lib/`](./src/cdk/lib/).

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

