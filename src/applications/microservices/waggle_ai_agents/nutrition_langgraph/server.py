"""AgentCore Runtime entrypoint for the Nutrition agent (LangGraph)."""

from waggle_ai_agents.common.agentcore_server import build_app
from waggle_ai_agents.nutrition_langgraph import run

app = build_app(run)

if __name__ == "__main__":
    app.run()
