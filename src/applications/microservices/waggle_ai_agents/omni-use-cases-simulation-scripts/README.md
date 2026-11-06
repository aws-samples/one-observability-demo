# Omni use-case simulation scripts

These scripts support the Amazon CloudWatch Omni agent observability modules of the [One Observability Workshop](https://observability.workshop.aws/). They stage and reverse the agent incidents in the use cases, so they are not part of the running application.

Run them from this folder, `src/applications/microservices/waggle_ai_agents/omni-use-cases-simulation-scripts/`, in your `one-observability-demo` checkout. The use-case pages tell you when to run each one. All scripts are safe to run more than once.

| Script | What it does |
| --- | --- |
| `inject-fault.sh` | Applies yesterday evening's release (`fault/release.patch`) to the nutrition agent, commits it, and deploys it |
| `deploy-agent.sh` | Deploys the committed nutrition agent source to Amazon Bedrock AgentCore |
| `dashboard.sh` | Creates or updates the `waggle-sre` CloudWatch Omni dashboard (`--with-quality` adds the agent quality section) |
| `restore-agent.sh` | Lists what it will remove, then drops the release and fix commits, redeploys the original agent, and deletes the build source (`-y` skips the question) |
| `switch-guardrail.sh <version>` | Sets the guardrail version (a number or `DRAFT`) and redeploys the orchestrator and nutrition agents so both use it (`-y` skips the question) |
