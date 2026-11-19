#!/usr/bin/env bash
set -Eeuo pipefail

# =============================================================================
# Setup Amazon Managed Prometheus + Amazon Managed Grafana
#
# Creates:
#   1. AMP workspace (demo-amp) with managed scraper (demo-amp-scraper)
#      pointed at existing EKS cluster (devops-agent-eks)
#   2. AMG workspace (demo-amg) with SAML auth via existing Keycloak
#   3. AMP as a datasource in AMG
#   4. Grafana public dashboard 3119 (Kubernetes cluster monitoring via Prometheus)
#
# Prerequisites:
#   - EKS cluster "devops-agent-eks" running with EBS CSI driver addon
#   - AWS CLI, jq, kubectl, curl, openssl, helm
#   - eksctl (for scraper IAM identity mapping; optional but recommended)
#
# Usage:
#   ./setup-amp-amg.sh [OPTIONS]
#
# Example:
#   ./setup-amp-amg.sh --region us-east-1
#   ./setup-amp-amg.sh --region us-east-1 --cluster devops-agent-eks
# =============================================================================

# Defaults
AWS_REGION=""
CLUSTER_NAME="devops-agent-eks"
AMP_ALIAS="demo-amp"
SCRAPER_ALIAS="demo-amp-scraper"
AMG_WORKSPACE_NAME="demo-amg"
KEYCLOAK_NAMESPACE="keycloak"
KEYCLOAK_REALM="amg"
DASHBOARD_ID="3119"
SHOW_HELP="NO"

log() { echo "$*"; }
die() { echo ""; echo "ERROR: $*"; exit 1; }

usage() {
  cat <<EOF

Usage: ./setup-amp-amg.sh [OPTIONS]

Required:
  --region <region>              AWS region (e.g. us-east-1)

Optional:
  --cluster <name>               EKS cluster name (default: devops-agent-eks)
  --amp-alias <name>             AMP workspace alias (default: demo-amp)
  --amg-name <name>              AMG workspace name (default: demo-amg)
  --keycloak-namespace <ns>      Keycloak namespace (default: keycloak)
  --keycloak-realm <realm>       Keycloak realm (default: amg)
  -h, --help                     Show this help

EOF
}

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)              AWS_REGION="$2";          shift 2 ;;
    --cluster)             CLUSTER_NAME="$2";        shift 2 ;;
    --amp-alias)           AMP_ALIAS="$2";           shift 2 ;;
    --amg-name)            AMG_WORKSPACE_NAME="$2";  shift 2 ;;
    --keycloak-namespace)  KEYCLOAK_NAMESPACE="$2";  shift 2 ;;
    --keycloak-realm)      KEYCLOAK_REALM="$2";      shift 2 ;;
    -h|--help)             SHOW_HELP="YES";          shift   ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [[ "$SHOW_HELP" == "YES" ]]; then usage; exit 0; fi
[[ -n "$AWS_REGION" ]] || die "--region is required"

for cmd in aws jq kubectl curl openssl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo ""
echo "Configuration:"
echo "  Region:          $AWS_REGION"
echo "  Account ID:      $ACCOUNT_ID"
echo "  EKS Cluster:     $CLUSTER_NAME"
echo "  AMP Alias:       $AMP_ALIAS"
echo "  AMG Workspace:   $AMG_WORKSPACE_NAME"
echo ""

# Update kubeconfig
aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null \
  || die "Failed to update kubeconfig for cluster $CLUSTER_NAME"

# =============================================================================
# Step 1: Create AMP workspace
# =============================================================================
log "=== Step 1: Creating AMP workspace ==="

# Check if workspace already exists
AMP_WORKSPACE_ID=$(aws amp list-workspaces \
  --region "$AWS_REGION" \
  --query "workspaces[?alias==\`${AMP_ALIAS}\`].workspaceId | [0]" \
  --output text 2>/dev/null)

if [[ -n "$AMP_WORKSPACE_ID" && "$AMP_WORKSPACE_ID" != "None" ]]; then
  log "  AMP workspace already exists: $AMP_WORKSPACE_ID"
else
  AMP_WORKSPACE_ID=$(aws amp create-workspace \
    --alias "$AMP_ALIAS" \
    --region "$AWS_REGION" \
    --query 'workspaceId' --output text)
  log "  Created AMP workspace: $AMP_WORKSPACE_ID"

  # Wait for ACTIVE
  log "  Waiting for workspace to become ACTIVE..."
  while true; do
    STATUS=$(aws amp describe-workspace \
      --workspace-id "$AMP_WORKSPACE_ID" \
      --region "$AWS_REGION" \
      --query 'workspace.status.statusCode' --output text)
    [[ "$STATUS" == "ACTIVE" ]] && break
    echo "    Status: $STATUS - waiting..."
    sleep 5
  done
fi

AMP_ENDPOINT=$(aws amp describe-workspace \
  --workspace-id "$AMP_WORKSPACE_ID" \
  --region "$AWS_REGION" \
  --query 'workspace.prometheusEndpoint' --output text)
AMP_ARN=$(aws amp describe-workspace \
  --workspace-id "$AMP_WORKSPACE_ID" \
  --region "$AWS_REGION" \
  --query 'workspace.arn' --output text)

log "  AMP Endpoint: $AMP_ENDPOINT"

# =============================================================================
# Step 2: Create managed scraper for EKS cluster
# =============================================================================
log ""
log "=== Step 2: Creating managed scraper ==="

# Check if scraper already exists
EXISTING_SCRAPER=$(aws amp list-scrapers \
  --region "$AWS_REGION" --output json 2>/dev/null | \
  jq -r ".scrapers[] | select(.alias==\"${SCRAPER_ALIAS}\") | .scraperId" | head -1 || true)

