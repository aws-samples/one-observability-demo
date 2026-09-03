# petsite-net

Web frontend written in .NET, deployed on EKS with managed node groups.

## Overview

| Property | Value |
|----------|-------|
| Language | .NET |
| Platform | EKS (managed node group) |
| Architecture | AMD64 |
| Observability | CloudWatch agent |
| CDN | CloudFront |
| Security | Regional + Global WAF (optional, feature-flagged) |

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
