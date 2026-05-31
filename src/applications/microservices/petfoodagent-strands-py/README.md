<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Pet Food Agent (Strands SDK / Python)

An AI-powered pet food recommendation agent built with Strands Agents SDK, deployed on Amazon Bedrock AgentCore Runtime. This agent demonstrates the Observe-Evaluate-Improve quality loop for AI agents.

## Overview

This agent:
- Recommends pet food based on breed, age, size, and health conditions
- Calls internal pet store APIs to fetch pet details and available food catalog
- Runs on AgentCore Runtime with auto-instrumented OpenTelemetry tracing
- Supports config bundles for A/B testing prompts and models without redeployment

## Architecture

```
User (Waggle Chat) → AgentCore Gateway → AgentCore Runtime
                                              │
                                              ├── Strands Agent
                                              │     ├── BedrockModel (Claude Sonnet/Haiku)
                                              │     ├── http_request tool
                                              │     └── dynamic_config_hook (reads config bundles)
                                              │
                                              ├── OTel auto-instrumentation → CloudWatch GenAI Observability
                                              └── Online evaluators (10 built-in + 1 code-based Lambda)
```

## Technology Stack

- **Language**: Python 3.13
- **Agent Framework**: Strands Agents SDK
- **Model**: Amazon Bedrock (Claude Sonnet 4.6 default, configurable)
- **Runtime**: Amazon Bedrock AgentCore
- **Observability**: OpenTelemetry (auto-instrumented via `opentelemetry-instrument`)
- **Package Manager**: uv
- **Deployment**: AgentCore Runtime (container-based)

## How It Works

### Request Flow

```
1. Request arrives at AgentCore Runtime entrypoint
2. If via gateway with A/B test: config bundle attached to request context
3. BeforeModelCallEvent fires → dynamic_config_hook reads config bundle
4. Hook overrides system_prompt and/or model_id if present in bundle
5. Agent calls Bedrock model with system prompt + user input
6. Agent uses http_request tool to call pet store APIs
7. Agent returns recommendation to user
8. OTel traces exported to CloudWatch (zero code changes)
```

### Config Bundle Hook

The agent supports runtime configuration injection via AgentCore config bundles. The gateway attaches a bundle per-request based on A/B test allocation, and the hook reads it before each model call:

```python
def dynamic_config_hook(event: BeforeModelCallEvent):
    config = BedrockAgentCoreContext.get_config_bundle()
    if config:
        if "system_prompt" in config:
            event.agent.system_prompt = config["system_prompt"]
        if "model_id" in config:
            event.agent.model = BedrockModel(model_id=config["model_id"])
```

Config bundles are free-form JSON. Any key-value pair can be added and read in the hook (temperature, max_tokens, custom keys, etc.).

### Entrypoint

```python
@app.entrypoint
def pet_food_agent_bedrock(payload):
    response = agent(payload.get("prompt"))
    return {"response": response.message["content"][0]["text"]}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODEL_ID` | Bedrock model identifier | `us.anthropic.claude-sonnet-4-6` |
| `PARAMETER_STORE_PREFIX` | SSM prefix for API URLs | (required) |
| `SEARCH_API_URL_PARAMETER_NAME` | SSM key for pet search API URL | (required) |
| `PETFOOD_API_URL_PARAMETER_NAME` | SSM key for food catalog API URL | (required) |
| `AWS_REGION` | AWS region | `us-east-1` |
| `SYSTEM_PROMPT_OVERRIDE` | Override default system prompt | (optional) |
| `STRANDS_OTEL_ENABLE_TRACING` | Enable Strands OTel span emission | `true` |
| `OTEL_TRACES_SAMPLER` | OTel sampling strategy | `always_on` |

### SSM Parameters

The agent fetches API URLs from SSM Parameter Store at startup:
- `{prefix}/searchapiurl` — Pet search/adoption listings API
- `{prefix}/petfoodapiurl` — Food catalog API

## Observability

### Tracing (Zero Code Changes)

