# petsearch-java

Pet search service written in Java/Spring Boot, deployed on ECS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | Java / Spring Boot |
| Platform | ECS Fargate |
| Architecture | AMD64 |
| Observability | Application Signals |
| Data Store | Aurora PostgreSQL |

## Observability

Uses the **ApplicationSignalsIntegration** L2 CDK construct:

- Auto-instrumentation combined with manual span creation
- SLO definitions for monitoring service-level objectives
- Application Signals provides service maps, latency metrics, and error tracking
- FireLens (Fluent Bit) sidecar routes logs to CloudWatch Logs

## Source

```
src/applications/microservices/petsearch-java/
```
