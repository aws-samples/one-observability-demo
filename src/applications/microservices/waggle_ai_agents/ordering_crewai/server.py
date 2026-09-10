"""AgentCore Runtime entrypoint for the Ordering agent (CrewAI)."""

from waggle_ai_agents.common.agentcore_server import build_app
from waggle_ai_agents.ordering_crewai import run

app = build_app(run)

if __name__ == "__main__":
    app.run()
