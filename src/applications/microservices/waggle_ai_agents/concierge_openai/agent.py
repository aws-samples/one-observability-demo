"""Concierge sub-agent — OpenAI Agents SDK on Bedrock gpt-oss (via LiteLLM)."""

from __future__ import annotations

import json

from agents import Agent, Runner, function_tool, set_tracing_disabled
from agents.extensions.models.litellm_model import LitellmModel

from waggle_ai_agents.common import models, petstore
from waggle_ai_agents.common.asyncrun import run_coro_sync

# No OpenAI platform account here — disable the SDK's hosted tracing exporter.
set_tracing_disabled(True)

CONCIERGE_PROMPT = """You are Waggle, a warm, conversational pet-care concierge.
Answer general questions about pets, pet care, and what the PetStore offers.
Keep it friendly and concise. Use `lookup_foods` when the customer asks what
foods are available. For specific diet recommendations, ordering, or adoptions,
tell the customer you'll hand them to a specialist (the orchestrator will route)."""


@function_tool
def lookup_foods() -> str:
    """List the available pet foods from the catalog. Returns JSON."""
    return json.dumps(petstore.list_foods())


# LiteLLM bedrock provider -> SigV4 with the standard AWS credential chain.
_agent = Agent(
    name="Waggle Concierge",
    instructions=CONCIERGE_PROMPT,
    model=LitellmModel(model=models.litellm_model("concierge")),
    tools=[lookup_foods],
)


def run(query: str, user_id: str | None = None, session_id: str | None = None) -> str:
    """Answer a general pet question and return plain text."""
    message = query if not user_id else f"[userId={user_id}] {query}"
    result = run_coro_sync(Runner.run(_agent, message))
    return result.final_output
