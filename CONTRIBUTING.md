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

* A reproducible test case or series of steps
* The version of our code being used
* Any modifications you've made relevant to the bug
* Anything unusual about your environment or deployment


## Contributing via Pull Requests
Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the *master* branch.
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

### Installing Pre-commit Hooks

**Mac:**
```bash
brew install pre-commit
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

**Prerequisites:** Authenticate with your target AWS account

**Usage:**
```bash
cdk -a "npx ts-node --prefer-ts-exts bin/local.ts" <cdk-command>
```

Example commands:
```bash
# Deploy the stack
cdk -a "npx ts-node --prefer-ts-exts bin/local.ts" deploy

# Show differences
cdk -a "npx ts-node --prefer-ts-exts bin/local.ts" diff

# Destroy the stack
cdk -a "npx ts-node --prefer-ts-exts bin/local.ts" destroy
```

## Deployment Script

The `scripts/deploy-check.sh` script validates your environment and prepares the repository for deployment.

**Setup:**
1. Copy `src/cdk/.env.sample` to `src/cdk/.env`
2. Update the `.env` file with your AWS account details:
   - `CONFIG_BUCKET`: Your S3 bucket name
   - `BRANCH_NAME`: Your git branch name
   - `AWS_ACCOUNT_ID`: Your AWS account ID
   - `AWS_REGION`: Your target AWS region

**Usage:**
```bash
./scripts/deploy-check.sh
```

The script will:
- Validate AWS credentials and display current role/account
- Check if the S3 bucket exists (create if needed)
- Verify the repository archive exists in S3 (upload if needed)

## Security issue notifications
If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.


## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.

We may ask you to sign a [Contributor License Agreement (CLA)](http://en.wikipedia.org/wiki/Contributor_License_Agreement) for larger changes.
