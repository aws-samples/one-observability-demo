#!/bin/bash
# Redeploy the payforadoption-go ECS service so its tasks read their configuration again.
# Starts a new deployment and waits until only the new tasks receive traffic from the load balancer.
# Usage: redeploy-payforadoption.sh [--quiet]   (--quiet: shorter output, used by the other scripts)
set -euo pipefail
export AWS_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}
[ -n "$AWS_REGION" ] || { echo "Set AWS_REGION to the Region where the workshop runs" >&2; exit 1; }
export AWS_PAGER=""
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m  error\033[0m %s\n' "$*" >&2; exit 1; }
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
QUIET=
case "${1:-}" in --quiet) QUIET=1 ;; "") ;; *) die "usage: redeploy-payforadoption.sh [--quiet]" ;; esac

CLUSTER=$(aws ecs list-clusters --output text --query "clusterArns[?contains(@,'PetsiteECS')] | [0]")
{ [ -n "$CLUSTER" ] && [ "$CLUSTER" != None ]; } || die "ECS cluster PetsiteECS-cluster not found"
CLUSTER=${CLUSTER##*/}
SERVICE=$(aws ecs list-services --cluster "$CLUSTER" --output text \
  --query "serviceArns[?contains(@,'payforadoption')] | [0]")
{ [ -n "$SERVICE" ] && [ "$SERVICE" != None ]; } || die "ECS service payforadoption-go not found in $CLUSTER"
SERVICE=${SERVICE##*/}
TG=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output text \
  --query 'services[0].loadBalancers[0].targetGroupArn')
{ [ -n "$TG" ] && [ "$TG" != None ]; } || die "no target group on $SERVICE"

# Private IPs of the running tasks that belong to deployment $DEP.
new_task_ips() {
  local arns
  arns=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status RUNNING \
    --output text --query taskArns)
  { [ -n "$arns" ] && [ "$arns" != None ]; } || return 0
  # shellcheck disable=SC2086
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks $arns --output text \
    --query "tasks[?startedBy=='$DEP' && lastStatus=='RUNNING'].attachments[].details[] | [?name=='privateIPv4Address'].value"
}

say "Redeploying the payment service ($SERVICE)"
DEP=$(aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment \
  --output text --query "service.deployments[?status=='PRIMARY'].id | [0]")
[ -n "$QUIET" ] || ok "deployment $DEP"

say "Waiting until only the new tasks receive traffic (about 4 minutes)"
START=$(date +%s)
while :; do
  read -r RUN DES STATE <<EOF
$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output text \
  --query "services[0].deployments[?id=='$DEP'] | [0].[runningCount,desiredCount,rolloutState]")
EOF
  [ "$STATE" != FAILED ] || die "deployment $DEP failed; see the service events in the Amazon ECS console"
  { is_num "$RUN" && is_num "$DES"; } || die "deployment $DEP is no longer listed on $SERVICE (another deployment replaced it?)"
  if [ "$DES" -gt 0 ] && [ "$RUN" -ge "$DES" ]; then
    NEW=" $(new_task_ips | tr '\t\n' '  ') "
    HEALTHY=$(aws elbv2 describe-target-health --target-group-arn "$TG" --output text \
      --query "TargetHealthDescriptions[?TargetHealth.State=='healthy'].Target.Id")
    N_NEW=0; N_OLD=0
    for ip in $HEALTHY; do
      case "$NEW" in *" $ip "*) N_NEW=$((N_NEW + 1)) ;; *) N_OLD=$((N_OLD + 1)) ;; esac
    done
    [ "$N_OLD" -gt 0 ] || [ "$N_NEW" -lt "$DES" ] || break
    echo "  new tasks healthy: $N_NEW/$DES, old tasks still in service: $N_OLD"
  else
    echo "  new tasks running: $RUN/$DES"
  fi
  [ $(( $(date +%s) - START )) -lt 900 ] || die "the new tasks did not take over within 15 minutes (deployment $DEP)"
  sleep 15
done
ok "only the $DES tasks of deployment $DEP receive traffic"
echo "  The old tasks finish draining and stop in the background (up to 5 minutes)."
