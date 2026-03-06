<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The version of our code being used
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the _master_ branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Ensure local tests pass.
4. Commit to your fork using clear commit messages.
5. Send us a pull request, answering any default questions in the pull request interface.
6. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security Scanning and Pre-commit Hooks

This project uses pre-commit hooks to ensure code quality and security. The following hooks are configured:

### Security Hooks

- **python-safety-dependencies-check**: Scans Python dependencies for known security vulnerabilities
- **detect-secrets**: Prevents secrets from being committed to the repository
- **detect-private-key**: Detects private keys in code
- **detect-aws-credentials**: Prevents AWS credentials from being committed

### Code Quality Hooks

- **commitizen**: Enforces conventional commit message format
- **check-json**: Validates JSON file syntax
- **check-yaml**: Validates YAML file syntax
- **trailing-whitespace**: Removes trailing whitespace
- **mixed-line-ending**: Ensures consistent line endings
- **check-merge-conflict**: Detects merge conflict markers
- **codespell**: Checks for common spelling mistakes
- **eslint**: Lints JavaScript/TypeScript files
- **dockerfile_lint**: Lints Dockerfile syntax
- **black**: Formats Python code
- **flake8**: Python code linting
- **mypy**: Python type checking
- **cfn-python-lint**: CloudFormation template linting
- **jest**: Runs unit tests
- **ash-simple-scan**: AWS security scanning

### Prerequisites

1. **Install git-remote-s3** (required for pushing initial repo to S3 for container pipelines):

    ```bash
    pip install git-remote-s3
    ```

2. **Install dependencies** from the root of the repository:
    ```bash
    npm install
    ```

### Installing Pre-commit Hooks

**Mac:**

```bash
# Use pip instead of brew to avoid old version issues
pip install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

**Windows:**

```bash
pip install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

## Local Development

For faster development without waiting for the pipeline, you can use the local CDK application located in `bin/local.ts`. This deploys resources directly using CDK commands.

**Prerequisites:**

- Authenticate with your target AWS account
- **IMPORTANT:** Run the deploy check script first (see Deployment Scripts section below)

**Usage:**

```bash
# List available stacks
cdk -a "npx ts-node bin/local.ts" list

# Deploy all stacks
cdk -a "npx ts-node bin/local.ts" deploy --all

# Other CDK commands using local app
cdk -a "npx ts-node bin/local.ts" <cdk-command>
```

Example commands:

```bash
# Show differences
cdk -a "npx ts-node bin/local.ts" diff

# Destroy the stack
cdk -a "npx ts-node bin/local.ts" destroy
```

## Deployment Scripts

### Environment Validation Script

**IMPORTANT:** The `scripts/deploy-check.sh` script must be executed first before deploying the local stack.

The script validates your environment and prepares the repository for deployment.

**Setup:**

1. Copy `src/cdk/.env.sample` to `src/cdk/.env`
2. Update the `.env` file with your AWS account details:
    - `CONFIG_BUCKET`: Your S3 bucket name
    - `BRANCH_NAME`: Your git branch name
    - `AWS_ACCOUNT_ID`: Your AWS account ID
    - `AWS_REGION`: Your target AWS region
    - `EKS_CLUSTER_ACCESS_ROLE_NAME`: Name of the role that will receive ClusterAdmin access on the EKS Cluster (optional)
    - `ENABLE_PET_FOOD_AGENT`: Set to `true` to enable AgentCore deployment (optional)

### CodeConnection and Parameter Store Integration

The project supports optional CodeConnection integration for GitHub source and Parameter Store for configuration management. These features provide enhanced security and flexibility for deployments.

**Additional Configuration Parameters:**

When using the CloudFormation deployment template (`src/templates/codebuild-deployment-template.yaml`), you can optionally configure:

- `pCodeConnectionArn`: ARN of an existing AWS CodeStar Connection to GitHub
    - When provided, the pipeline will use CodeConnection as the source instead of S3 bucket
    - Format: `arn:aws:codeconnections:region:account:connection/connection-id`
    - If not provided, the pipeline falls back to S3 bucket source (default behavior)

- `pParameterStoreBasePath`: Base path prefix for storing configuration in Parameter Store
    - Used to store workshop configuration parameters (replaces .env file approach)
    - Format: `/your-prefix/` (must start and end with `/`)
    - Example: `/one-observability-workshop/`
    - Parameters are stored as: `${basePath}parameter-name`

**Local Development with CodeConnection:**

For local development when using CodeConnection:

1. **Create CodeConnection** (if not exists):

    ```bash
    # Create connection via AWS Console or CLI
    aws codeconnections create-connection \
      --provider-type GitHub \
      --connection-name one-observability-demo
    ```

2. **Configure .env file** with CodeConnection details:

    ```bash
    # Add to src/cdk/.env
    CODE_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/abc123
    PARAMETER_STORE_BASE_PATH=/one-observability-workshop/
    ```

3. **Deploy with CodeConnection**:
    ```bash
    # The local CDK app will automatically use CodeConnection if ARN is provided
    cdk -a "npx ts-node bin/local.ts" deploy --all
    ```

