#!/usr/bin/env bash
set -Eeuo pipefail

# =============================================================================
# Cleanup AMP + AMG resources created by setup-amp-amg.sh
#
# Usage:
#   ./cleanup-amp-amg.sh --region <AWS_REGION> [OPTIONS]
# =============================================================================

AWS_REGION=""
AMP_ALIAS="demo-amp"
AMG_WORKSPACE_NAME="demo-amg"
SCRAPER_ALIAS="demo-amp-scraper"
CLUSTER_NAME="devops-agent-eks"
KEYCLOAK_NAMESPACE="keycloak"
KEYCLOAK_REALM="amg"
SKIP_KEYCLOAK="NO"
SKIP_SECRETS="NO"
SHOW_HELP="NO"

log() { echo "$*"; }
die() { echo ""; echo "ERROR: $*"; exit 1; }

usage() {
  cat <<EOF

Usage: ./cleanup-amp-amg.sh [OPTIONS]

Required:
  --region <region>              AWS region

Optional:
  --amp-alias <name>             AMP workspace alias (default: demo-amp)
  --amg-name <name>              AMG workspace name (default: demo-amg)
  --scraper-alias <name>         Scraper alias (default: demo-amp-scraper)
  --cluster <name>               EKS cluster name (default: devops-agent-eks)
  --keycloak-namespace <ns>      Keycloak namespace (default: keycloak)
  --keycloak-realm <realm>       Keycloak realm (default: amg)
  --skip-keycloak                Skip Keycloak cleanup (keep Helm release + namespace)
  --skip-secrets                 Skip Secrets Manager cleanup
  -h, --help                     Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)              AWS_REGION="$2";          shift 2 ;;
    --amp-alias)           AMP_ALIAS="$2";           shift 2 ;;
    --amg-name)            AMG_WORKSPACE_NAME="$2";  shift 2 ;;
    --scraper-alias)       SCRAPER_ALIAS="$2";       shift 2 ;;
    --cluster)             CLUSTER_NAME="$2";        shift 2 ;;
    --keycloak-namespace)  KEYCLOAK_NAMESPACE="$2";  shift 2 ;;
    --keycloak-realm)      KEYCLOAK_REALM="$2";      shift 2 ;;
    --skip-keycloak)       SKIP_KEYCLOAK="YES";      shift   ;;
    --skip-secrets)        SKIP_SECRETS="YES";       shift   ;;
    -h|--help)             SHOW_HELP="YES";          shift   ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [[ "$SHOW_HELP" == "YES" ]]; then usage; exit 0; fi
[[ -n "$AWS_REGION" ]] || die "--region is required"

for cmd in aws jq; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo ""
echo "Cleanup Configuration:"
echo "  Region:          $AWS_REGION"
echo "  AMP Alias:       $AMP_ALIAS"
echo "  AMG Name:        $AMG_WORKSPACE_NAME"
echo "  Scraper Alias:   $SCRAPER_ALIAS"
echo "  Skip Keycloak:   $SKIP_KEYCLOAK"
echo "  Skip Secrets:    $SKIP_SECRETS"
echo ""
# --- Delete managed scraper ---
log "=== Deleting managed scraper ==="
SCRAPER_ID=$(aws amp list-scrapers \
  --region "$AWS_REGION" --output json 2>/dev/null | \
  jq -r ".scrapers[] | select(.alias==\"${SCRAPER_ALIAS}\") | .scraperId" | head -1 || true)

if [[ -n "$SCRAPER_ID" && "$SCRAPER_ID" != "null" ]]; then
  # Get scraper role ARN before deleting (needed for identity mapping cleanup)
  SCRAPER_ROLE_ARN=$(aws amp describe-scraper --scraper-id "$SCRAPER_ID" --region "$AWS_REGION" \
    --query 'scraper.roleArn' --output text 2>/dev/null || true)

  aws amp delete-scraper --scraper-id "$SCRAPER_ID" --region "$AWS_REGION" 2>/dev/null || true
  log "  Deleting scraper: $SCRAPER_ID"

  for i in $(seq 1 40); do
    if ! aws amp describe-scraper --scraper-id "$SCRAPER_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
      break
    fi
    echo "    Waiting for scraper deletion... ($i/40)"
    sleep 15
  done
  log "  ✓ Scraper deleted"
else
  SCRAPER_ROLE_ARN=""
  log "  No scraper found"
fi

