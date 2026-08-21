"""AgentCore Runtime entrypoint for the Strands Orchestrator."""

from waggle_ai_agents.common.agentcore_server import build_streaming_app
from waggle_ai_agents.orchestrator_strands import stream_run

app = build_streaming_app(stream_run)

if __name__ == "__main__":
    app.run()
