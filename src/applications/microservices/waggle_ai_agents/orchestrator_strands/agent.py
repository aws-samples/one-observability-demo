"""Strands orchestrator — routes each request to the right sub-agent."""

from __future__ import annotations

from contextvars import ContextVar

from strands import Agent, tool
from strands.models import BedrockModel

from waggle_ai_agents.common import config, models
from waggle_ai_agents.orchestrator_strands.delegate import delegate

_current_user: ContextVar[str | None] = ContextVar("current_user", default=None)

ORCHESTRATOR_PROMPT = """You are the orchestrator for Waggle, the PetStore assistant.
You do not answer directly; you route each user request to exactly one specialist tool:

- `nutrition_advisor` -> diet analysis and food recommendations for a pet.
- `food_ordering`     -> add food to cart, review cart, checkout/place an order.
- `adoption`          -> browse adoptable pets or complete an adoption.
- `concierge_chat`    -> general conversational questions and small talk.

Pick the single best tool, pass the user's request (rephrased with any useful
context), and return the specialist's answer to the user. If a request spans
areas (e.g. "recommend food AND order it"), call the tools in sequence.
Keep the final reply friendly and concise.

Pass the user's message through verbatim when it contains a URL (e.g. a pet photo
the user clicked), and keep any markdown image links `![alt](url)` the specialist
returns intact in your reply — the chat UI renders those as clickable photos."""


@tool
def nutrition_advisor(query: str) -> str:
    """Delegate to the Nutrition specialist (LangGraph) for pet diet analysis
    and food recommendations. Input: the user's nutrition question."""
    return delegate("nutrition", query, user_id=_current_user.get())


@tool
def food_ordering(query: str) -> str:
    """Delegate to the Ordering clerk (CrewAI) to add food to a cart, review the
    cart, and check out / place a food order."""
    return delegate("ordering", query, user_id=_current_user.get())


@tool
def adoption(query: str) -> str:
    """Delegate to the Adoption specialist (LlamaIndex) to browse pets available
    for adoption or complete an adoption."""
    return delegate("adoption", query, user_id=_current_user.get())


@tool
def concierge_chat(query: str) -> str:
    """Delegate to the Concierge (OpenAI Agents SDK) for general, conversational
    pet questions and small talk."""
    return delegate("concierge", query, user_id=_current_user.get())


_model_kwargs: dict = {
    "model_id": models.model_id("orchestrator"),
    "region_name": config.AWS_REGION,
}
if config.guardrail_id():  # apply the Bedrock Guardrail when configured (SSM/env)
    _model_kwargs["guardrail_id"] = config.guardrail_id()
    _model_kwargs["guardrail_version"] = config.guardrail_version()
_model = BedrockModel(**_model_kwargs)

_orchestrator = Agent(
    model=_model,
    system_prompt=ORCHESTRATOR_PROMPT,
    tools=[nutrition_advisor, food_ordering, adoption, concierge_chat],
    callback_handler=None,
)


def run(query: str, user_id: str | None = None, session_id: str | None = None) -> str:
    """Route a user message through the orchestrator and return plain text."""
    from waggle_ai_agents.common import memory

    recalled = memory.recall(user_id, query, session_id=session_id)
    prompt = f"{recalled}\n\n---\nCurrent user message: {query}" if recalled else query

    token = _current_user.set(user_id)
    try:
        answer = str(_orchestrator(prompt))
    finally:
        _current_user.reset(token)

    memory.record_turn(user_id, session_id, query, answer)
    return answer


async def stream_run(
    query: str,
    user_id: str | None = None,
    session_id: str | None = None,
):
    """Stream the orchestrator's final answer as text chunks (async generator)."""
    from waggle_ai_agents.common import memory

    recalled = memory.recall(user_id, query, session_id=session_id)
    prompt = f"{recalled}\n\n---\nCurrent user message: {query}" if recalled else query

    token = _current_user.set(user_id)
    parts: list[str] = []
    try:
        async for event in _orchestrator.stream_async(prompt):
            text = event.get("data") if isinstance(event, dict) else None
            if text:
                parts.append(text)
                yield text
    finally:
        _current_user.reset(token)

    memory.record_turn(user_id, session_id, query, "".join(parts))