# --- Delete RBAC resources and eksctl identity mapping ---
if command -v kubectl >/dev/null 2>&1; then
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  kubectl delete clusterrolebinding amp-iamproxy-ingest-role-binding 2>/dev/null || true
  kubectl delete clusterrole amp-iamproxy-ingest-role 2>/dev/null || true
  log "  ✓ Cleaned up RBAC resources"
fi

# Remove eksctl IAM identity mapping for scraper
if command -v eksctl >/dev/null 2>&1; then
  if [[ -n "$SCRAPER_ROLE_ARN" && "$SCRAPER_ROLE_ARN" != "None" ]]; then
    eksctl delete iamidentitymapping \
      --cluster "$CLUSTER_NAME" \
      --region "$AWS_REGION" \
      --arn "$SCRAPER_ROLE_ARN" 2>/dev/null || true
    log "  ✓ Removed eksctl IAM identity mapping"
  fi
fi

# --- Delete Keycloak realm and optionally Keycloak itself ---
log ""
log "=== Cleaning up Keycloak ==="

if command -v kubectl >/dev/null 2>&1; then
  KC_POD_PHASE=$(kubectl get pod keycloak-0 -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)

  if [[ "$KC_POD_PHASE" == "Running" ]]; then
    # Delete the realm created by setup script
    KC_ADMIN_PASSWORD=$(kubectl -n "$KEYCLOAK_NAMESPACE" get secret keycloak \
      -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || true)

    if [[ -n "$KC_ADMIN_PASSWORD" ]]; then
      kubectl exec -n "$KEYCLOAK_NAMESPACE" keycloak-0 -- env \
        KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
        KC_REALM="$KEYCLOAK_REALM" \
        bash -c '
KCADM="/opt/bitnami/keycloak/bin/kcadm.sh"
$KCADM config credentials --server http://localhost:8080 --realm master \
  --user user --password "$KC_ADMIN_PASSWORD" --config /tmp/kcadm.config >/dev/null 2>&1
$KCADM delete "realms/$KC_REALM" --config /tmp/kcadm.config >/dev/null 2>&1 || true
echo "Realm $KC_REALM deleted"
' 2>/dev/null || true
      log "  ✓ Deleted Keycloak realm: $KEYCLOAK_REALM"
    fi
  fi

  if [[ "$SKIP_KEYCLOAK" == "NO" ]]; then
    # Uninstall Keycloak Helm release
    if command -v helm >/dev/null 2>&1; then
      if helm status keycloak -n "$KEYCLOAK_NAMESPACE" >/dev/null 2>&1; then
        helm uninstall keycloak -n "$KEYCLOAK_NAMESPACE" 2>/dev/null || true
        log "  ✓ Uninstalled Keycloak Helm release"
      fi
    fi

    # Delete PVCs in keycloak namespace
    kubectl delete pvc --all -n "$KEYCLOAK_NAMESPACE" --wait=false 2>/dev/null || true

    # Delete namespace
    kubectl delete ns "$KEYCLOAK_NAMESPACE" --wait=false 2>/dev/null || true
    log "  ✓ Deleted namespace: $KEYCLOAK_NAMESPACE"

    # Delete StorageClass
    kubectl delete storageclass ebs-sc 2>/dev/null || true
    log "  ✓ Deleted StorageClass: ebs-sc"
  else
    log "  Skipping Keycloak Helm/namespace cleanup (--skip-keycloak)"
  fi
else
  log "  kubectl not found, skipping Keycloak cleanup"
fi

# --- Delete AMG workspace ---
log ""
log "=== Deleting AMG workspace ==="
AMG_WORKSPACE_ID=$(aws grafana list-workspaces \
  --region "$AWS_REGION" \
  --query "workspaces[?name==\`${AMG_WORKSPACE_NAME}\`].id | [0]" \
  --output text 2>/dev/null)

if [[ -n "$AMG_WORKSPACE_ID" && "$AMG_WORKSPACE_ID" != "None" ]]; then
  aws grafana delete-workspace --workspace-id "$AMG_WORKSPACE_ID" --region "$AWS_REGION" 2>/dev/null || true
  log "  Deleting AMG workspace: $AMG_WORKSPACE_ID"

  for i in $(seq 1 30); do
    if ! aws grafana describe-workspace --workspace-id "$AMG_WORKSPACE_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
      break
    fi
    echo "    Waiting for workspace deletion... ($i/30)"
    sleep 10
  done
  log "  ✓ AMG workspace deleted"
