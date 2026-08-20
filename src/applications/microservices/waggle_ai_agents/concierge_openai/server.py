"""AgentCore Runtime entrypoint for the Concierge agent (OpenAI Agents SDK)."""

from waggle_ai_agents.common.agentcore_server import build_app
from waggle_ai_agents.concierge_openai import run

app = build_app(run)

if __name__ == "__main__":
    app.run()
