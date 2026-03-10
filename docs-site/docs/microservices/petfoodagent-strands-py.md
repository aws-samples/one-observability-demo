# petfoodagent-strands-py

AI-powered food recommendation agent written in Python, deployed on Amazon Bedrock AgentCore.

## Overview

| Property | Value |
|----------|-------|
| Language | Python / Strands Agents SDK |
| Platform | Bedrock AgentCore |
| Architecture | ARM64 |
| Observability | AI agent instrumentation |

## Description

Uses the **Strands Agents SDK** for natural-language food recommendations. The container is built during the Containers Stage but deployed to Bedrock AgentCore rather than ECS/EKS.

!!! note
    This service requires `ENABLE_PET_FOOD_AGENT=true` in the environment configuration and availability zone mapping via the `validate-account.sh` script.

## Source

```
src/applications/microservices/petfoodagent-strands-py/
```
