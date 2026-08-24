"""Transport for orchestrator -> sub-agent delegation."""

from __future__ import annotations

import json
import os

from waggle_ai_agents.common import config

TRANSPORT = os.getenv("AGENT_TRANSPORT", "local")

# logical agent -> Gateway HTTP runtime target name (overridable per env)
_TARGETS = {
    "nutrition": os.getenv("NUTRITION_TARGET", "nutrition"),
    "ordering": os.getenv("ORDERING_TARGET", "ordering"),
    "adoption": os.getenv("ADOPTION_TARGET", "adoption"),
    "concierge": os.getenv("CONCIERGE_TARGET", "concierge"),
}


def delegate(agent: str, query: str, user_id: str | None = None) -> str:
    """Route a delegation to a sub-agent via the configured transport."""
    if TRANSPORT == "gateway":
        return _via_gateway(agent, query, user_id)
    return _in_process(agent, query, user_id)


def _in_process(agent: str, query: str, user_id: str | None) -> str:
    # Lazy imports so the gateway-transport orchestrator container never needs sub-agent deps.
    if agent == "nutrition":
        from waggle_ai_agents.nutrition_langgraph import run
    elif agent == "ordering":
        from waggle_ai_agents.ordering_crewai import run
    elif agent == "adoption":
        from waggle_ai_agents.adoption_llamaindex import run
    elif agent == "concierge":
        from waggle_ai_agents.concierge_openai import run
    else:
        raise ValueError(f"unknown agent '{agent}'")
    return run(query, user_id=user_id)


def _via_gateway(agent: str, query: str, user_id: str | None) -> str:
    """POST to the Gateway HTTP runtime target, signed with SigV4 (local creds)."""
    gateway = config.gateway_url()
    if not gateway:
        return json.dumps(
            {"error": "gateway URL not configured (env GATEWAY_URL or SSM)"},
        )
    import boto3
    import httpx
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest

    url = f"{gateway}/{_TARGETS[agent]}/invocations"
    body = json.dumps({"prompt": query, "userId": user_id or ""})
    signed = AWSRequest(
        method="POST",
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(
        boto3.Session().get_credentials(),
        "bedrock-agentcore",
        config.AWS_REGION,
    ).add_auth(signed)
    try:
        resp = httpx.post(url, content=body, headers=dict(signed.headers), timeout=120)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 - surface to the orchestrator
        return json.dumps({"error": f"gateway call to '{agent}' failed: {exc}"})
    if isinstance(data, dict):
        return data.get("output") or data.get("result") or json.dumps(data)
    return str(data)
