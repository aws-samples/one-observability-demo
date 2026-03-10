# petsite-net

Web frontend written in .NET, deployed on EKS Fargate.

## Overview

| Property | Value |
|----------|-------|
| Language | .NET |
| Platform | EKS Fargate |
| Architecture | AMD64 |
| Observability | CloudWatch agent |
| CDN | CloudFront |
| Security | Regional + Global WAF |

## Observability

Uses the **CloudWatch agent** with Application Signals on EKS:

- Application Signals provides service maps and latency tracking
- CloudWatch agent deployed as a sidecar on the EKS pod
- Container Insights enabled on the EKS cluster
- Logs collected via Kubernetes logging integration

## Source

```
src/applications/microservices/petsite-net/
```