if [[ -n "$EXISTING_SCRAPER" && "$EXISTING_SCRAPER" != "null" ]]; then
  log "  Scraper already exists: $EXISTING_SCRAPER"
  SCRAPER_ID="$EXISTING_SCRAPER"
  SCRAPER_CREATED_NEW="NO"
else
  # Get EKS cluster ARN and subnets
  CLUSTER_INFO=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --output json)
  CLUSTER_ARN=$(echo "$CLUSTER_INFO" | jq -r '.cluster.arn')
  CLUSTER_SUBNETS=$(echo "$CLUSTER_INFO" | jq -r '.cluster.resourcesVpcConfig.subnetIds | join(",")')
  CLUSTER_SG=$(echo "$CLUSTER_INFO" | jq -r '.cluster.resourcesVpcConfig.clusterSecurityGroupId')

  # Build subnet array for CLI
  SUBNET_ARRAY=$(echo "$CLUSTER_INFO" | jq -c '.cluster.resourcesVpcConfig.subnetIds')

  # Default scrape config for Kubernetes cluster monitoring
  SCRAPE_CONFIG=$(cat <<'SCRAPEEOF'
global:
  scrape_interval: 30s
  scrape_timeout: 10s
scrape_configs:
  - job_name: kubernetes-apiservers
    scheme: https
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      insecure_skip_verify: true
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: default;kubernetes;https

  - job_name: kubernetes-nodes
    scheme: https
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      insecure_skip_verify: true
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - action: labelmap
        regex: __meta_kubernetes_node_label_(.+)

  - job_name: kubernetes-nodes-cadvisor
    scheme: https
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      insecure_skip_verify: true
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - action: labelmap
        regex: __meta_kubernetes_node_label_(.+)
      - target_label: __metrics_path__
        replacement: /metrics/cadvisor

  - job_name: kubernetes-service-endpoints
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_service_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_service_label_(.+)
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: namespace
      - source_labels: [__meta_kubernetes_service_name]
        action: replace
        target_label: service

  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_pod_label_(.+)
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        action: replace
        target_label: pod
SCRAPEEOF
)

  SCRAPE_CONFIG_B64=$(echo "$SCRAPE_CONFIG" | base64 -w 0)

  # Create the managed scraper
  SCRAPER_RESULT=$(aws amp create-scraper \
    --alias "$SCRAPER_ALIAS" \
    --source "{\"eksConfiguration\":{\"clusterArn\":\"${CLUSTER_ARN}\",\"subnetIds\":${SUBNET_ARRAY},\"securityGroupIds\":[\"${CLUSTER_SG}\"]}}" \
    --destination "{\"ampConfiguration\":{\"workspaceArn\":\"${AMP_ARN}\"}}" \
    --scrape-configuration "{\"configurationBlob\":\"${SCRAPE_CONFIG_B64}\"}" \
    --region "$AWS_REGION" \
    --output json)

  SCRAPER_ID=$(echo "$SCRAPER_RESULT" | jq -r '.scraperId')
  log "  Created scraper: $SCRAPER_ID"

  # Configure EKS cluster to allow the scraper
  log "  Configuring EKS aws-auth for scraper role..."
  SCRAPER_ROLE_ARN=$(echo "$SCRAPER_RESULT" | jq -r '.roleArn')

  # Create ClusterRole and ClusterRoleBinding for the scraper
  cat <<RBACEOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: amp-iamproxy-ingest-role
