#!/bin/bash
# Ship this morning's configuration change for the payment service, redeploy the payment service so
# it reads it, then send payments in the background, as shoppers would. Do not read this script
# before the use case: finding the change from the telemetry is the exercise.
# Shows what will change first and asks before it does anything. Use -y to skip the question.
# restore-payments.sh puts everything back.
# Usage: inject-fault.sh [-y|--yes]
set -euo pipefail
TOOLS_DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}
[ -n "$AWS_REGION" ] || { echo "Set AWS_REGION to the Region where the workshop runs" >&2; exit 1; }
export AWS_PAGER=""
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
skip() { printf '\033[0;33m  --\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

YES=
case "${1:-}" in
  -y|--yes) YES=1 ;;
  "") ;;
  *) die "usage: inject-fault.sh [-y|--yes]" ;;
esac
# ask <prompt> <default y|n>: always yes with -y; otherwise the answer, or the default on Enter.
ask() {
  [ -z "$YES" ] || return 0
  local reply
  read -r -p "$1 " reply || reply=
  case "${reply:-$2}" in [yY]*) return 0 ;; *) return 1 ;; esac
}

PARAM=/petstore/updateadoptionstatusurl
PARAM_ERRORMODE=/petstore/errormode1
# A well-formed hostname that does not resolve: every status update fails fast with a DNS error.
NEW_URL=https://status-updater.petstore.internal/prod/
PAYMENTS=2160  # one every 5 seconds: runs until restore-payments.sh stops it, for up to 3 hours
PID_FILE=/tmp/omni-send-payments.pid
LOG_FILE=/tmp/omni-send-payments.log
ssm_get() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }

OLD=$(ssm_get "$PARAM")
{ [ -n "$OLD" ] && [ "$OLD" != None ]; } || die "payment service configuration not found"
ERRORMODE=$(ssm_get "$PARAM_ERRORMODE")
SENDER=
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then SENDER=$(cat "$PID_FILE"); fi

say "Plan: ship this morning's configuration change for the payment service"
echo "  Payment service configuration: this morning's change"
echo "  Redeployed: payment service (about 4 minutes)"
if [ -n "$SENDER" ]; then
  echo "  Payments: already being sent in the background (PID $SENDER, log $LOG_FILE)"
else
  echo "  Payments: sent through PetSite in the background, one every 5 seconds, until restore-payments.sh stops them (up to 3 hours)"
fi
ask "Proceed? [y/N]" n || { echo "  -- nothing changed"; exit 0; }

if [ "$OLD" = "$NEW_URL" ]; then
  skip "the change is already in place"
else
  say "Shipping the configuration change"
  aws ssm put-parameter --name "$PARAM" --value "$NEW_URL" --type String --overwrite >/dev/null
  ok "configuration changed"
fi
if [ "$ERRORMODE" = true ]; then
  aws ssm put-parameter --name "$PARAM_ERRORMODE" --value false --type String --overwrite >/dev/null
  :
fi

bash "$TOOLS_DIR/redeploy-payforadoption.sh" --quiet \
  || die "payforadoption redeploy failed; the change is already in place, run this script again after fixing"

if [ -n "$SENDER" ]; then
  skip "payments are already being sent (PID $SENDER)"
else
  say "Sending payments in the background"
  nohup bash "$TOOLS_DIR/send-payments.sh" "$PAYMENTS" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  SENDER=$!
  sleep 2
  kill -0 "$SENDER" 2>/dev/null || die "the payment sender stopped right away; see $LOG_FILE"
  ok "PID $SENDER, log $LOG_FILE"
fi

say "Summary"
echo "  Payment service: redeployed with this morning's change"
echo "  Payments: sent in the background until restore-payments.sh stops them, at the latest $(date -u -d "+180 min" +%H:%M 2>/dev/null || date -u -v+180M +%H:%M) UTC (follow with: tail -f $LOG_FILE)"
echo "The incident is live."
