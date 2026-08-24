# waggle-ai-agents

**Waggle**, the PetStore assistant — a multi-agent, multi-framework system written in Python and
deployed on Amazon Bedrock AgentCore.

## Overview

| Property | Value |
|----------|-------|
| Language | Python |
| Platform | Bedrock AgentCore (Runtime, Gateway, Memory) |
| Architecture | ARM64 |
| Observability | ADOT auto-instrumentation per framework |

## Description

A **Strands** orchestrator routes each request to one of four framework-diverse sub-agents, so a
single trace spans several agent frameworks and model providers. All five share one build context
and one container image per agent.

| Agent | Framework | Role |
|-------|-----------|------|
| `waggle-ai-orchestrator` | Strands | Routes to sub-agents |
| `waggle-ai-nutrition` | LangGraph | Diet matching, grounded in a Bedrock Knowledge Base |
| `waggle-ai-ordering` | CrewAI | Catalog, cart, checkout |
| `waggle-ai-adoption` | LlamaIndex | Pet search and adoption |
| `waggle-ai-concierge` | OpenAI Agents SDK | General pet Q&A |

Sub-agent calls go through an **AgentCore Gateway** (AWS_IAM / SigV4), conversation state through a
shared **AgentCore Memory**, and every response through a **Bedrock Guardrail**. The containers are
built during the Containers Stage but deployed to AgentCore rather than ECS/EKS.

!!! note
    This service requires `ENABLE_WAGGLE_AI_AGENTS=true` in the environment configuration and
    availability zone mapping via the `validate-account.sh` script.

## Source

```
src/applications/microservices/waggle_ai_agents/
```

See that directory's `README.md` for the package layout, configuration and local development notes.