Tracing is enabled via two env vars and the `opentelemetry-instrument` wrapper in the Dockerfile CMD:

```dockerfile
CMD ["opentelemetry-instrument", "python", "-m", "agent"]
```

This auto-captures:
- Every Bedrock model invocation (input/output tokens, latency)
- Every tool call (URL, parameters, response time)
- Full session traces in CloudWatch GenAI Observability

### Evaluation

Sessions are scored by online evaluators after a configurable timeout:

| Evaluator | What it measures |
|-----------|-----------------|
| Coherence | Logical flow and consistency |
| Conciseness | Brevity without losing information |
| Correctness | Factual accuracy |
| Faithfulness | Grounded in tool responses (hallucination detection) |
| GoalSuccessRate | Did the agent achieve the user's goal |
| InstructionFollowing | Adherence to system prompt |
| Refusal | Inappropriate refusals |
| ResponseRelevance | On-topic responses |
| ToolParameterAccuracy | Correct tool parameters |
| ToolSelectionAccuracy | Right tool for the job |
| PetFoodToolUsage (Lambda) | Deterministic: called both required APIs |

### A/B Testing

Two patterns available:

| Pattern | What varies | Infrastructure |
|---------|-------------|----------------|
| Target-based | Model, code, tools (two runtimes) | 2x AgentCore runtimes |
| Config-bundle | Prompt, model ID (one runtime) | 1x runtime, config injected per-request |

## Development

### Prerequisites

- Python 3.13+
- AWS credentials configured
- SSM parameters created for API URLs

### Local Setup

```bash
cd src/applications/microservices/petfoodagent-strands-py
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### Running Locally

```bash
# Set required env vars
export PARAMETER_STORE_PREFIX=/petstore
export SEARCH_API_URL_PARAMETER_NAME=searchapiurl
export PETFOOD_API_URL_PARAMETER_NAME=petfoodapiurl
export AWS_REGION=us-east-1

python -m agent
```

### Docker Build

```bash
docker buildx build --platform linux/amd64 -t petfoodagent:latest .
```

## Deployment

Deployed via AWS CDK as an AgentCore Runtime. The CDK construct is at:
```
src/cdk/lib/microservices/petfood-agent.ts
```

Two runtimes are created:
- **PetFoodAgent** — Control (Claude Sonnet 4.6)
- **PetFoodAgentVariantB** — Treatment (Claude Haiku 4.5)

### Post-Deployment Steps

**Step 1 — Enable tracing on both runtimes:**

1. Open **AgentCore Console** → Agents
2. Select `PetFoodAgent` → Tracing → Edit → Enable → Save
3. Select `PetFoodAgentVariantB` → Tracing → Edit → Enable → Save

**Step 2 — Set up gateway, online evaluations, and A/B test:**

```bash
# macOS: export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib
AWS_PROFILE=default AWS_REGION=us-east-1 python3 src/cdk/scripts/setup-ab-test.py
```

This script (idempotent — safe to re-run):
- Creates per-variant online evaluation configs with 10 built-in evaluators (Coherence, Conciseness, Correctness, Faithfulness, GoalSuccessRate, InstructionFollowing, Refusal, ResponseRelevance, ToolParameterAccuracy, ToolSelectionAccuracy)
- Creates an AgentCore Gateway with HTTP targets for both agents
- Creates an A/B test with 80% control (Sonnet) / 20% treatment (Haiku) traffic split
- Creates IAM roles for gateway and A/B test execution
- Reuses existing eval configs if they already exist (preserves any evaluators you added via console)

**Step 3 — Deploy code-based Lambda evaluator (optional):**

```bash
AWS_PROFILE=default AWS_REGION=us-east-1 python3 src/cdk/scripts/setup-evaluator.py
```

Deploys a Lambda that checks whether the agent called both required APIs (deterministic PASS/FAIL). Add the returned evaluator ID to your online eval configs via the AgentCore Console.

**Step 4 — Set up config-bundle A/B test (optional):**

```bash
AWS_PROFILE=default AWS_REGION=us-east-1 python3 src/cdk/scripts/setup-ab-test-config-bundle.py
```

This script (idempotent — safe to re-run):
- Creates two configuration bundles: Control (Sonnet + detailed prompt) and Treatment (Haiku + concise prompt)
- Creates a separate gateway (`PetFoodConfigBundleGateway`) with the control runtime as target
- Creates an A/B test using configuration bundle variants (single runtime, different configs injected via W3C baggage)
- The agent reads the active config bundle at runtime via `BedrockAgentCoreContext.get_config_bundle()`

**Two A/B test patterns available:**

| Pattern | Script | When to use |
|---------|--------|-------------|
| Target-based | `setup-ab-test.py` | Different models/code (two runtimes) |
| Config-bundle | `setup-ab-test-config-bundle.py` | Different prompts/model IDs (one runtime) |

**Step 5 — Generate traffic and verify:**

```bash
# Target-based A/B test traffic
bash src/cdk/scripts/loadgen-ab-test.sh 100

