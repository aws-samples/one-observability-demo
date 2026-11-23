#!/bin/bash
# Send adoption payments through the PetSite web application, like shoppers choosing "Pay" on a pet.
# The workshop traffic generator only browses, so payments come from this script.
# Pays for the puppies and kittens (pet IDs 001 to 022) in turn, one payment every 5 seconds.
# After each round of 22 it calls PetSite housekeeping, which makes the adopted pets available again.
# Usage: send-payments.sh [count]   (default 60, about 5 minutes)
set -euo pipefail
export AWS_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}
[ -n "$AWS_REGION" ] || { echo "Set AWS_REGION to the Region where the workshop runs" >&2; exit 1; }
export AWS_PAGER=""
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }

COUNT=${1:-60}
case "$COUNT" in ''|*[!0-9]*|0) die "usage: send-payments.sh [count]" ;; esac
INTERVAL=5
PETS=22          # 001-015 are puppies, 016-022 are kittens
USER_ID=omnipay01  # at most 10 characters (Aurora user_id column)

PETSITE=$(aws ssm get-parameter --name /petstore/petsiteurl --query Parameter.Value --output text 2>/dev/null || true)
{ [ -n "$PETSITE" ] && [ "$PETSITE" != None ]; } || die "SSM parameter /petstore/petsiteurl not found"
PETSITE=${PETSITE%/}

housekeeping() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$PETSITE/housekeeping?userId=$USER_ID" || true)
  echo "${code:-000}"
}

say "Sending $COUNT payments to $PETSITE, one every $INTERVAL seconds (about $(( COUNT * INTERVAL / 60 + 1 )) minutes)"
SENT=0; NOT_SUCCESS=0
for i in $(seq 1 "$COUNT"); do
  idx=$(( (i - 1) % PETS + 1 ))
  if [ "$idx" -eq 1 ] && [ "$i" -gt 1 ]; then
    housekeeping >/dev/null
  fi
  PET_ID=$(printf '%03d' "$idx")
  if [ "$idx" -le 15 ]; then PET_TYPE=puppy; else PET_TYPE=kitten; fi
  RESULT=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 120 -X POST \
    --data "petid=$PET_ID&pettype=$PET_TYPE&userId=$USER_ID" "$PETSITE/Payment/MakePayment" 2>/dev/null || echo "000 -")
  SENT=$((SENT + 1))
  case "$RESULT" in *status=success*) ;; *) NOT_SUCCESS=$((NOT_SUCCESS + 1)); echo "  payment $i: PetSite answered ${RESULT%% *}" ;; esac
  [ $(( i % 10 )) -ne 0 ] || echo "  $(date -u +%H:%M:%S) UTC  $i/$COUNT sent"
  [ "$i" -eq "$COUNT" ] || sleep "$INTERVAL"
done
housekeeping >/dev/null
ok "$SENT payments sent"
