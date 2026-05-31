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

The deployment template exceeds the 51 KB inline limit for `--template-body`, so you must upload it to S3 first and reference it via `--template-url`.

**Step 1 — Upload the template to S3:**

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
TEMPLATE_BUCKET="oneobs-cfn-templates-${ACCOUNT_ID}"

aws s3 mb s3://${TEMPLATE_BUCKET}
aws s3 cp src/templates/codebuild-deployment-template.yaml s3://${TEMPLATE_BUCKET}/codebuild-deployment-template.yaml
```

**Step 2 — Deploy the stack:**

```bash
# Set your target region (default: us-east-1)
DEPLOY_REGION="us-west-2"

aws cloudformation create-stack \
  --stack-name OneObservability-Workshop-CDK \
  --template-url https://${TEMPLATE_BUCKET}.s3.amazonaws.com/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ${DEPLOY_REGION} \
  --parameters \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk \
    ParameterKey=pUserDefinedTagKey3,ParameterValue=' ' \
    ParameterKey=pUserDefinedTagKey4,ParameterValue=' ' \
    ParameterKey=pUserDefinedTagKey5,ParameterValue=' ' \
    ParameterKey=pUserDefinedTagValue3,ParameterValue=' ' \
    ParameterKey=pUserDefinedTagValue4,ParameterValue=' ' \
    ParameterKey=pUserDefinedTagValue5,ParameterValue=' '
```

**Deploying to a different region:** Set `DEPLOY_REGION` to your target region (e.g., `us-west-2`). The S3 template bucket must be in the same region as the stack, so create the bucket in that region too:

```bash
DEPLOY_REGION="us-west-2"
TEMPLATE_BUCKET="oneobs-cfn-templates-${ACCOUNT_ID}-${DEPLOY_REGION}"

aws s3 mb s3://${TEMPLATE_BUCKET} --region ${DEPLOY_REGION}
aws s3 cp src/templates/codebuild-deployment-template.yaml s3://${TEMPLATE_BUCKET}/codebuild-deployment-template.yaml --region ${DEPLOY_REGION}
```

Then run the `create-stack` command above with `--region ${DEPLOY_REGION}`. Ensure the target region has:
- At least 1 available VPC (default limit is 5 per region)
- Bedrock model access enabled for Claude Sonnet 4.6 and Claude Haiku 4.5 (request via the Bedrock console → Model access)

The full deployment takes approximately 30–45 minutes. Monitor progress with:

```bash
aws cloudformation describe-stacks --stack-name OneObservability-Workshop-CDK --query "Stacks[0].StackStatus"
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ValidationError: template body exceeds 51200 bytes` | Template too large for `--template-body` | Upload to S3 and use `--template-url` (see above) |
| `Parameters: [pUserDefinedTagKey3, ...] must have values` | Tag parameters have no default | Pass empty/space values for unused tag keys (see above) |
| `The maximum number of VPCs has been reached` | Account hit the 5-VPC per-region limit | Delete unused VPCs or deploy in another region |
| `Function creation failed because the function already exists` | Orphaned resources from a previous failed deployment | Delete orphaned Lambda functions and IAM roles with the `OneObservability-Workshop` prefix, then retry |

For detailed parameter descriptions and advanced usage, refer to the [full documentation](https://aws-samples.github.io/one-observability-demo/deployment/codebuild-template/).

### Post-Deployment: Enable Evaluations & A/B Testing

For full setup instructions (tracing, online evaluations, A/B testing, config bundles), see the [Pet Food Agent README](src/applications/microservices/petfoodagent-strands-py/README.md#post-deployment-steps).

## Cleanup

After completing the workshop, clean up your AWS resources to avoid ongoing charges.

For comprehensive cleanup instructions, troubleshooting, and safety guidelines, see:

**🧹 [Cleanup Script Documentation](https://aws-samples.github.io/one-observability-demo/operations/cleanup/)**

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
