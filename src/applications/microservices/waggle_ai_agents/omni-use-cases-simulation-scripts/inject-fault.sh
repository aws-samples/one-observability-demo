#!/bin/bash
# Stage the incident: commit "yesterday evening's release" to the nutrition agent and deploy it.
# The change is fault/release.patch. You do not need to read it; finding the bug is the exercise.
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_PAGER=""
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
skip() { printf '\033[0;33m  --\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

# The one-observability-demo checkout: the folder above this one, or a subfolder of it.
REPO_DIR=
for d in "$TOOLS_DIR/.." "$TOOLS_DIR/../one-observability-demo"; do
  REPO_DIR=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && break
done
[ -n "$REPO_DIR" ] || die "no one-observability-demo git checkout next to $TOOLS_DIR"
cd "$REPO_DIR"

AGENTS_PATH=src/applications/microservices/waggle_ai_agents
SUBJECT="perf(nutrition): filter the food catalog server-side to cut payload"
PATCH="$TOOLS_DIR/fault/release.patch"

if [ -n "$(git log --fixed-strings --grep="$SUBJECT" --format=%h)" ]; then
  skip "the release is already committed: $(git log -1 --fixed-strings --grep="$SUBJECT" --format='%h %s')"
else
  [ -z "$(git status --porcelain -- "$AGENTS_PATH")" ] || die "uncommitted changes under $AGENTS_PATH; undo them first (git -C $REPO_DIR checkout -- $AGENTS_PATH)"
  git apply --check "$PATCH" 2>/dev/null ||
    die "the release no longer applies to $AGENTS_PATH; regenerate fault/release.patch (see fault/README.md)"
  git apply "$PATCH"
  git -c user.name="Waggle release" -c user.email="release@waggle.invalid" \
    commit -q -m "$SUBJECT" -- "$AGENTS_PATH"
  ok "committed $(git log -1 --format='%h %s')"
fi
"$TOOLS_DIR/deploy-agent.sh"
say "The incident is live."