rules:
  - apiGroups: [""]
    resources: ["nodes", "nodes/proxy", "nodes/metrics", "services", "endpoints", "pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["extensions", "networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["/metrics", "/metrics/cadvisor"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: amp-iamproxy-ingest-role-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: amp-iamproxy-ingest-role
subjects:
  - kind: User
    name: "aps-collector-user"
    apiGroup: rbac.authorization.k8s.io
RBACEOF

  # Add scraper role to aws-auth configmap via eksctl
  if command -v eksctl >/dev/null 2>&1; then
    eksctl create iamidentitymapping \
      --cluster "$CLUSTER_NAME" \
      --region "$AWS_REGION" \
      --arn "$SCRAPER_ROLE_ARN" \
      --username "aps-collector-user" 2>/dev/null || log "  Identity mapping may already exist"
  else
    log "  WARNING: eksctl not found. Manually add scraper role to aws-auth:"
    log "    Role ARN: $SCRAPER_ROLE_ARN"
    log "    Username: aps-collector-user"
  fi

  log "  Scraper creation initiated (runs in background while we set up Keycloak + AMG)..."
fi

SCRAPER_CREATED_NEW="YES"

# =============================================================================
# Step 3: Deploy Keycloak on EKS for SAML authentication
# =============================================================================
log ""
log "=== Step 3: Deploying Keycloak for SAML authentication ==="

KEYCLOAK_RELEASE="keycloak"
KEYCLOAK_CHART="bitnami/keycloak"
KEYCLOAK_CHART_VERSION="24.2.3"
KEYCLOAK_ADMIN_USER="user"
EBS_STORAGE_CLASS="ebs-sc"

# Check if Keycloak is already running
KC_POD_PHASE=$(kubectl get pod "${KEYCLOAK_RELEASE}-0" -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)

if [[ "$KC_POD_PHASE" == "Running" ]]; then
  log "  Keycloak is already running in namespace $KEYCLOAK_NAMESPACE"
else
  # Install helm if missing
  if ! command -v helm >/dev/null 2>&1; then
    log "  Installing helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  fi

  # Add bitnami repo
  if ! helm repo list -o json 2>/dev/null | jq -e '.[] | select(.name == "bitnami")' >/dev/null 2>&1; then
    helm repo add bitnami https://charts.bitnami.com/bitnami >/dev/null
  fi
  helm repo update >/dev/null

  # Ensure namespace
  kubectl get ns "$KEYCLOAK_NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$KEYCLOAK_NAMESPACE" >/dev/null

  # Detect EBS CSI provisioner — install addon automatically if missing
  EBS_PROVISIONER=""
  if kubectl get csidrivers ebs.csi.eks.amazonaws.com >/dev/null 2>&1; then
    EBS_PROVISIONER="ebs.csi.eks.amazonaws.com"
  elif kubectl get csidrivers ebs.csi.aws.com >/dev/null 2>&1; then
    EBS_PROVISIONER="ebs.csi.aws.com"
  else
    log "  No EBS CSI driver found — installing aws-ebs-csi-driver addon..."

    # Create IAM role for the EBS CSI driver via eksctl (if available)
    EBS_CSI_ROLE_NAME="AmazonEKS_EBS_CSI_DriverRole_${CLUSTER_NAME}"
    EBS_CSI_ROLE_ARN=""

    if command -v eksctl >/dev/null 2>&1; then
      OIDC_ID=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" \
        --query 'cluster.identity.oidc.issuer' --output text 2>/dev/null | sed 's|https://||')

      # Ensure OIDC provider exists
      if ! aws iam list-open-id-connect-providers --output text 2>/dev/null | grep -q "${OIDC_ID##*/}"; then
        eksctl utils associate-iam-oidc-provider \
          --cluster "$CLUSTER_NAME" \
          --region "$AWS_REGION" \
          --approve 2>/dev/null || true
      fi

      eksctl create iamserviceaccount \
        --name ebs-csi-controller-sa \
        --namespace kube-system \
        --cluster "$CLUSTER_NAME" \
        --region "$AWS_REGION" \
        --role-name "$EBS_CSI_ROLE_NAME" \
        --role-only \
        --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
        --approve 2>/dev/null || true

      EBS_CSI_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EBS_CSI_ROLE_NAME}"
    else
      # Without eksctl, create the role directly
      OIDC_ISSUER=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" \
        --query 'cluster.identity.oidc.issuer' --output text 2>/dev/null)
      OIDC_ID=$(echo "$OIDC_ISSUER" | sed 's|https://||')

      EBS_CSI_TRUST_POLICY=$(cat <<EBSTRUSTEOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_ID}"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "${OIDC_ID}:aud": "sts.amazonaws.com",
        "${OIDC_ID}:sub": "system:serviceaccount:kube-system:ebs-csi-controller-sa"
      }
    }
  }]
}
EBSTRUSTEOF
)

      if ! aws iam get-role --role-name "$EBS_CSI_ROLE_NAME" >/dev/null 2>&1; then
        aws iam create-role \
          --role-name "$EBS_CSI_ROLE_NAME" \
          --assume-role-policy-document "$EBS_CSI_TRUST_POLICY" >/dev/null
        aws iam attach-role-policy \
          --role-name "$EBS_CSI_ROLE_NAME" \
          --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy
      fi
      EBS_CSI_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EBS_CSI_ROLE_NAME}"
    fi

    # Install the EKS addon
    ADDON_ARGS=(
      --cluster-name "$CLUSTER_NAME"
      --addon-name aws-ebs-csi-driver
      --region "$AWS_REGION"
    )
    if [[ -n "$EBS_CSI_ROLE_ARN" ]]; then
      ADDON_ARGS+=(--service-account-role-arn "$EBS_CSI_ROLE_ARN")
    fi

    if aws eks describe-addon --cluster-name "$CLUSTER_NAME" --addon-name aws-ebs-csi-driver \
        --region "$AWS_REGION" >/dev/null 2>&1; then
      log "  EBS CSI addon already registered (may have been inactive)"
    else
      aws eks create-addon "${ADDON_ARGS[@]}" --resolve-conflicts OVERWRITE >/dev/null \
        || die "Failed to install aws-ebs-csi-driver addon"
    fi

    # Wait for the addon to become ACTIVE
    log "  Waiting for aws-ebs-csi-driver addon to become ACTIVE..."
    for i in $(seq 1 60); do
      ADDON_STATUS=$(aws eks describe-addon \
        --cluster-name "$CLUSTER_NAME" \
        --addon-name aws-ebs-csi-driver \
        --region "$AWS_REGION" \
        --query 'addon.status' --output text 2>/dev/null || true)
      [[ "$ADDON_STATUS" == "ACTIVE" ]] && break
      [[ "$ADDON_STATUS" == "CREATE_FAILED" ]] && die "EBS CSI driver addon creation failed"
      echo "    Addon status: ${ADDON_STATUS:-UNKNOWN} ($i/60)"
      sleep 10
    done
    [[ "$ADDON_STATUS" == "ACTIVE" ]] || die "EBS CSI driver addon did not become ACTIVE in time"
    log "  ✓ aws-ebs-csi-driver addon is ACTIVE"

    # Re-detect the provisioner
    if kubectl get csidrivers ebs.csi.eks.amazonaws.com >/dev/null 2>&1; then
      EBS_PROVISIONER="ebs.csi.eks.amazonaws.com"
    elif kubectl get csidrivers ebs.csi.aws.com >/dev/null 2>&1; then
      EBS_PROVISIONER="ebs.csi.aws.com"
    else
      die "EBS CSI driver addon installed but CSI driver not registered in cluster"
    fi
  fi
  log "  EBS CSI provisioner: $EBS_PROVISIONER"

  # Create or fix StorageClass
  if kubectl get storageclass "$EBS_STORAGE_CLASS" >/dev/null 2>&1; then
    CURRENT_PROV=$(kubectl get storageclass "$EBS_STORAGE_CLASS" -o jsonpath='{.provisioner}')
    if [[ "$CURRENT_PROV" != "$EBS_PROVISIONER" ]]; then
      log "  Recreating StorageClass with correct provisioner..."
      # Clean up stuck PVCs
      kubectl get pvc -A -o json 2>/dev/null | jq -r \
        ".items[] | select(.spec.storageClassName==\"$EBS_STORAGE_CLASS\" and .status.phase==\"Pending\") | .metadata.namespace + \"/\" + .metadata.name" | \
        while read -r pvc; do
          [[ -z "$pvc" ]] && continue
          kubectl delete pvc "${pvc##*/}" -n "${pvc%%/*}" --wait=false 2>/dev/null || true
        done
      kubectl delete storageclass "$EBS_STORAGE_CLASS" 2>/dev/null || true
      cat <<SCEOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${EBS_STORAGE_CLASS}
