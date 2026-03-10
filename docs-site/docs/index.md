# One Observability Workshop

Welcome to the **One Observability Demo** documentation — a comprehensive AWS observability workshop that deploys a multi-service pet adoption platform instrumented with distributed tracing, metrics, and structured logging.

<div class="grid cards" markdown>

-   :material-architecture-outline:{ .lg .middle } **Architecture**

    ---

    Multi-stage CDK pipeline deploying 6 microservices across ECS, EKS, and Bedrock AgentCore.

    [:octicons-arrow-right-24: Architecture overview](architecture/overview.md)

-   :material-docker:{ .lg .middle } **Microservices**

    ---

    Go, Java, Python, .NET, and Rust services — each demonstrating different observability patterns.

    [:octicons-arrow-right-24: Explore services](microservices/index.md)

-   :material-rocket-launch:{ .lg .middle } **Deployment**

    ---

    One-click CloudFormation deployment with CodeBuild, CDK Pipelines, and intelligent retry handling.

    [:octicons-arrow-right-24: Get started](deployment/quick-start.md)

-   :material-chart-line:{ .lg .middle } **Observability**

    ---

    OpenTelemetry, Application Signals, CloudWatch, X-Ray, and Prometheus — all in one workshop.

    [:octicons-arrow-right-24: Observability patterns](architecture/observability.md)

</div>

## Workshop Overview

The One Observability Demo deploys a pet adoption store with these components:

| Service | Language | Platform | Observability |
|---------|----------|----------|---------------|
| `payforadoption-go` | Go | ECS Fargate | OpenTelemetry Go SDK |
| `petlistadoptions-py` | Python/FastAPI | ECS Fargate | ADOT auto-instrumentation |
| `petsearch-java` | Java/Spring Boot | ECS Fargate | Application Signals |
| `petsite-net` | .NET | EKS Fargate | CloudWatch agent |
| `petfood-rs` | Rust/Axum | ECS Fargate | OpenTelemetry Rust SDK |
| `petfoodagent-strands-py` | Python/Strands | Bedrock AgentCore | AI agent instrumentation |

## Quick Start

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

For detailed instructions, see the [Deployment Guide](deployment/quick-start.md).

## Links

- :material-web: [Workshop site](https://observability.workshop.aws/)
- :fontawesome-brands-github: [GitHub repository](https://github.com/aws-samples/one-observability-demo)
- :material-file-document: [API Reference](api/index.md)
