"""Query the nutrition Knowledge Base (Bedrock Retrieve API)."""

from __future__ import annotations

from typing import Any

import boto3

from waggle_ai_agents.common import config

_client = None


def _runtime():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-agent-runtime", region_name=config.AWS_REGION)
    return _client


def retrieve(query: str, k: int = 4) -> list[dict[str, Any]]:
    """Return up to `k` relevant passages from the nutrition KB."""
    kb_id = config.nutrition_kb_id()
    if not kb_id:
        return []
    resp = _runtime().retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery={"text": query},
        retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": k}},
    )
    results = []
    for r in resp.get("retrievalResults", []):
        results.append(
            {
                "text": r.get("content", {}).get("text", ""),
                "source": r.get("location", {}).get("s3Location", {}).get("uri", ""),
                "score": r.get("score"),
            },
        )
    return results