provisioner: ${EBS_PROVISIONER}
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
SCEOF
    fi
  else
    cat <<SCEOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${EBS_STORAGE_CLASS}
provisioner: ${EBS_PROVISIONER}
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
SCEOF
  fi

  # Install Keycloak via Helm
  log "  Installing Keycloak via Helm..."
  HELM_VALUES=$(mktemp)
  cat > "$HELM_VALUES" <<HVEOF
global:
  storageClass: "${EBS_STORAGE_CLASS}"
image:
  registry: public.ecr.aws
  repository: bitnami/keycloak
  tag: 22.0.1-debian-11-r36
  debug: true
auth:
  adminUser: ${KEYCLOAK_ADMIN_USER}
service:
  type: LoadBalancer
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
  http:
    enabled: true
  ports:
    http: 80
postgresql:
  enabled: true
  image:
    registry: docker.io
    repository: postgres
    tag: "16"
  auth:
    database: keycloak
    username: keycloak
    password: keycloak
  primary:
    containerSecurityContext:
      readOnlyRootFilesystem: false
resourcesPreset: none
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
    ephemeral-storage: "50Mi"
  limits:
    cpu: "750m"
    memory: "768Mi"
    ephemeral-storage: "2Gi"
HVEOF

  helm upgrade --install "$KEYCLOAK_RELEASE" "$KEYCLOAK_CHART" \
    --version "$KEYCLOAK_CHART_VERSION" \
    --namespace "$KEYCLOAK_NAMESPACE" \
    -f "$HELM_VALUES" >/dev/null
  rm -f "$HELM_VALUES"

  # Wait for Keycloak pod
  log "  Waiting for Keycloak pod to be Running..."
  for i in $(seq 1 90); do
    KC_POD_PHASE=$(kubectl get pod "${KEYCLOAK_RELEASE}-0" -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)
    [[ "$KC_POD_PHASE" == "Running" ]] && break
    echo "    Pod status: ${KC_POD_PHASE:-Pending} ($i/90)"
    sleep 10
  done
  [[ "$KC_POD_PHASE" == "Running" ]] || die "Keycloak pod did not reach Running state"
fi

log "  Keycloak is Running"

# Get Keycloak admin password
KC_ADMIN_PASSWORD=$(kubectl -n "$KEYCLOAK_NAMESPACE" get secret "$KEYCLOAK_RELEASE" \
  -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || true)
if [[ -z "$KC_ADMIN_PASSWORD" ]]; then
  KC_ADMIN_PASSWORD=$(kubectl -n "$KEYCLOAK_NAMESPACE" get secrets -o json | \
    jq -r '.items[] | select(.data["admin-password"] != null) | .data["admin-password"]' | \
    head -1 | base64 -d 2>/dev/null || true)
fi
[[ -n "$KC_ADMIN_PASSWORD" ]] || die "Could not retrieve Keycloak admin password"

