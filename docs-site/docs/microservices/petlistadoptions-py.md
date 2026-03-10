# petlistadoptions-py

Pet listing and adoption service written in Python/FastAPI, deployed on ECS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | Python / FastAPI |
| Platform | ECS Fargate |
| Architecture | AMD64 |
| Observability | ADOT auto-instrumentation |
| Data Store | Aurora PostgreSQL |

## Observability

Uses **ADOT auto-instrumentation** via a CloudWatch agent sidecar:

- Zero-code instrumentation for the Python application
- Manual configuration required for FastAPI framework support
- Prometheus metrics exposed for custom metric collection
- FireLens (Fluent Bit) sidecar routes logs to CloudWatch Logs

## Source

```
src/applications/microservices/petlistadoptions-py/
```
