"""Ordering sub-agent (CrewAI)."""

import os

# Disable CrewAI telemetry here, before .agent imports crewai; this agent deploys on its own.
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")

from waggle_ai_agents.ordering_crewai.agent import run  # noqa: E402

__all__ = ["run"]