# Wait for Keycloak LB
log "  Waiting for Keycloak load balancer..."
KC_HOSTNAME=""
while [[ -z "$KC_HOSTNAME" ]]; do
  KC_HOSTNAME=$(kubectl get service "$KEYCLOAK_RELEASE" -n "$KEYCLOAK_NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  [[ -z "$KC_HOSTNAME" ]] && sleep 10
done
log "  Keycloak LB: $KC_HOSTNAME"

# Wait for LB target to be healthy
log "  Waiting for load balancer target health..."
LB_ARN=$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query "LoadBalancers[?DNSName==\`$KC_HOSTNAME\`].LoadBalancerArn | [0]" --output text 2>/dev/null || true)
if [[ -n "$LB_ARN" && "$LB_ARN" != "None" ]]; then
  TG_ARN=$(aws elbv2 describe-target-groups --region "$AWS_REGION" \
    --load-balancer-arn "$LB_ARN" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
  if [[ -n "$TG_ARN" && "$TG_ARN" != "None" ]]; then
    while true; do
      TG_STATE=$(aws elbv2 describe-target-health --region "$AWS_REGION" \
        --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text 2>/dev/null || true)
      [[ "$TG_STATE" == "healthy" ]] && break
      echo "    Target health: $TG_STATE - waiting..."
      sleep 10
    done
  fi
fi
log "  Keycloak load balancer is healthy"

# Create CloudFront distribution for HTTPS access to Keycloak
log "  Creating CloudFront distribution for Keycloak HTTPS..."
EXISTING_CF=$(aws cloudfront list-distributions --query \
  "DistributionList.Items[?Origins.Items[0].DomainName==\`$KC_HOSTNAME\`].{Id:Id,Domain:DomainName}" \
  --output json 2>/dev/null | jq -r '.[0] // empty')

if [[ -n "$EXISTING_CF" && "$EXISTING_CF" != "null" ]]; then
  CF_DOMAIN=$(echo "$EXISTING_CF" | jq -r '.Domain')
  CF_ID=$(echo "$EXISTING_CF" | jq -r '.Id')
  log "  CloudFront distribution exists: $CF_DOMAIN ($CF_ID)"
else
  CF_CONFIG=$(cat <<CFEOF
{
  "CallerReference": "keycloak-$(date +%s)",
  "Comment": "HTTPS front for Keycloak SAML IdP",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "keycloak-elb",
      "DomainName": "${KC_HOSTNAME}",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "keycloak-elb",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {"Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}},
    "ForwardedValues": {
      "QueryString": true,
      "Cookies": {"Forward": "all"},
      "Headers": {"Quantity": 4, "Items": ["Host","Origin","Accept","Content-Type"]}
    },
    "MinTTL": 0, "DefaultTTL": 0, "MaxTTL": 0
  },
  "ViewerCertificate": {"CloudFrontDefaultCertificate": true},
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2",
  "IsIPV6Enabled": true,
  "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}}
}
CFEOF
)
  CF_RESULT=$(aws cloudfront create-distribution \
    --distribution-config "$CF_CONFIG" --output json)
  CF_DOMAIN=$(echo "$CF_RESULT" | jq -r '.Distribution.DomainName')
  CF_ID=$(echo "$CF_RESULT" | jq -r '.Distribution.Id')
  log "  Created CloudFront distribution: $CF_DOMAIN ($CF_ID)"

  # Wait for CloudFront to deploy
  log "  Waiting for CloudFront distribution to deploy..."
  for i in $(seq 1 60); do
    CF_STATUS=$(aws cloudfront get-distribution --id "$CF_ID" \
      --query 'Distribution.Status' --output text 2>/dev/null || true)
    [[ "$CF_STATUS" == "Deployed" ]] && break
    echo "    CloudFront status: $CF_STATUS ($i/60)"
    sleep 15
  done
  log "  CloudFront distribution deployed"
fi

SAML_URL="https://${CF_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/saml/descriptor"

# =============================================================================
# Step 4: Create AMG workspace
# =============================================================================
log ""
log "=== Step 4: Creating AMG workspace ==="

AMG_WORKSPACE_ID=$(aws grafana list-workspaces \
  --region "$AWS_REGION" \
  --query "workspaces[?name==\`${AMG_WORKSPACE_NAME}\`].id | [0]" \
  --output text 2>/dev/null)

if [[ -n "$AMG_WORKSPACE_ID" && "$AMG_WORKSPACE_ID" != "None" ]]; then
  log "  AMG workspace already exists: $AMG_WORKSPACE_ID"
else
  # Create IAM role for AMG
  AMG_ROLE_NAME="${AMG_WORKSPACE_NAME}-amg-role"
  AMG_TRUST_POLICY=$(cat <<TRUSTEOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "grafana.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "${ACCOUNT_ID}"
        }
      }
    }
  ]
}
TRUSTEOF
)

  if ! aws iam get-role --role-name "$AMG_ROLE_NAME" >/dev/null 2>&1; then
    AMG_ROLE_ARN=$(aws iam create-role \
      --role-name "$AMG_ROLE_NAME" \
      --assume-role-policy-document "$AMG_TRUST_POLICY" \
      --query 'Role.Arn' --output text)
    log "  Created AMG role: $AMG_ROLE_ARN"
  else
    AMG_ROLE_ARN=$(aws iam get-role --role-name "$AMG_ROLE_NAME" --query 'Role.Arn' --output text)
    log "  AMG role exists: $AMG_ROLE_ARN"
  fi

  # Attach AMP read policy
  AMG_POLICY_DOC=$(cat <<POLICYEOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AMPReadAccess",
      "Effect": "Allow",
      "Action": [
        "aps:QueryMetrics",
        "aps:GetMetricMetadata",
        "aps:GetSeries",
        "aps:GetLabels",
        "aps:ListWorkspaces",
        "aps:DescribeWorkspace"
      ],
      "Resource": "*"
    }
  ]
}
POLICYEOF
)

  aws iam put-role-policy \
    --role-name "$AMG_ROLE_NAME" \
    --policy-name "${AMG_WORKSPACE_NAME}-amp-read" \
    --policy-document "$AMG_POLICY_DOC"
  log "  Attached AMP read policy"
  sleep 10

  # Create AMG workspace with SAML auth
  AMG_RESULT=$(aws grafana create-workspace \
    --workspace-name "$AMG_WORKSPACE_NAME" \
    --account-access-type "CURRENT_ACCOUNT" \
    --authentication-providers "SAML" \
    --permission-type "SERVICE_MANAGED" \
    --workspace-role-arn "$AMG_ROLE_ARN" \
    --workspace-data-sources "PROMETHEUS" \
    --region "$AWS_REGION" \
    --output json)

  AMG_WORKSPACE_ID=$(echo "$AMG_RESULT" | jq -r '.workspace.id')
  log "  Created AMG workspace: $AMG_WORKSPACE_ID"
fi

# Wait for ACTIVE
log "  Waiting for AMG workspace to become ACTIVE..."
while true; do
  AMG_STATUS=$(aws grafana describe-workspace \
    --workspace-id "$AMG_WORKSPACE_ID" \
    --region "$AWS_REGION" \
    --query 'workspace.status' --output text)
  [[ "$AMG_STATUS" == "ACTIVE" ]] && break
  echo "    Status: $AMG_STATUS - waiting..."
  sleep 10
done

AMG_ENDPOINT=$(aws grafana describe-workspace \
  --workspace-id "$AMG_WORKSPACE_ID" \
  --region "$AWS_REGION" \
  --query 'workspace.endpoint' --output text)