# Config-bundle A/B test traffic
bash src/cdk/scripts/loadgen-ab-test-config-bundle.sh 50
```

**Step 6 — View results:**

- **CloudWatch** → GenAI Observability → Bedrock AgentCore → traces, sessions, evaluation scores
- **CloudWatch** → Metrics → Bedrock-AgentCore → gateway invocation metrics
- **AgentCore Console** → A/B Testing → per-evaluator scores, p-values, statistical significance
- **AgentCore Console** → Evaluation → online eval config results

### How Evaluation Scoring Works

1. You chat or send traffic → traces appear in CloudWatch immediately
2. Session idle timeout expires (~5 min of no new requests in that session)
3. Online evaluation picks up the completed session and runs all configured evaluators (~5 min)
4. Evaluation scores appear under CloudWatch GenAI Observability → Evaluations

### Querying Evaluation Scores

Online evaluations store per-session scores with detailed LLM-judge explanations in CloudWatch Logs:

```
/aws/bedrock-agentcore/evaluations/results/<eval-config-id>
```

Find your eval config IDs via the AgentCore Console → Evaluation → your config name.

CloudWatch Logs Insights query for top/bottom scoring sessions:

```sql
fields @timestamp, attributes.`gen_ai.evaluation.name` as evaluator,
  attributes.`gen_ai.evaluation.score.value` as score,
  attributes.`gen_ai.evaluation.score.label` as label,
  attributes.`session.id` as session_id,
  attributes.`gen_ai.evaluation.explanation` as reason
| filter evaluator = "Builtin.Helpfulness"
| sort score asc
| limit 10
```

Replace `Builtin.Helpfulness` with any evaluator name (Coherence, Faithfulness, GoalSuccessRate, etc.). Use `sort score desc` for top-scoring sessions.

### Important Notes

- The stack sets `OTEL_TRACES_SAMPLER=always_on` on both runtimes for full trace capture
- Expect ~10 minutes from last chat message to evaluation scores appearing (5 min session timeout + eval processing)
- A/B test results accumulate over time — statistical significance improves with sample size
- Code-based Lambda evaluators work with online eval but NOT with A/B tests (only built-in evaluators supported for A/B)

## Related Files

| File | Purpose |
|------|---------|
| `src/cdk/lib/microservices/petfood-agent.ts` | CDK construct for both runtimes |
| `src/cdk/scripts/setup-ab-test.py` | Target-based A/B test setup |
| `src/cdk/scripts/setup-ab-test-config-bundle.py` | Config-bundle A/B test setup |
| `src/cdk/scripts/setup-evaluator.py` | Code-based Lambda evaluator |
| `src/cdk/scripts/loadgen-ab-test.sh` | Traffic generator for target-based test |
| `src/cdk/scripts/loadgen-ab-test-config-bundle.sh` | Traffic generator for config-bundle test |
| `src/applications/lambda/petfood-tool-evaluator/` | Lambda evaluator source |
