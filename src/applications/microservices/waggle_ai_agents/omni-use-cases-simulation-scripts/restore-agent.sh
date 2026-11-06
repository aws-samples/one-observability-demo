#!/bin/bash
# Put the nutrition agent back to the workshop's original code: drop the release and fix commits
# from ~/workshop, redeploy the agent, and delete the build source the deploy uploaded.
# Shows what will be removed first and asks before it does anything. Use -y to skip the question.
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-west-2)}
export AWS_PAGER=""
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
skip() { printf '\033[0;33m  --\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

YES=
case "${1:-}" in
  -y|--yes) YES=1 ;;
  "") ;;
  *) die "usage: restore-agent.sh [-y|--yes]" ;;
esac
# ask <prompt> <default y|n>: always yes with -y; otherwise the answer, or the default on Enter.
ask() {
  [ -z "$YES" ] || return 0
  local reply
  read -r -p "$1 " reply || reply=
  case "${reply:-$2}" in [yY]*) return 0 ;; *) return 1 ;; esac
}
count() { [ -n "$1" ] && printf '%s\n' "$1" | wc -l | tr -d ' ' || echo 0; }

# The one-observability-demo checkout: the folder above this one, or a subfolder of it.
REPO_DIR=
for d in "$TOOLS_DIR/.." "$TOOLS_DIR/../one-observability-demo"; do
  REPO_DIR=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && break
done
[ -n "$REPO_DIR" ] || die "no one-observability-demo git checkout next to $TOOLS_DIR"
cd "$REPO_DIR"
git rev-parse --verify -q origin/main >/dev/null || die "no origin/main in $REPO_DIR"

BUCKET=$(aws s3api list-buckets --output text \
  --query "Buckets[?contains(Name,'containerspipelineartifa')].Name | [0]")
RT=$(aws bedrock-agentcore-control list-agent-runtimes --output text \
  --query "agentRuntimes[?agentRuntimeName=='WaggleAINutrition'].agentRuntimeId | [0]")
[ "$BUCKET" != None ] && [ "$RT" != None ] || die "workshop build resources not found"
# Build sources the deploy scripts upload (use-case/<agent>-src.zip), one key per line.
list_zips() {
  local keys
  keys=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix use-case/ --output text \
    --query "Contents[?ends_with(Key,'-src.zip')].Key" 2>/dev/null || true)
  [ -z "$keys" ] || [ "$keys" = None ] || printf '%s\n' "$keys" | tr '\t' '\n'
}

COMMITS=$(git log --oneline origin/main..HEAD)
# The Omni extension appends lines to .gitignore; keep them across the reset.
CHANGES=$(git status --short --untracked-files=no | grep -v ' \.gitignore$' || true)
GITIGNORE_KEPT=
git diff --quiet HEAD -- .gitignore || GITIGNORE_KEPT=1
GITIGNORE_COMMITTED=
git diff --quiet origin/main HEAD -- .gitignore || GITIGNORE_COMMITTED=1
UNTRACKED=$(git status --short | grep '^??' || true)
WORKTREES=$(git worktree list | tail -n +2)
ZIPS_AT_PLAN=$(list_zips)
TARGET=$(git log -1 --format='%h %s' origin/main)
BEFORE=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT" \
  --query agentRuntimeVersion --output text)

say "Plan: restore the nutrition agent to origin/main ($TARGET)"
echo "Will be removed:"
if [ -z "$COMMITS" ] && [ -z "$CHANGES" ] && [ -z "$ZIPS_AT_PLAN" ]; then
  echo "  nothing to remove (already at origin/main, no build source)"