log "  AMG Endpoint: https://${AMG_ENDPOINT}"

# =============================================================================
# Step 5: Configure Keycloak realm and SAML authentication
# =============================================================================
log ""
log "=== Step 5: Configuring Keycloak SAML for AMG workspace ==="

log "  SAML URL: $SAML_URL"

# Generate realm user passwords
KC_USER_ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"
KC_USER_EDITOR_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"

KC_CLIENT_ID="https://${AMG_ENDPOINT}/saml/metadata"

# Configure Keycloak realm, users, and SAML client inside the pod
kubectl exec -n "$KEYCLOAK_NAMESPACE" keycloak-0 -- env \
  KC_MASTER_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  KC_MASTER_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
  KC_REALM="$KEYCLOAK_REALM" \
  WORKSPACE_ENDPOINT="$AMG_ENDPOINT" \
  KC_REALM_ADMIN_PASSWORD="$KC_USER_ADMIN_PASSWORD" \
  KC_REALM_EDITOR_PASSWORD="$KC_USER_EDITOR_PASSWORD" \
  bash -c '
KCADM="/opt/bitnami/keycloak/bin/kcadm.sh"

# Wait for Keycloak HTTP
while true; do
  curl -fsS http://localhost:8080/ >/dev/null 2>&1 && break
  echo "Waiting for Keycloak admin server..."
  sleep 10
done

$KCADM config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_MASTER_ADMIN_USER" \
  --password "$KC_MASTER_ADMIN_PASSWORD" \
  --config /tmp/kcadm.config >/dev/null

$KCADM update realms/master -s sslRequired=NONE --config /tmp/kcadm.config >/dev/null || true

CLIENT_ID="https://${WORKSPACE_ENDPOINT}/saml/metadata"

