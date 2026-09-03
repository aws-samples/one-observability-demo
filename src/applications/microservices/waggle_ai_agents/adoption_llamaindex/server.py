"""AgentCore Runtime entrypoint for the Adoption agent (LlamaIndex)."""

from waggle_ai_agents.adoption_llamaindex import run
from waggle_ai_agents.common.agentcore_server import build_app

app = build_app(run)

if __name__ == "__main__":
    app.run()