**Parameter Store Configuration:**

When using Parameter Store, configuration values are automatically retrieved during pipeline execution:

```bash
# Parameters are stored with the base path prefix
/one-observability-workshop/database-endpoint
/one-observability-workshop/cluster-name
/one-observability-workshop/vpc-id
```

**Fallback Behavior:**

- **Source**: If CodeConnection ARN is not provided, S3 bucket source is used automatically
- **Configuration**: If Parameter Store parameters are not found, local .env files are used as fallback
- **Local Development**: Always uses local .env files for immediate development iteration

**Benefits:**

- **Security**: CodeConnection provides secure GitHub integration without storing tokens
- **Centralized Config**: Parameter Store enables centralized configuration management
- **Flexibility**: Seamless fallback to S3/local files ensures compatibility
- **Scalability**: Parameter Store supports multiple environments and teams

**Usage:**

```bash
./scripts/deploy-check.sh
```

The script will:

- Validate AWS credentials and display current role/account
- Check if the S3 bucket exists (create if needed)
- Verify the repository archive exists in S3 (upload if needed)

**After running the deploy check script, you can then deploy the local stack using CDK commands.**

### Account Validation Script

The `src/cdk/scripts/validate-account.sh` script validates account-specific configurations and sets environment variables.

**Usage:**

```bash
./src/cdk/scripts/validate-account.sh src/cdk/.env
```

The script will:

- Check if X-Ray transaction search is configured for CloudWatch Logs
- When `ENABLE_PET_FOOD_AGENT=true`, retrieve and map availability zones for AgentCore deployment
- Update the `.env` file with:
    - `AUTO_TRANSACTION_SEARCH_CONFIGURED`: Whether X-Ray is configured
    - `AVAILABILITY_ZONES`: Comma-separated list of AZ names (when AgentCore is enabled)

**Note:** This script is automatically called by `deploy-check.sh` but can be run independently.

### Application Redeployment Script

The `src/cdk/scripts/redeploy-app.sh` script helps developers quickly redeploy individual microservices for testing new versions.

**Prerequisites:**

- AWS CLI configured with appropriate credentials
- One of: Docker, Finch, or Podman installed
- Deployed One Observability Demo infrastructure
- `src/cdk/.env` file with `AWS_REGION` and `AWS_ACCOUNT_ID` configured

**Usage:**

```bash
./src/cdk/scripts/redeploy-app.sh
```

The script will prompt you to:
1. Select the application to redeploy
2. Choose the target platform (amd64 or arm64)
3. Select ECS cluster and service (for ECS applications)

See [Application Redeployment Guide](docs/application-redeployment.md) for detailed instructions.

### DynamoDB Seeding Script

The `src/cdk/scripts/seed-dynamodb.sh` script helps populate DynamoDB tables with initial pet adoption data.

**Prerequisites:**

- AWS CLI configured with appropriate credentials
- `jq` command-line JSON processor installed
- CDK resources must be deployed first
- The script uses data from `src/cdk/scripts/seed.json`

**Usage:**

```bash
# Interactive mode
./src/cdk/scripts/seed-dynamodb.sh

# Non-interactive mode with table name
./src/cdk/scripts/seed-dynamodb.sh TABLE_NAME
```

The script will:

- Accept table name as parameter for non-interactive usage
- List all DynamoDB tables in your account (interactive mode)
- Automatically suggest tables containing "Petadoption" in the name (interactive mode)
- Allow you to select which table to seed (interactive mode)
- Populate the selected table with pet data from the seed file

**Note:** This script must be executed after the CDK resources are deployed.

### Parameter Store Retrieval Script

The `src/cdk/scripts/get-parameter.sh` script retrieves values from AWS Systems Manager Parameter Store using the configured prefix.

**Prerequisites:**

- AWS CLI configured with appropriate credentials
- CDK resources must be deployed first

**Usage:**

```bash
./src/cdk/scripts/get-parameter.sh <parameter-key>
```

**Example:**

```bash
./src/cdk/scripts/get-parameter.sh database-endpoint
```

This retrieves the parameter `/petstore/database-endpoint` from Parameter Store.

**Return Values:**

- Parameter value if found
- `-1` if parameter not found or invalid key
- `-2` if access denied

### Accessing the EKS Pods

Use the following commands on AWS Cloudshell to access the pods. Note that you must create an authorization for your user

```
mkdir -p ~/bin
curl --silent --location "https://github.com/derailed/k9s/releases/latest/download/k9s_Linux_amd64.tar.gz" | tar xz -C ~/bin
aws eks update-kubeconfig --name PetsiteEKS-cluster
k9s
```

## Troubleshooting

### CDK Bootstrap Stack Deletion Issue

When the delete step function fails, the CDK bootstrap stack may be removed before some stacks are cleaned up. Under that situation, stacks cannot be deleted because the CloudFormation execution role was removed with the CDK bootstrap stack.

To regain access to delete the resources, bootstrap again from CloudShell by running the following commands:

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
```

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.

We may ask you to sign a [Contributor License Agreement (CLA)](http://en.wikipedia.org/wiki/Contributor_License_Agreement) for larger changes.
