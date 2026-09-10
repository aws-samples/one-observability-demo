# payforadoption-go

Payment processing service written in Go, deployed on ECS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | Go |
| Platform | ECS Fargate |
| Architecture | AMD64 |
| Observability | OpenTelemetry Go SDK |
| Data Store | Aurora PostgreSQL + DynamoDB |

## Observability

Uses the **OpenTelemetry Go SDK** with a CloudWatch agent sidecar in OTLP mode:

- Traces exported via OTLP to the CloudWatch agent sidecar
- Agent forwards traces to AWS X-Ray
- Demonstrates manual SDK instrumentation in Go
- Custom SQL span processor for Aurora database correlation

## Source

```
src/applications/microservices/payforadoption-go/
```
