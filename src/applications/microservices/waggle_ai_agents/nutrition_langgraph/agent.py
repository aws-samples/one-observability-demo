"""Nutrition sub-agent — LangGraph ReAct agent on Bedrock Claude."""

from __future__ import annotations

import json

from langchain_aws import ChatBedrockConverse
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from waggle_ai_agents.common import config, models, petstore
from waggle_ai_agents.rag.retrieval import retrieve

NUTRITION_PROMPT = """You are the Nutrition specialist for Waggle, the PetStore assistant.
Your job: recommend the best foods for a specific pet, grounded in evidence.

Process:
1. Use `get_pet_profile` to fetch the pet's characteristics (type, color, id).
2. Use `retrieve_nutrition_guidance` to pull relevant nutrition guidance
   (life stage, breed size, health conditions like sensitive stomach/allergies).
3. Use `get_available_foods` to see the catalog.
4. Match foods to the pet using the retrieved guidance. Return 2-3 concrete
   recommendations, each with a short reason grounded in the guidance, and cite
   the food name/id. Show each recommended food's photo as markdown
   `![name](image_url)` using the catalog's image_url — the chat renders it as a
   clickable card the customer can add to their cart.

Be precise and factual. Prefer the retrieved guidance over guesses; if guidance
is missing, say so. If you lack pet details, say what you'd need."""


@tool
def get_pet_profile(pettype: str = "", petcolor: str = "", petid: str = "") -> str:
    """Look up pet(s) from the pet-search service by type, color, and/or id.
    Valid pettype: puppy | kitten | bunny (say kitten for a cat, puppy for a dog).
    Valid petcolor: black | brown | white. All args optional; pass what you know."""
    return json.dumps(
        petstore.search_pets(pettype or None, petcolor or None, petid or None),
    )


@tool
def get_available_foods() -> str:
    """List every available pet food from the catalog. Returns JSON."""
    return json.dumps(petstore.list_foods())


@tool
def retrieve_nutrition_guidance(query: str) -> str:
    """Search the pet-nutrition knowledge base for guidance relevant to `query`
    (life stage, breed size, health conditions, diet types). Returns cited passages."""
    hits = retrieve(query, k=4)
    if not hits:
        return json.dumps(
            {"note": "no nutrition KB configured or no matching guidance"},
        )
    return json.dumps([{"source": h["source"], "text": h["text"]} for h in hits])


_llm_kwargs: dict = {
    "model": models.model_id("nutrition"),
    "region_name": config.AWS_REGION,
    # No temperature: Sonnet 5 is a reasoning model and rejects it.
}
if config.guardrail_id():  # apply the Bedrock Guardrail when configured
    _llm_kwargs["guardrail_config"] = {
        "guardrailIdentifier": config.guardrail_id(),
        "guardrailVersion": config.guardrail_version(),
    }
_llm = ChatBedrockConverse(**_llm_kwargs)

_graph = create_react_agent(
    _llm,
    tools=[get_pet_profile, retrieve_nutrition_guidance, get_available_foods],
    prompt=NUTRITION_PROMPT,
)


def run(query: str, user_id: str | None = None, session_id: str | None = None) -> str:
    """Answer a nutrition/food-matching question and return plain text."""
    message = query if not user_id else f"[userId={user_id}] {query}"
    result = _graph.invoke({"messages": [("user", message)]})
    return result["messages"][-1].content
