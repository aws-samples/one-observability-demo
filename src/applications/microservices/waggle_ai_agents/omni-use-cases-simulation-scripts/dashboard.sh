#!/bin/bash
# Create or update the waggle-sre CloudWatch Omni dashboard in your Space.
#   dashboard.sh                 -> RED, USE and AI agent sections (dashboard-base.json)
#   dashboard.sh --with-quality  -> adds the agent quality section (dashboard-with-quality.json)
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-west-2)}
export AWS_PAGER=""
ok()  { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

NAME=waggle-sre
BODY="$TOOLS_DIR/dashboard-base.json"
[ "${1:-}" = --with-quality ] && BODY="$TOOLS_DIR/dashboard-with-quality.json"
SPACE=$(aws cloudwatchomni list-spaces --output text --query "items[?status=='ACTIVE'].spaceId | [0]")
[ -n "$SPACE" ] && [ "$SPACE" != None ] || die "no active CloudWatch Omni space in $AWS_REGION; finish Set up Omni first"
DASH=$(aws cloudwatchomni list-omni-dashboards --space-id "$SPACE" --output text \
  --query "items[?name=='$NAME'].dashboardId | [0]")
if [ -n "$DASH" ] && [ "$DASH" != None ]; then
  aws cloudwatchomni update-omni-dashboard --space-id "$SPACE" --dashboard-id "$DASH" --name "$NAME" \
    --body "file://$BODY" >/dev/null
  ok "updated dashboard $NAME"
else
  aws cloudwatchomni create-omni-dashboard --space-id "$SPACE" --name "$NAME" \
    --description "Waggle SRE dashboard" --body "file://$BODY" >/dev/null
  ok "created dashboard $NAME"
fi
echo "Open your Omni web UI, choose Dashboards, then $NAME."
