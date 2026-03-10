## One Observability Demo

This repo contains a sample application which is used in the One Observability Demo workshop here - https://observability.workshop.aws/

## Documentation

Full documentation is published at the [GitHub Pages site](https://aws-samples.github.io/one-observability-demo/).

### Guides

| Guide | Description |
|-------|-------------|
| [Architecture Overview](https://aws-samples.github.io/one-observability-demo/architecture/overview/) | System architecture, microservices, pipeline stages, and observability design |
| [Deployment Template](https://aws-samples.github.io/one-observability-demo/deployment/codebuild-template/) | CodeBuild CDK deployment parameters and advanced usage |
| [Cleanup Script](https://aws-samples.github.io/one-observability-demo/operations/cleanup/) | Post-workshop resource cleanup instructions and troubleshooting |
| [CDK Cleanup](https://aws-samples.github.io/one-observability-demo/operations/cdk-cleanup/) | CDK-specific stack teardown procedures |
| [Seeding Guide](https://aws-samples.github.io/one-observability-demo/operations/seeding/) | Database and application seeding instructions |
| [Image Generation](https://aws-samples.github.io/one-observability-demo/operations/image-generation/) | Pet food image generation setup |
| [Application Redeployment](https://aws-samples.github.io/one-observability-demo/deployment/redeployment/) | How to redeploy individual microservices |
| [CodeConnection Setup](https://aws-samples.github.io/one-observability-demo/deployment/codeconnection/) | GitHub CodeConnection and Parameter Store integration |
| [ECS Port Forwarding](https://aws-samples.github.io/one-observability-demo/operations/ecs-port-forwarding/) | Local access to ECS services via port forwarding |

### API Reference

The CDK construct library API reference is available at the [API Reference](https://aws-samples.github.io/one-observability-demo/api/) page, or browse the source under [`src/cdk/lib/`](./src/cdk/lib/).

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

For detailed parameter descriptions and advanced usage, refer to the [full documentation](https://aws-samples.github.io/one-observability-demo/deployment/codebuild-template/).

## Cleanup

After completing the workshop, clean up your AWS resources to avoid ongoing charges.

For comprehensive cleanup instructions, troubleshooting, and safety guidelines, see:

**🧹 [Cleanup Script Documentation](https://aws-samples.github.io/one-observability-demo/operations/cleanup/)**

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
