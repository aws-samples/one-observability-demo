"""Adoption sub-agent — LlamaIndex FunctionAgent on Bedrock Claude."""

from __future__ import annotations

import json

from llama_index.core.agent.workflow import FunctionAgent
from llama_index.core.tools import FunctionTool
from llama_index.llms.bedrock_converse import BedrockConverse

from waggle_ai_agents.common import config, models, petstore
from waggle_ai_agents.common.asyncrun import run_coro_sync

ADOPTION_PROMPT = """You are the Adoption specialist for Waggle, the PetStore assistant.
You help customers find and adopt pets.

The store only stocks young animals. Valid pet types are: puppy, kitten, bunny —
map the customer's words to these (a "cat" is a kitten, a "dog" is a puppy, a
"rabbit" is a bunny). Valid colors are: black, brown, white.

- Use `search_available_pets` to browse/list pets a customer can adopt, filtered
  by type and/or color. This is your main tool for "what's available".
- Use `complete_adoption` to finalize an adoption. You need pet_id, pet_type
  (puppy|kitten|bunny), and user_id. If user_id is unknown, ask for it first.
- `list_recent_adoptions` is adoption HISTORY (already-adopted pets) — only use
  it if the customer asks about recent/past adoptions, never to show availability.

Customers usually refer to a pet by its PET ID (clicking a photo in the chat sends
"adopt pet <petid>, the <pettype>"). Call `search_available_pets` to confirm that
pet's type, color and price, describe it, and ask the customer to confirm. Only
call `complete_adoption` once they confirm, because adopting is a real transaction.
If the customer instead gives a PHOTO URL, match it against each pet's `peturl` to
get the petid. If nothing matches, say so and show what is available instead.

When you list pets, include each pet's photo as markdown `![petid pettype](peturl)`
so the customer can see and click it.

When an adoption completes, state the pet id on its own line as `Pet ID: <petid>`
so the site can mark that pet as adopted.

Confirm exactly what you did and report the result. Be warm and clear."""


def search_available_pets(pettype: str = "", petcolor: str = "") -> str:
    """List pets available to adopt, optionally filtered by type and/or color.
    pettype: puppy | kitten | bunny (a cat is a kitten, a dog is a puppy).
    petcolor: black | brown | white. Leave an arg empty to not filter on it.
    Returns JSON."""
    return json.dumps(petstore.search_pets(pettype or None, petcolor or None))


def list_recent_adoptions() -> str:
    """List recently COMPLETED adoptions (history) — pets already adopted, not
    pets available to adopt. Use search_available_pets for availability. Returns JSON.
    """
    return json.dumps(petstore.list_recent_adoptions())


def complete_adoption(pet_id: str, pet_type: str, user_id: str) -> str:
    """Complete an adoption of pet_id (pet_type) for user_id. Returns JSON."""
    return json.dumps(petstore.complete_adoption(pet_id, pet_type, user_id))


class _NonStreamingBedrockConverse(BedrockConverse):
    """BedrockConverse that never streams tool calls."""

    async def astream_chat_with_tools(self, *args, **kwargs):  # noqa: ANN002,ANN003
        response = await self.achat_with_tools(*args, **kwargs)

        async def _single():
            yield response

        return _single()


_llm = _NonStreamingBedrockConverse(
    model=models.model_id("adoption"),
    region_name=config.AWS_REGION,
)

_agent = FunctionAgent(
    tools=[
        FunctionTool.from_defaults(fn=search_available_pets),
        FunctionTool.from_defaults(fn=list_recent_adoptions),
        FunctionTool.from_defaults(fn=complete_adoption),
    ],
    llm=_llm,
    system_prompt=ADOPTION_PROMPT,
)


async def _run_agent(message: str):
    # Deferred so _agent.run()'s create_task lands inside run_coro_sync's loop, not "no running event loop".
    return await _agent.run(message)


def run(query: str, user_id: str | None = None, session_id: str | None = None) -> str:
    """Answer/execute an adoption request and return plain text."""
    message = query if not user_id else f"[userId={user_id}] {query}"
    return str(run_coro_sync(_run_agent(message)))
