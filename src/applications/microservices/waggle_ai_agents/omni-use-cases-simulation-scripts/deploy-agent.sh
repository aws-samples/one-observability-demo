#!/bin/bash
# Ship the committed agent source to its Amazon Bedrock AgentCore runtime.
# Packages HEAD, builds the image with the workshop's CodeBuild project for the agent, and waits
# until the runtime serves the new version.
# Usage: deploy-agent.sh [nutrition|orchestrator]   (default: nutrition)
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-west-2)}
export AWS_PAGER=""
AGENT=${1:-nutrition}
case "$AGENT" in
  nutrition)    RT_NAME=WaggleAINutrition;    PROJECT_PREFIX=Buildwaggleainutrition ;;
  orchestrator) RT_NAME=WaggleAIOrchestrator; PROJECT_PREFIX=Buildwaggleaiorchestrator ;;
  *) echo "usage: deploy-agent.sh [nutrition|orchestrator]" >&2; exit 1 ;;
esac
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

# The one-observability-demo checkout: the folder above this one, or a subfolder of it.
REPO_DIR=
for d in "$TOOLS_DIR/.." "$TOOLS_DIR/../one-observability-demo"; do
  REPO_DIR=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && break
done
[ -n "$REPO_DIR" ] || die "no one-observability-demo git checkout next to $TOOLS_DIR"
cd "$REPO_DIR"
AGENTS_PATH=src/applications/microservices/waggle_ai_agents

BUCKET=$(aws s3api list-buckets --output text \
  --query "Buckets[?contains(Name,'containerspipelineartifa')].Name | [0]")
PROJECT=$(aws codebuild list-projects --output text \
  --query "projects[?starts_with(@,'$PROJECT_PREFIX')] | [0]")
RT=$(aws bedrock-agentcore-control list-agent-runtimes --output text \
  --query "agentRuntimes[?agentRuntimeName=='$RT_NAME'].agentRuntimeId | [0]")
[ "$BUCKET" != None ] && [ "$PROJECT" != None ] && [ "$RT" != None ] || die "workshop build resources not found"
BEFORE=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT" \
  --query agentRuntimeVersion --output text)

say "Deploying: $(git log -1 --format='%h %s')"
git archive --format=zip -o "/tmp/$AGENT-src.zip" HEAD "$AGENTS_PATH"
aws s3 cp "/tmp/$AGENT-src.zip" "s3://$BUCKET/use-case/$AGENT-src.zip" --quiet
BUILD=$(aws codebuild start-build --project-name "$PROJECT" --artifacts-override type=NO_ARTIFACTS \
  --source-type-override S3 --source-location-override "$BUCKET/use-case/$AGENT-src.zip" \
  --query build.id --output text)
say "Building the $AGENT agent image (about 2 minutes)"
while STATUS=$(aws codebuild batch-get-builds --ids "$BUILD" \
  --query 'builds[0].buildStatus' --output text); [ "$STATUS" = IN_PROGRESS ]; do sleep 15; done
[ "$STATUS" = SUCCEEDED ] || die "image build $STATUS (CodeBuild build $BUILD)"
ok "image build SUCCEEDED"

say "Waiting for the runtime to serve the new image"
until [ "$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT" \
  --query "agentRuntimeVersion!='$BEFORE' && status=='READY'" --output text)" = True ]; do sleep 10; done
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT" --output table \
  --query '{Runtime:agentRuntimeName,Version:agentRuntimeVersion,Status:status,Updated:lastUpdatedAt}'