else
  if [ -n "$COMMITS" ]; then
    echo "  commits in $REPO_DIR (origin/main..HEAD):"
    printf '%s\n' "$COMMITS" | sed 's/^/    /'
  else
    echo "  commits: none (already at origin/main)"
  fi
  if [ -n "$CHANGES" ]; then
    echo "  uncommitted changes to tracked files:"
    printf '%s\n' "$CHANGES" | sed 's/^/    /'
  else
    echo "  uncommitted changes: none"
  fi
  if [ -n "$ZIPS_AT_PLAN" ]; then
    echo "  build source:"
    printf '%s\n' "$ZIPS_AT_PLAN" | sed "s|^|    s3://$BUCKET/|"
  else
    echo "  build source: none"
  fi
fi
echo "Will be redeployed:"
echo "  AgentCore runtime WaggleAINutrition: version $BEFORE -> new version built from origin/main"
echo "  (the runtime is set to the origin/main code even if the checkout already matches)"
echo "Stays as it is:"
echo "  Omni Space: online evaluation, datasets, evaluators (not touched by this script; each module's cleanup page removes its own)"
if [ -n "$WORKTREES" ]; then
  echo "  IDE local experiments and these git worktrees (not touched by this script; each module's cleanup page removes its own):"
  printf '%s\n' "$WORKTREES" | sed 's/^/    /'
else
  echo "  IDE local experiments (not touched by this script; each module's cleanup page removes its own)"
fi
echo "  IAM role WaggleOnlineEvaluationRole, guardrail settings"
echo "  lines the Omni extension added to .gitignore"
[ -z "$GITIGNORE_COMMITTED" ] || echo "  warning: the commits above change .gitignore; it will be reset to origin/main"
if [ -n "$UNTRACKED" ]; then
  echo "  untracked files in $REPO_DIR:"
  printf '%s\n' "$UNTRACKED" | sed 's/^/    /'
fi

PROMPT="Proceed? [y/N]"
DEFAULT=n
if [ -z "$COMMITS" ] && [ -z "$CHANGES" ]; then
  skip "already at origin/main; redeploying so the runtime runs the origin/main code"
  PROMPT="Redeploy the runtime from origin/main? [Y/n]"
  DEFAULT=y
fi
ask "$PROMPT" "$DEFAULT" || { skip "nothing changed"; exit 0; }

NCOMMITS=$(count "$COMMITS")
NCHANGES=$(count "$CHANGES")
if [ -n "$COMMITS" ] || [ -n "$CHANGES" ]; then
  say "Resetting $REPO_DIR to origin/main"
  KEEP=
  if [ -n "$GITIGNORE_KEPT" ] && [ -z "$GITIGNORE_COMMITTED" ]; then KEEP=$(mktemp); cp .gitignore "$KEEP"; fi
  git reset -q --hard origin/main
  if [ -n "$KEEP" ]; then cp "$KEEP" .gitignore; rm -f "$KEEP"; fi
  ok "HEAD is now $TARGET"
fi

"$TOOLS_DIR/deploy-agent.sh"

# The deploy uploads its own copy; delete it too, but report only what the plan listed.
while IFS= read -r key; do
  [ -z "$key" ] || aws s3 rm "s3://$BUCKET/$key" --quiet
done < <(list_zips)
rm -f /tmp/nutrition-src.zip /tmp/orchestrator-src.zip

AFTER=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT" \
  --query '[agentRuntimeVersion,status]' --output text)
say "Summary"
echo "Removed:"
echo "  commits: $NCOMMITS"
echo "  uncommitted changes: $NCHANGES file(s)"
if [ -n "$ZIPS_AT_PLAN" ]; then
  echo "  build source:"
  printf '%s\n' "$ZIPS_AT_PLAN" | sed "s|^|    s3://$BUCKET/|"
else
  echo "  build source: none"
fi
echo "Redeployed:"
echo "  WaggleAINutrition version $BEFORE -> ${AFTER%%$'\t'*} (status ${AFTER##*$'\t'})"
echo "Left in place: Omni Space evaluation/datasets/evaluators, IDE local experiments, WaggleOnlineEvaluationRole, guardrail settings"
echo "Check: open a new Waggle chat; the nutrition agent now runs the origin/main code."
