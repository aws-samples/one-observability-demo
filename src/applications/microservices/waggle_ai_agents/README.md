# waggle_ai_agents

**Waggle**, the PetStore assistant — a **Strands orchestrator** that delegates to four
framework-diverse sub-agents, each on a different model/provider and each
auto-instrumented by the AWS Distro for OpenTelemetry (ADOT).

Every agent is a self-contained package with the same two pieces: an `agent.py`
holding the agent and its tools, and a `server.py` exposing that agent's `run()`
as a Bedrock AgentCore Runtime entrypoint.

## Agents

| Module | Framework | Model | Role | ADOT instrumentor |
| --- | --- | --- | --- | --- |
| `orchestrator_strands/` | Strands | Claude Sonnet 4.6 | Routes to sub-agents | native OTel |
| `nutrition_langgraph/` | LangGraph | Claude Sonnet 4.6 | Diet matching + RAG | `aws_langchain` |
| `ordering_crewai/` | CrewAI | Nova 2 Lite | Cart / checkout / order | `aws_crewai` |
| `adoption_llamaindex/` | LlamaIndex | Llama 4 Maverick | Browse + adopt | `aws_llama-index` |
| `concierge_openai/` | OpenAI Agents SDK | gpt-oss-120b | Conversational Q&A | `aws_openai_agents` |

## Layout

```text
waggle_ai_agents/
├── orchestrator_strands/       supervisor over the sub-agents
│   ├── agent.py                routes each request to the right sub-agent
│   ├── delegate.py             orchestrator -> sub-agent transport (SigV4 via the Gateway)
│   └── server.py               AgentCore Runtime entrypoint
├── nutrition_langgraph/        agent.py + server.py — diet matching, grounded in the KB
├── ordering_crewai/            agent.py + server.py — catalog, cart, checkout
├── adoption_llamaindex/        agent.py + server.py — pet search and adoption
├── concierge_openai/           agent.py + server.py — general pet Q&A
├── common/
│   ├── agentcore_server.py     wraps an agent's run() as an AgentCore Runtime app
│   ├── config.py               central config: SSM /petstore/*, .env to override
│   ├── models.py               single source of truth for which model each agent uses
│   ├── memory.py               AgentCore Memory helper (short and long-term recall)
│   ├── petstore.py             thin client over the PetStore backend microservices
│   └── asyncrun.py             runs a coroutine from sync code, even inside a live loop
├── rag/
│   ├── knowledge/              nutrition corpus (10 markdown documents)
│   ├── retrieval.py            queries the Knowledge Base (Bedrock Retrieve API)
│   └── setup_kb.py             provisions that KB on S3 Vectors, standalone and idempotent
├── deploy/                     one Dockerfile and pinned requirements per agent
└── requirements.txt            union of all five agents' dependencies, for local work
```

## Configuration

- **Model per agent** → `common/models.py` is the single source of truth. Each is
  env-overridable (`ORCHESTRATOR_MODEL_ID`, `NUTRITION_MODEL_ID`, `ORDERING_MODEL_ID`,
  `ADOPTION_MODEL_ID`, `CONCIERGE_MODEL_ID`), which is the seam for A/B-ing a model
  with no code change. Backbone ids live in `common/config.py`.
- **Backend URLs, gateway URL, KB id, Memory id, guardrail id and version** → resolved
  from SSM Parameter Store (`/petstore/*`) by `common/config.py`.
- **Auth** → the standard AWS credential chain (SigV4) throughout. Strands, LangGraph
  and LlamaIndex use boto3; CrewAI and the OpenAI-Agents concierge use LiteLLM's
  Bedrock provider. No API keys, no bearer tokens.
- **`.env`** → optional local overrides only (region, model ids), loaded by explicit
  path in `config.py` so it works from the parent directory.

Requires **Bedrock model access** in the region for Claude Sonnet 4.6, Nova 2 Lite,
Llama 4 Maverick, gpt-oss-120b, and Titan Text Embeddings v2 (embeddings for RAG).

## RAG

`rag/knowledge/*.md` is the nutrition corpus. The nutrition agent's
`retrieve_nutrition_guidance` tool resolves the Knowledge Base id from SSM and queries
it through `rag/retrieval.py`. Edit or extend the corpus to change what the agent knows.

## Local development

`requirements.txt` is the union of all five agents' dependencies, for working on the
package outside a container — the images install only `deploy/requirements.<agent>.txt`.
Backend calls go to internal ALBs, so tool calls only resolve from inside the VPC;
model calls, SSM and KB retrieval work anywhere with credentials.

```bash
cd src/applications/microservices/waggle_ai_agents
python -m venv .venv && source .venv/bin/activate   # Python >= 3.10 (crewai / llama-index)
pip install -r requirements.txt
```