# Create realm if it does not exist
if ! $KCADM get "realms/$KC_REALM" --config /tmp/kcadm.config >/dev/null 2>&1; then
  cat > /tmp/realm.json <<JSON
{
  "realm": "$KC_REALM",
  "enabled": true,
  "sslRequired": "none",
  "roles": { "realm": [{"name":"admin"},{"name":"editor"}] },
  "users": [
    {"username":"admin","email":"admin@keycloak","enabled":true,"firstName":"Admin","realmRoles":["admin"]},
    {"username":"editor","email":"editor@keycloak","enabled":true,"firstName":"Editor","realmRoles":["editor"]}
  ],
  "clients": [{
    "clientId": "${CLIENT_ID}",
    "name": "amazon-managed-grafana",
    "enabled": true,
    "protocol": "saml",
    "adminUrl": "https://${WORKSPACE_ENDPOINT}/login/saml",
    "redirectUris": ["https://${WORKSPACE_ENDPOINT}/saml/acs"],
    "attributes": {
      "saml.authnstatement":"true","saml.server.signature":"true",
      "saml_name_id_format":"email","saml_force_name_id_format":"true",
      "saml.assertion.signature":"true","saml.client.signature":"false"
    },
    "defaultClientScopes": [],
    "protocolMappers": [
      {"name":"name","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"firstName","attribute.name":"displayName"}},
      {"name":"email","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"email","attribute.name":"mail"}},
      {"name":"role list","protocol":"saml","protocolMapper":"saml-role-list-mapper","config":{"single":"true","attribute.nameformat":"Unspecified","attribute.name":"role"}}
    ]
  }]
}
JSON
  $KCADM create realms -f /tmp/realm.json --config /tmp/kcadm.config >/dev/null
  echo "Realm created: $KC_REALM"
else
  echo "Realm already exists: $KC_REALM"
  # Ensure SAML client exists
  EXISTING=$($KCADM get clients -r "$KC_REALM" -q clientId="$CLIENT_ID" --config /tmp/kcadm.config 2>/dev/null | tr -d "\n" | grep -c "\"clientId\"" || true)
  if [[ "$EXISTING" -eq 0 ]]; then
    cat > /tmp/amg-client.json <<JSON
{
  "clientId": "${CLIENT_ID}","name":"amazon-managed-grafana","enabled":true,"protocol":"saml",
  "adminUrl":"https://${WORKSPACE_ENDPOINT}/login/saml","redirectUris":["https://${WORKSPACE_ENDPOINT}/saml/acs"],
  "attributes":{"saml.authnstatement":"true","saml.server.signature":"true","saml_name_id_format":"email","saml_force_name_id_format":"true","saml.assertion.signature":"true","saml.client.signature":"false"},
  "defaultClientScopes":[],
  "protocolMappers":[
    {"name":"name","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"firstName","attribute.name":"displayName"}},
    {"name":"email","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"email","attribute.name":"mail"}},
    {"name":"role list","protocol":"saml","protocolMapper":"saml-role-list-mapper","config":{"single":"true","attribute.nameformat":"Unspecified","attribute.name":"role"}}
  ]
}
JSON
    $KCADM create clients -r "$KC_REALM" -f /tmp/amg-client.json --config /tmp/kcadm.config >/dev/null || true
    echo "SAML client created"
  else
    echo "SAML client already exists"
  fi
fi

# Set user passwords
get_user_id() {
  $KCADM get users -r "$1" -q username="$2" --fields id,username --config /tmp/kcadm.config 2>/dev/null \
    | tr -d "\n" | sed "s/},{/}\n{/g" \
    | grep "\"username\"[[:space:]]*:[[:space:]]*\"${2}\"" \
    | sed -n "s/.*\"id\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

ADMIN_ID="$(get_user_id "$KC_REALM" admin)"
EDITOR_ID="$(get_user_id "$KC_REALM" editor)"

if [[ -n "$ADMIN_ID" ]]; then
  $KCADM update "users/${ADMIN_ID}" -r "$KC_REALM" \
    -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_ADMIN_PASSWORD}\",\"temporary\":false}]" \
    --config /tmp/kcadm.config >/dev/null
fi
if [[ -n "$EDITOR_ID" ]]; then
  $KCADM update "users/${EDITOR_ID}" -r "$KC_REALM" \
    -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_EDITOR_PASSWORD}\",\"temporary\":false}]" \
    --config /tmp/kcadm.config >/dev/null
fi

echo "Keycloak realm configuration completed."
' || die "Failed to configure Keycloak realm and SAML client"

# Update AMG workspace SAML configuration
SAML_CONFIG=$(cat <<SAMLEOF
{
  "assertionAttributes": {
    "email": "mail",
    "login": "mail",
    "name": "displayName",
    "role": "role"
  },
  "idpMetadata": {
    "url": "${SAML_URL}"
  },
  "loginValidityDuration": 120,
  "roleValues": {
    "admin": ["admin"],
    "editor": ["editor"]
  }
}
SAMLEOF
)

AUTH_INPUT=$(jq -nc \
  --argjson saml "$SAML_CONFIG" \
  --arg wid "$AMG_WORKSPACE_ID" \
  '{authenticationProviders: ["SAML"], samlConfiguration: $saml, workspaceId: $wid}')

aws grafana update-workspace-authentication \
  --region "$AWS_REGION" \
  --cli-input-json "$AUTH_INPUT" > /dev/null \
  || die "Failed to update AMG SAML authentication"

log "  SAML authentication configured"

# =============================================================================
# Step 6: Create Grafana API key and add AMP datasource
# =============================================================================
log ""
log "=== Step 6: Adding AMP datasource to AMG ==="

# Create a Grafana API key via the AWS API
API_KEY_RESULT=$(aws grafana create-workspace-api-key \
  --workspace-id "$AMG_WORKSPACE_ID" \
  --key-name "setup-script-$(date +%s)" \
  --key-role "ADMIN" \
  --seconds-to-live 3600 \
  --region "$AWS_REGION" \
  --output json)

GRAFANA_API_KEY=$(echo "$API_KEY_RESULT" | jq -r '.key')
GRAFANA_URL="https://${AMG_ENDPOINT}"

# Add AMP as a datasource
DS_PAYLOAD=$(cat <<DSEOF
{
  "name": "${AMP_ALIAS}",
  "type": "prometheus",
  "access": "proxy",
  "url": "${AMP_ENDPOINT}",
  "isDefault": true,
  "jsonData": {
    "httpMethod": "POST",
    "sigV4Auth": true,
    "sigV4AuthType": "default",
    "sigV4Region": "${AWS_REGION}"
  }
}
DSEOF
)

DS_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GRAFANA_URL}/api/datasources" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$DS_PAYLOAD")

DS_HTTP_CODE=$(echo "$DS_RESPONSE" | tail -1)
DS_BODY=$(echo "$DS_RESPONSE" | sed '$d')

if [[ "$DS_HTTP_CODE" == "200" || "$DS_HTTP_CODE" == "409" ]]; then
  if [[ "$DS_HTTP_CODE" == "409" ]]; then
    log "  Datasource '${AMP_ALIAS}' already exists"
  else
    DS_UID=$(echo "$DS_BODY" | jq -r '.datasource.uid')
    log "  Datasource created: ${AMP_ALIAS} (uid: $DS_UID)"
  fi
else
  log "  WARNING: Datasource creation returned HTTP $DS_HTTP_CODE"
  log "  Response: $DS_BODY"
fi

# Get the datasource UID for the dashboard
DS_UID=$(curl -s "${GRAFANA_URL}/api/datasources/name/${AMP_ALIAS}" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" | jq -r '.uid // empty')

if [[ -z "$DS_UID" ]]; then
  # Fallback: get first prometheus datasource
  DS_UID=$(curl -s "${GRAFANA_URL}/api/datasources" \
    -H "Authorization: Bearer ${GRAFANA_API_KEY}" | \
    jq -r '.[0].uid // empty')
fi

log "  Datasource UID: $DS_UID"

# =============================================================================
# Step 7: Import Grafana dashboard 3119
# =============================================================================
log ""
log "=== Step 7: Importing Grafana dashboard ${DASHBOARD_ID} ==="

# Download the dashboard JSON from grafana.com
DASHBOARD_JSON=$(curl -s "https://grafana.com/api/dashboards/${DASHBOARD_ID}/revisions/latest/download")

if [[ -z "$DASHBOARD_JSON" || "$DASHBOARD_JSON" == "null" ]]; then
  die "Failed to download dashboard ${DASHBOARD_ID} from grafana.com"
fi

# Build the import payload
IMPORT_PAYLOAD=$(jq -n \
  --argjson dashboard "$DASHBOARD_JSON" \
  --arg ds_uid "$DS_UID" \
  --arg ds_name "$AMP_ALIAS" \
  '{
    dashboard: $dashboard,
    overwrite: true,
    inputs: [
      {
        name: "DS_PROMETHEUS",
        type: "datasource",
        pluginId: "prometheus",
        value: $ds_uid
      }
    ],
    folderId: 0
  }')

# Set the dashboard id to null for import
IMPORT_PAYLOAD=$(echo "$IMPORT_PAYLOAD" | jq '.dashboard.id = null')

IMPORT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GRAFANA_URL}/api/dashboards/import" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$IMPORT_PAYLOAD")

IMPORT_HTTP_CODE=$(echo "$IMPORT_RESPONSE" | tail -1)
IMPORT_BODY=$(echo "$IMPORT_RESPONSE" | sed '$d')

