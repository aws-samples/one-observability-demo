"""AgentCore Memory helper — best-effort short/long-term memory for agents."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import boto3

from waggle_ai_agents.common import config

logger = logging.getLogger(__name__)

_client = None


def _mem():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-agentcore", region_name=config.AWS_REGION)
    return _client


def record_turn(
    actor_id: str | None,
    session_id: str | None,
    user_text: str,
    assistant_text: str,
) -> None:
    """Store a user/assistant exchange as an event (best-effort)."""
    mem_id = config.memory_id()
    if not mem_id or not actor_id or not session_id:
        return
    try:
        _mem().create_event(
            memoryId=mem_id,
            actorId=actor_id,
            sessionId=session_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[
                {"conversational": {"role": "USER", "content": {"text": user_text}}},
                {
                    "conversational": {
                        "role": "ASSISTANT",
                        "content": {"text": assistant_text},
                    },
                },
            ],
        )
    except Exception as exc:  # noqa: BLE001 - memory is best-effort
        logger.warning("memory.record_turn failed: %s", exc)


def recall(
    actor_id: str | None,
    query: str,
    session_id: str | None = None,
    max_results: int = 3,
) -> str:
    """Assemble memory context for the prompt; '' if none/unavailable."""
    mem_id = config.memory_id()
    if not mem_id or not actor_id:
        return ""

    blocks: list[str] = []

    # Long-term durable preferences (cross-session).
    try:
        resp = _mem().retrieve_memory_records(
            memoryId=mem_id,
            namespace=f"/waggleai/{actor_id}/preferences",
            searchCriteria={"searchQuery": query, "topK": max_results},
        )
        records = resp.get("memoryRecordSummaries") or resp.get("memoryRecords") or []
        prefs = [(r.get("content") or {}).get("text", "") for r in records]
        prefs = [t for t in prefs if t]
        if prefs:
            blocks.append("Known preferences about this user:\n- " + "\n- ".join(prefs))
    except Exception as exc:  # noqa: BLE001
        logger.warning("memory.recall (preferences) failed: %s", exc)

    # Short-term recent turns of this session (immediate; no extraction delay).
    if session_id:
        try:
            resp = _mem().list_events(
                memoryId=mem_id,
                actorId=actor_id,
                sessionId=session_id,
                maxResults=20,
            )
            events = sorted(resp.get("events", []), key=lambda e: e.get("eventId", ""))
            lines: list[str] = []
            for ev in events:
                for item in ev.get("payload", []):
                    conv = item.get("conversational") or {}
                    text = (conv.get("content") or {}).get("text", "")
                    if text:
                        lines.append(f"{(conv.get('role') or '').title()}: {text}")
            if lines:
                blocks.append(
                    "Recent conversation this session:\n" + "\n".join(lines[-16:]),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("memory.recall (events) failed: %s", exc)

    return "\n\n".join(blocks)
