#!/bin/bash
# Put the payment service back the way the workshop deployed it: stop the background payments from
# inject-fault.sh, restore the pet status updater URL from the workshop's CloudFormation export,
# redeploy payforadoption-go, remove the payments recorded during the incident, and check that a
# payment adopts a pet. Safe to run any time, including before the use case and as clean up.
# Shows what will change first and asks before it does anything. Use -y to skip the question.
# Usage: restore-payments.sh [-y|--yes]
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
  *) die "usage: restore-payments.sh [-y|--yes]" ;;
esac
# ask <prompt> <default y|n>: always yes with -y; otherwise the answer, or the default on Enter.
ask() {
  [ -z "$YES" ] || return 0
  local reply
  read -r -p "$1 " reply || reply=
  case "${reply:-$2}" in [yY]*) return 0 ;; *) return 1 ;; esac
}

PARAM=/petstore/updateadoptionstatusurl
EXPORT_NAME=private:WorkshopStatusUpdaterApiUrl
PID_FILE=/tmp/omni-send-payments.pid
USER_ID=omnipay01
TEST_TYPE=kitten
TEST_ID=016
ssm_get() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }

GOOD=$(aws cloudformation list-exports --output text \
  --query "Exports[?Name=='$EXPORT_NAME'].Value" | tr '\t' '\n' | grep '^https://' | head -n1 || true)
[ -n "$GOOD" ] || die "CloudFormation export $EXPORT_NAME not found"
OLD=$(ssm_get "$PARAM")
{ [ -n "$OLD" ] && [ "$OLD" != None ]; } || OLD="(not set)"
PETSITE=$(ssm_get /petstore/petsiteurl)
{ [ -n "$PETSITE" ] && [ "$PETSITE" != None ]; } || die "SSM parameter /petstore/petsiteurl not found"
PETSITE=${PETSITE%/}
TABLE=$(ssm_get /petstore/dynamodbtablename)
{ [ -n "$TABLE" ] && [ "$TABLE" != None ]; } || die "SSM parameter /petstore/dynamodbtablename not found"
SENDER=
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then SENDER=$(cat "$PID_FILE"); fi

availability() {
  aws dynamodb get-item --table-name "$TABLE" --output text --query Item.availability.S \
    --key "{\"pettype\":{\"S\":\"$TEST_TYPE\"},\"petid\":{\"S\":\"$TEST_ID\"}}"
}
housekeeping() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$PETSITE/housekeeping?userId=$USER_ID" || true)
  echo "${code:-000}"
}
# wait_availability <value>: the pet availability reaches <value> within 30 seconds.
wait_availability() {
  local i
  for i in 1 2 3 4 5 6; do
    [ "$(availability)" = "$1" ] && return 0
    sleep 5
  done
  return 1
}

say "Plan: put the payment service back the way the workshop deployed it"
if [ "$OLD" = "$GOOD" ]; then
  echo "  Payment service configuration: already as the workshop deployed it"
else
  echo "  Payment service configuration: restored to what the workshop deployed"
fi
[ -z "$SENDER" ] || echo "  Background payments from inject-fault.sh (PID $SENDER): stopped"
echo "  Redeployed: payment service (about 4 minutes)"
echo "  Payments recorded during the incident: removed"
echo "  Test: one payment that adopts a pet, then the pet is made available again"
echo "  Stays as it is: Omni alerts, threads, and DevOps Agent investigations"

PROMPT="Proceed? [y/N]"
DEFAULT=n
if [ "$OLD" = "$GOOD" ]; then
  skip "the configuration is already restored; redeploying so every task uses it"
  PROMPT="Redeploy payforadoption-go and run the test? [Y/n]"
  DEFAULT=y
fi
ask "$PROMPT" "$DEFAULT" || { skip "nothing changed"; exit 0; }

if [ -n "$SENDER" ]; then
  kill "$SENDER" 2>/dev/null || true
  rm -f "$PID_FILE"
  ok "background payments stopped"
fi
if [ "$OLD" != "$GOOD" ]; then
  say "Restoring the configuration"
  aws ssm put-parameter --name "$PARAM" --value "$GOOD" --type String --overwrite >/dev/null
  ok "configuration restored"
fi

bash "$TOOLS_DIR/redeploy-payforadoption.sh" --quiet \
  || die "payment service redeploy failed; the configuration is already restored, run this script again after fixing"

say "Removing the payments recorded during the incident"
HK=$(housekeeping); [ "$HK" = 200 ] && ok "done" || skip "not done yet (HTTP $HK); the workshop repeats it within 30 minutes"

say "Test payment"
BEFORE=$(availability || true)
if [ "$BEFORE" != yes ]; then
  housekeeping >/dev/null
  wait_availability yes || die "$TEST_TYPE $TEST_ID is not available before the test (availability: $(availability || true))"
  BEFORE=yes
fi
curl -sS -o /dev/null --max-time 120 -X POST \
  --data "petid=$TEST_ID&pettype=$TEST_TYPE&userId=$USER_ID" "$PETSITE/Payment/MakePayment" || true
if wait_availability no; then
  RESULT="adopted (availability $BEFORE -> no)"
  ok "$RESULT"
else
  RESULT="NOT adopted (availability is still $(availability))"
  printf '\033[1;31m  error\033[0m %s\n' "$RESULT" >&2
fi
housekeeping >/dev/null
wait_availability yes && ok "$TEST_TYPE $TEST_ID is available again" \
  || skip "$TEST_TYPE $TEST_ID is not available yet; the housekeeping canary resets it within 30 minutes"

say "Summary"
echo "  Payment service: redeployed with the configuration the workshop deployed"
echo "  Test payment: $RESULT"
case "$RESULT" in adopted*) ;; *) die "payments still do not adopt pets" ;; esac
echo "Check: in CloudWatch Omni, payforadoption-api-go has no new faults after the redeploy."
