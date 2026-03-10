# payforadoption-go

Payment processing service written in Go, deployed on ECS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | Go |
| Platform | ECS Fargate |
| Architecture | AMD64 |
| Observability | OpenTelemetry Go SDK |
| Data Store | DynamoDB |

## Observability

Uses the **OpenTelemetry Go SDK** with an ADOT collector sidecar container:

- Traces exported via OTLP to the ADOT collector sidecar
- Collector forwards traces to AWS X-Ray
- Demonstrates manual SDK instrumentation in Go
- FireLens (Fluent Bit) sidecar routes logs to CloudWatch Logs

## Source

```
src/applications/microservices/payforadoption-go/
```