if [[ "$IMPORT_HTTP_CODE" == "200" ]]; then
  DASH_URL=$(echo "$IMPORT_BODY" | jq -r '.importedUrl // empty')
  log "  Dashboard imported: ${GRAFANA_URL}${DASH_URL}"
else
  log "  WARNING: Dashboard import returned HTTP $IMPORT_HTTP_CODE"
  log "  Response: $IMPORT_BODY"
  log "  You can manually import dashboard ${DASHBOARD_ID} from the Grafana UI"
fi

# =============================================================================
# Step 8: Wait for managed scraper to become ACTIVE
# =============================================================================
log ""
log "=== Step 8: Waiting for managed scraper ==="

if [[ "$SCRAPER_CREATED_NEW" == "YES" ]]; then
  SCRAPER_STATUS=$(aws amp describe-scraper \
    --scraper-id "$SCRAPER_ID" \
    --region "$AWS_REGION" \
    --query 'scraper.status.statusCode' --output text)

  if [[ "$SCRAPER_STATUS" != "ACTIVE" ]]; then
    log "  Scraper status: $SCRAPER_STATUS — waiting for ACTIVE..."
    while true; do
      SCRAPER_STATUS=$(aws amp describe-scraper \
        --scraper-id "$SCRAPER_ID" \
        --region "$AWS_REGION" \
        --query 'scraper.status.statusCode' --output text)
      [[ "$SCRAPER_STATUS" == "ACTIVE" ]] && break
      [[ "$SCRAPER_STATUS" == "CREATION_FAILED" ]] && die "Scraper creation failed"
      echo "    Status: $SCRAPER_STATUS - waiting..."
      sleep 15
    done
  fi
  log "  Scraper is ACTIVE"
else
  log "  Scraper was already active"
fi

# =============================================================================
# Output
# =============================================================================
echo ""
echo "============================================================"
echo "  SETUP COMPLETE"
echo "============================================================"
echo ""
echo "  AMP Workspace:"
echo "    ID:        $AMP_WORKSPACE_ID"
echo "    Alias:     $AMP_ALIAS"
echo "    Endpoint:  $AMP_ENDPOINT"
echo ""
echo "  Managed Scraper:"
echo "    ID:        $SCRAPER_ID"
echo "    Alias:     $SCRAPER_ALIAS"
echo "    Cluster:   $CLUSTER_NAME"
echo ""
echo "  AMG Workspace:"
echo "    ID:        $AMG_WORKSPACE_ID"
echo "    Name:      $AMG_WORKSPACE_NAME"
echo "    URL:       https://${AMG_ENDPOINT}"
echo "    SAML URL:  $SAML_URL"
echo ""
echo "  CloudFront:"
echo "    URL:       https://${CF_DOMAIN}"
echo "    Dist ID:   ${CF_ID}"
echo ""
echo "  Datasource:  $AMP_ALIAS (Prometheus/SigV4)"
echo "  Dashboard:   3119 - Kubernetes cluster monitoring (via Prometheus)"
echo ""
echo "  Login via Keycloak SAML:"
echo "    admin    password: ${KC_USER_ADMIN_PASSWORD}"
echo "    editor   password: ${KC_USER_EDITOR_PASSWORD}"
echo "    Keycloak admin:    ${KEYCLOAK_ADMIN_USER} / ${KC_ADMIN_PASSWORD}"
echo "    SAML URL: $SAML_URL"
echo "============================================================"

# =============================================================================
# Step 9: Upload credentials to Secrets Manager
# =============================================================================
log ""
log "=== Step 9: Uploading credentials to Secrets Manager ==="

SECRET_NAME="amp-amg-setup-credentials"
SECRET_VALUE=$(jq -nc \
  --arg amp_id "$AMP_WORKSPACE_ID" \
  --arg amp_alias "$AMP_ALIAS" \
  --arg amp_endpoint "$AMP_ENDPOINT" \
  --arg scraper_id "$SCRAPER_ID" \
  --arg amg_id "$AMG_WORKSPACE_ID" \
  --arg amg_url "https://${AMG_ENDPOINT}" \
  --arg saml_url "$SAML_URL" \
  --arg cf_url "https://${CF_DOMAIN}" \
  --arg cf_id "$CF_ID" \
  --arg kc_lb "$KC_HOSTNAME" \
  --arg kc_admin_user "$KEYCLOAK_ADMIN_USER" \
  --arg kc_admin_pw "$KC_ADMIN_PASSWORD" \
  --arg realm_admin_pw "$KC_USER_ADMIN_PASSWORD" \
  --arg realm_editor_pw "$KC_USER_EDITOR_PASSWORD" \
  '{
    amp_workspace_id: $amp_id,
    amp_alias: $amp_alias,
    amp_endpoint: $amp_endpoint,
    scraper_id: $scraper_id,
    amg_workspace_id: $amg_id,
    amg_url: $amg_url,
    saml_url: $saml_url,
    cloudfront_url: $cf_url,
    cloudfront_distribution_id: $cf_id,
    keycloak_lb: $kc_lb,
    keycloak_admin_user: $kc_admin_user,
    keycloak_admin_password: $kc_admin_pw,
    keycloak_realm_admin_password: $realm_admin_pw,
    keycloak_realm_editor_password: $realm_editor_pw
  }')

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$SECRET_VALUE" \
    --region "$AWS_REGION" >/dev/null
  log "  Credentials updated in Secrets Manager: $SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "AMP/AMG setup credentials and URLs" \
    --secret-string "$SECRET_VALUE" \
    --region "$AWS_REGION" >/dev/null
  log "  Credentials stored in Secrets Manager: $SECRET_NAME"
fi

log ""
log "  Retrieve later with: aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $AWS_REGION"