else
  log "  No AMG workspace found"
fi

# --- Delete AMG IAM role ---
AMG_ROLE_NAME="${AMG_WORKSPACE_NAME}-amg-role"
if aws iam get-role --role-name "$AMG_ROLE_NAME" >/dev/null 2>&1; then
  for POLICY in $(aws iam list-role-policies --role-name "$AMG_ROLE_NAME" --query 'PolicyNames' --output text 2>/dev/null); do
    aws iam delete-role-policy --role-name "$AMG_ROLE_NAME" --policy-name "$POLICY"
  done
  for POLICY_ARN in $(aws iam list-attached-role-policies --role-name "$AMG_ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
    aws iam detach-role-policy --role-name "$AMG_ROLE_NAME" --policy-arn "$POLICY_ARN"
  done
  aws iam delete-role --role-name "$AMG_ROLE_NAME"
  log "  ✓ Deleted IAM role: $AMG_ROLE_NAME"
else
  log "  IAM role not found: $AMG_ROLE_NAME"
fi

# --- Delete CloudFront distribution ---
log ""
log "=== Deleting CloudFront distribution ==="
# Find CloudFront distribution fronting Keycloak
if command -v kubectl >/dev/null 2>&1; then
  KC_HOSTNAME=$(kubectl get service keycloak -n "$KEYCLOAK_NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  if [[ -n "$KC_HOSTNAME" ]]; then
    CF_INFO=$(aws cloudfront list-distributions --query \
      "DistributionList.Items[?Origins.Items[0].DomainName==\`$KC_HOSTNAME\`].Id" \
      --output text 2>/dev/null || true)
    if [[ -n "$CF_INFO" && "$CF_INFO" != "None" ]]; then
      for CF_ID in $CF_INFO; do
        # Disable first, then delete
        ETAG=$(aws cloudfront get-distribution-config --id "$CF_ID" --query 'ETag' --output text 2>/dev/null || true)
        CF_CFG=$(aws cloudfront get-distribution-config --id "$CF_ID" --query 'DistributionConfig' --output json 2>/dev/null || true)
        if [[ -n "$CF_CFG" ]]; then
          DISABLED_CFG=$(echo "$CF_CFG" | jq '.Enabled = false')
          aws cloudfront update-distribution --id "$CF_ID" --if-match "$ETAG" \
            --distribution-config "$DISABLED_CFG" >/dev/null 2>&1 || true
          log "  Disabled CloudFront distribution: $CF_ID (delete manually after it finishes deploying)"
        fi
      done
    else
      log "  No CloudFront distribution found"
    fi
  fi
fi

# --- Delete Secrets Manager secret ---
if [[ "$SKIP_SECRETS" == "NO" ]]; then
  log ""
  log "=== Deleting Secrets Manager secret ==="
  SECRET_NAME="amp-amg-setup-credentials"
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    aws secretsmanager delete-secret --secret-id "$SECRET_NAME" \
      --force-delete-without-recovery --region "$AWS_REGION" >/dev/null 2>&1 || true
    log "  Deleted secret: $SECRET_NAME"
  else
    log "  Secret not found: $SECRET_NAME"
  fi
fi

# --- Delete AMP workspace ---
log ""
log "=== Deleting AMP workspace ==="
AMP_WORKSPACE_ID=$(aws amp list-workspaces \
  --region "$AWS_REGION" \
  --query "workspaces[?alias==\`${AMP_ALIAS}\`].workspaceId | [0]" \
  --output text 2>/dev/null)

if [[ -n "$AMP_WORKSPACE_ID" && "$AMP_WORKSPACE_ID" != "None" ]]; then
  aws amp delete-workspace --workspace-id "$AMP_WORKSPACE_ID" --region "$AWS_REGION" 2>/dev/null || true
  log "  Deleting AMP workspace: $AMP_WORKSPACE_ID"

  for i in $(seq 1 30); do
    if ! aws amp describe-workspace --workspace-id "$AMP_WORKSPACE_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
      break
    fi
    echo "    Waiting for workspace deletion... ($i/30)"
    sleep 10
  done
  log "  ✓ AMP workspace deleted"
else
  log "  No AMP workspace found"
fi

echo ""
echo "============================================================"
echo "  CLEANUP COMPLETE"
echo "============================================================"
