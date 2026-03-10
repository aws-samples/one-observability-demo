# petfood-rs

Food catalog and cart API written in Rust/Axum, deployed on ECS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | Rust / Axum |
| Platform | ECS Fargate |
| Architecture | AMD64 |
| Observability | OpenTelemetry Rust SDK |
| Data Store | DynamoDB |
| Events | EventBridge |

## Observability

Uses the **OpenTelemetry Rust SDK** with custom Prometheus metrics:

- Manual instrumentation with both trace and metric signal types
- Custom Prometheus metrics for business-level monitoring
- Emits events to EventBridge for downstream processing (stock, images, cleanup)
- FireLens (Fluent Bit) sidecar routes logs to CloudWatch Logs

## Serverless Functions

This service triggers several Lambda functions via EventBridge:

| Function | Purpose |
|----------|---------|
| PetfoodStockProcessor | Processes food stock events |
| PetfoodImageGenerator | Generates food images via Bedrock |
| PetfoodCleanupProcessor | Cleans up expired food listings |

## Source

```
src/applications/microservices/petfood-rs/
```
