# Quick Start

:material-rocket-launch: **Pick the path that matches you and follow only that section.**

<div class="grid cards" markdown>

- :material-school: **AWS Workshop**

    ---

    Deployed for you automatically. Nothing to set up.

    [:octicons-arrow-right-24: Jump to section](#aws-workshops)

- :material-cloud-upload: **Your own AWS account**

    ---

    Deploy via CloudFormation using S3 or CodeConnection.

    [:octicons-arrow-right-24: Jump to section](#deploy-to-your-own-account-via-cloudformation)

</div>

---

## :material-school: AWS Workshops

!!! success "Nothing to do"
    If you are following this through an AWS-run workshop, the environment is **deployed for you automatically**. No setup, no CloudFormation, no instructions needed. Start from the workshop guide.

---

## :material-cloud-upload: Deploy to your own account via CloudFormation

Use this to stand the demo up in a **personal or team AWS account**. The CloudFormation template provisions a CodeBuild project that runs the CDK pipeline. The pipeline needs a **source** for the code, and there are two methods to provide it.

### Which method should I use?

| | :material-bucket: **S3** (Method 1) | :material-source-branch: **CodeConnection** (Method 2) :material-star: |
|---|---|---|
| | | **Recommended** |
| **Best for** | Deploying the demo as-is | Changing the code and iterating |
| **GitHub** | Not required | Fork required |
| **Lifecycle** | One-off / throwaway | Push-to-deploy, ongoing |

!!! tip "CodeConnection is recommended"
    Use CodeConnection (Method 2) for anything beyond a one-off deploy: every push to your fork is picked up by CodePipeline and redeployed, with no S3 step. Use S3 (Method 1) only to deploy the demo as-is without a fork.

### Prerequisites

- AWS CLI v2 configured for the target account (`aws sts get-caller-identity` returns the right account).
- Permission to run CloudFormation, CodeBuild, and CDK bootstrap in that account.
- The template uploaded to S3.

!!! warning "Use `--template-url`, not `--template-body`"
    The template exceeds CloudFormation's 51,200-byte inline limit, so it must be uploaded to S3 and referenced with `--template-url`.

### :material-bucket: Method 1: S3 source

CodeBuild clones the public repo and uses a template-created S3 bucket as the pipeline source. No GitHub account or connection required.

```bash
aws cloudformation create-stack \
  --stack-name OneObservability-CDK \
  --template-url https://<your-bucket>.s3.amazonaws.com/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

### :material-source-branch: Method 2: CodeConnection source (Recommended)

!!! note "Recommended for ongoing code changes"
    Tracks your fork so your commits drive deployments. After a one-time GitHub connection, push to your fork and CodePipeline redeploys automatically.

**Step 1: Fork the repo.**
In GitHub, fork `aws-samples/one-observability-demo` into your own account.

**Step 2: Create a CodeConnection and authorize it.**

```bash
aws codeconnections create-connection \
  --provider-type GitHub \
  --connection-name one-observability-demo
```

The connection is created in `PENDING` state.

!!! info "One manual step"
    Open the AWS Console, go to **Developer Tools -> Connections**, click **Update pending connection**, and complete the GitHub authorization against your fork. Copy the resulting connection ARN. This console step is the one part that cannot be scripted.

**Step 3: Deploy with the connection ARN**, pointing the organization/repo at your fork:

```bash
aws cloudformation create-stack \
  --stack-name OneObservability-CDK \
  --template-url https://<your-bucket>.s3.amazonaws.com/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=pCodeConnectionArn,ParameterValue=arn:aws:codeconnections:<region>:<account>:connection/<id> \
    ParameterKey=pOrganizationName,ParameterValue=<your-github-username> \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=<your-branch> \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

When `pCodeConnectionArn` is set, it is used as the source instead of S3.

---

## :material-layers: What gets deployed

The deployment creates a CDK Pipeline that provisions resources in 5 stages:

| # | Stage | Resources |
|---|---|---|
| 1 | **Core** | VPC, security groups, VPC endpoints, CloudTrail, EventBridge, OpenSearch |
| 2 | **Containers** | Container image builds for all 6 microservices |
| 3 | **Storage** | DynamoDB, Aurora PostgreSQL, S3, SQS, data seeding |
| 4 | **Compute** | ECS cluster, EKS cluster, load balancers |
| 5 | **Microservices** | Service deployments, Lambda functions, canaries, WAF |

For full architecture details, see the [Architecture Overview](../architecture/overview.md).

---

## :material-broom: Cleanup

Teardown is deliberate: the deploy templates never tear down the CDK stacks automatically (see [ADR-0001](../architecture/decisions/0001-deployment-template-split-and-safer-teardown.md)). Choose one path:

```bash
cd src/cdk

# Discovery-based cleanup script
npm run cleanup -- --discover
npm run cleanup -- --stack-name MyStack --dry-run
npm run cleanup -- --stack-name MyStack
```

Or deploy the standalone teardown state machine and invoke it explicitly:

```bash
# Preview first (deletes nothing)
aws stepfunctions start-execution \
  --state-machine-arn <teardown stack's StateMachineArn output> \
  --input '{"confirm":"DELETE","dryRun":true}'

# Then perform the teardown
aws stepfunctions start-execution \
  --state-machine-arn <...> --input '{"confirm":"DELETE"}'
```

See [Cleanup Script](../operations/cleanup.md) and [CDK Cleanup](../operations/cdk-cleanup.md) for detailed instructions.
