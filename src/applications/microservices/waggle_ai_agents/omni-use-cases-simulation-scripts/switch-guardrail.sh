#!/bin/bash
# Switch the Waggle guardrail version: set the SSM parameter, then redeploy the orchestrator and
# nutrition agents so both start with the new version.
# Shows what will change first and asks before it does anything. Use -y to skip the question.
# Usage: switch-guardrail.sh [-y|--yes] <version>   (<version> is a number or DRAFT)
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-west-2)}
export AWS_PAGER=""
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }
usage() { die "usage: switch-guardrail.sh [-y|--yes] <version|DRAFT>"; }

YES=
VERSION=
for a in "$@"; do
  case "$a" in
    -y|--yes) YES=1 ;;
    -*) usage ;;
    *) [ -z "$VERSION" ] || usage; VERSION=$a ;;
  esac
done
[ -n "$VERSION" ] || usage
VERSION=$(printf '%s' "$VERSION" | tr '[:lower:]' '[:upper:]')
case "$VERSION" in DRAFT|[1-9]*) ;; *) usage ;; esac
case "$VERSION" in *[!0-9]*) [ "$VERSION" = DRAFT ] || usage ;; esac
ask() {
  [ -z "$YES" ] || return 0
  local reply
  read -r -p "$1 " reply || reply=
  case "${reply:-$2}" in [yY]*) return 0 ;; *) return 1 ;; esac
}

PARAM_VERSION=/petstore/waggleai/guardrailversion
PARAM_ID=/petstore/waggleai/guardrailid
ssm_get() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }
runtime_id() {
  aws bedrock-agentcore-control list-agent-runtimes --output text \
    --query "agentRuntimes[?agentRuntimeName=='$1'].agentRuntimeId | [0]"
}
runtime_version() {
  aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$1" \
    --query agentRuntimeVersion --output text
}

OLD=$(ssm_get "$PARAM_VERSION")
GID=$(ssm_get "$PARAM_ID")
{ [ -n "$OLD" ] && [ "$OLD" != None ]; } || OLD="(not set)"
{ [ -n "$GID" ] && [ "$GID" != None ]; } || die "SSM parameter $PARAM_ID not found"
aws bedrock get-guardrail --guardrail-identifier "$GID" --guardrail-version "$VERSION" \
  >/dev/null 2>&1 || die "guardrail $GID has no version $VERSION"
RT_ORCH=$(runtime_id WaggleAIOrchestrator)
RT_NUTR=$(runtime_id WaggleAINutrition)
{ [ -n "$RT_ORCH" ] && [ "$RT_ORCH" != None ] && [ -n "$RT_NUTR" ] && [ "$RT_NUTR" != None ]; } \
  || die "agent runtimes not found"
ORCH_BEFORE=$(runtime_version "$RT_ORCH")
NUTR_BEFORE=$(runtime_version "$RT_NUTR")

say "Plan: switch the guardrail version"
echo "  SSM $PARAM_VERSION: $OLD -> $VERSION"
echo "  Guardrail $GID: version $VERSION exists"
echo "  Redeployed AgentCore runtimes:"
echo "    WaggleAIOrchestrator: version $ORCH_BEFORE -> new version"
echo "    WaggleAINutrition:    version $NUTR_BEFORE -> new version"
echo "  Why: agents read the guardrail version once at start, so they are redeployed to pick it up."
echo "  Redeploy runs even when the value is unchanged (an older instance may still hold the old one)."
ask "Proceed? [y/N]" n || { echo "  -- nothing changed"; exit 0; }

say "Setting $PARAM_VERSION to $VERSION"
aws ssm put-parameter --name "$PARAM_VERSION" --value "$VERSION" --type String --overwrite >/dev/null
ok "parameter set"

say "Redeploying both agents in parallel (about 3 minutes)"
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT
"$TOOLS_DIR/deploy-agent.sh" orchestrator >"$LOGDIR/orchestrator.log" 2>&1 & PID_ORCH=$!
"$TOOLS_DIR/deploy-agent.sh" nutrition >"$LOGDIR/nutrition.log" 2>&1 & PID_NUTR=$!
FAILED=
wait "$PID_ORCH" || { FAILED=1; tail -n 15 "$LOGDIR/orchestrator.log" >&2; }
wait "$PID_NUTR" || { FAILED=1; tail -n 15 "$LOGDIR/nutrition.log" >&2; }
[ -z "$FAILED" ] || die "agent redeploy failed; the parameter is already $VERSION, run this script again after fixing"

ORCH_AFTER=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT_ORCH" \
  --query '[agentRuntimeVersion,status]' --output text)
NUTR_AFTER=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT_NUTR" \
  --query '[agentRuntimeVersion,status]' --output text)
say "Summary"
echo "  SSM $PARAM_VERSION: $OLD -> $VERSION"
echo "  WaggleAIOrchestrator version $ORCH_BEFORE -> ${ORCH_AFTER%%$'\t'*} (status ${ORCH_AFTER##*$'\t'})"
echo "  WaggleAINutrition    version $NUTR_BEFORE -> ${NUTR_AFTER%%$'\t'*} (status ${NUTR_AFTER##*$'\t'})"
echo "Check: open a new Waggle chat."
