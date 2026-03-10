# Contributing

Thank you for your interest in contributing to the One Observability Demo.

## Reporting Bugs / Feature Requests

Use the [GitHub issue tracker](https://github.com/aws-samples/one-observability-demo/issues) to report bugs or suggest features. When filing an issue, include:

- A reproducible test case or series of steps
- The version of the code being used
- Any relevant modifications
- Anything unusual about your environment

## Pull Requests

1. Fork the repository
2. Work against the latest source on the `main` branch
3. Check existing open and recently merged PRs
4. Open an issue to discuss significant work
5. Focus on the specific change (avoid reformatting unrelated code)
6. Ensure local tests pass
7. Use clear commit messages

## Pre-commit Hooks

The project uses pre-commit hooks for code quality and security:

### Setup

```bash
pip install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

### Security Hooks

- `python-safety-dependencies-check` — Scans Python dependencies for vulnerabilities
- `detect-secrets` — Prevents secrets from being committed
- `detect-private-key` — Detects private keys
- `detect-aws-credentials` — Prevents AWS credentials from being committed

### Code Quality Hooks

- `commitizen` — Enforces conventional commit format
- `check-json`, `check-yaml` — Validates file syntax
- `eslint` — Lints JavaScript/TypeScript
- `black`, `flake8`, `mypy` — Python formatting, linting, type checking
- `cfn-python-lint` — CloudFormation template linting
- `jest` — Unit tests

## Local Development

```bash
cd src/cdk

# Copy and configure environment
cp .env.sample .env

# Run deploy check
./scripts/deploy-check.sh

# Deploy locally
cdk -a "npx ts-node bin/local.ts" deploy --all
```

## Security Issue Notifications

If you discover a potential security issue, notify AWS/Amazon Security via the [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Do not create a public GitHub issue.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](https://github.com/aws-samples/one-observability-demo/blob/main/LICENSE) file.
