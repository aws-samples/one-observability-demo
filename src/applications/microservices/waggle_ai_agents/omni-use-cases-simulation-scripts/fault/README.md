# Fault

`release.patch` stages the incident in the "Fix a production quality regression" use case of the Amazon CloudWatch Omni agent observability modules in the [One Observability Workshop](https://observability.workshop.aws/). It is not part of the running application, and `waggle_ai_agents/.dockerignore` keeps this folder out of the agent images.

The patch is the "server-side search" release. It changes two nutrition agent files:

| File (under `src/applications/microservices/waggle_ai_agents/`) | Change |
| --- | --- |
| `nutrition_langgraph/agent.py` | `get_available_foods()` now requires a `search` argument, and its description tells the model it must pass one |
| `common/petstore.py` | `list_foods()` passes `search` to the catalog service as a query parameter |

- `inject-fault.sh` runs `git apply --check`, applies the patch to this checkout, and commits the result as the release. `restore-agent.sh` removes that commit again.
- The patch only touches these lines. Other changes to the two files, including ones that move these lines, do not affect it.
- The `Tests` workflow runs `git apply --check` on every pull request, so a change that breaks the patch fails in that pull request.

> [!IMPORTANT]
> If you change `get_available_foods` in `nutrition_langgraph/agent.py` or `list_foods` in `common/petstore.py`, regenerate the patch in the same pull request. Otherwise `inject-fault.sh` stops and the use case can no longer be staged.

## Regenerate the patch

From the repository root, on a clean checkout of the updated code:

1. Make the release change again by hand: `get_available_foods(search: str)` calls `petstore.list_foods(search=search)`, and `list_foods(search=None)` sends `{"search": search}` as the query parameters.
2. Save the change and undo it:

    ```bash
    git diff -- src/applications/microservices/waggle_ai_agents/nutrition_langgraph/agent.py src/applications/microservices/waggle_ai_agents/common/petstore.py | sed 's/[[:space:]]*$//' > src/applications/microservices/waggle_ai_agents/omni-use-cases-simulation-scripts/fault/release.patch
    git checkout -- src/applications/microservices/waggle_ai_agents/nutrition_langgraph/agent.py src/applications/microservices/waggle_ai_agents/common/petstore.py
    git apply --check src/applications/microservices/waggle_ai_agents/omni-use-cases-simulation-scripts/fault/release.patch
    ```

The `sed` removes trailing whitespace, which the repository's pre-commit hook would strip anyway. `git apply` still accepts the patch without it.
