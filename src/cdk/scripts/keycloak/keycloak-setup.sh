#!/usr/bin/env bash
set -Eeuo pipefail

## Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0


# keycloak-setup.sh
# Usage ./keycloak-setup.sh -c <EKS_CLUSTER_NAME> -w <AMG_WORKSPACE_NAME> -n <KEYCLOAK_NAMESPACE> -r <KEYCLOAK_REALM>
# Example ./keycloak-setup.sh -c PetsiteEKS-cluster -w demo-amg -n keycloak -r amg
# Created for AWS One Observability Workshop :  https://observability.workshop.aws/

echo "---------------------------------------------------------------------------------------------"
echo "This script sets up Keycloak resources for Amazon Managed Grafana SAML authentication."
echo "---------------------------------------------------------------------------------------------"

# ------------------------------------------------------------------------------
# Defaults
# ------------------------------------------------------------------------------
ACCOUNT_ID="${ACCOUNT_ID:-}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
CLUSTER_NAME=""
WORKSPACE_NAME=""
KEYCLOAK_NAMESPACE="keycloak"
KEYCLOAK_REALM="amg"
SHOW_HELP="NO"

KEYCLOAK_RELEASE="keycloak"
KEYCLOAK_CHART="bitnami/keycloak"
KEYCLOAK_CHART_VERSION="24.2.3"
KEYCLOAK_ADMIN_USER="user"

EBS_ROLE_NAME="AmazonEKS_EBS_CSI_DriverRole"
EBS_SERVICE_ACCOUNT="ebs-csi-controller-sa"
EBS_STORAGE_CLASS="ebs-sc"

WORKSPACE_ID=""
WORKSPACE_ENDPOINT=""
KEYCLOAK_ADMIN_PASSWORD=""
KEYCLOAK_USER_ADMIN_PASSWORD=""
KEYCLOAK_USER_EDITOR_PASSWORD=""
SAML_URL=""

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
log() {
  echo "$*"
}

die() {
  echo ""
  echo "ERROR: $*"
  exit 1
}

usage() {
  cat <<EOF

Options:
  -a, --account-id string            AWS account id (default inferred from STS)
  -c, --cluster-name string          Amazon EKS cluster name
  -w, --workspace-name string        Amazon Managed Grafana workspace name
  -n, --keycloak-namespace string    Namespace for keycloak (default: keycloak)
  -r, --keycloak-realm string        Keycloak realm for AMG (default: amg)
  -h, --help                         Show this help message

Example:
  ./keycloak-setup.sh \\
    --cluster-name PetsiteEKS-cluster \\
    --workspace-name amg-demo \\
    --keycloak-namespace keycloak \\
    --keycloak-realm amg

EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

retry() {
  local tries="$1"
  local sleep_seconds="$2"
  shift 2

  local count=1
  until "$@"; do
    if [[ $count -ge $tries ]]; then
      return 1
    fi
    count=$((count + 1))
    sleep "$sleep_seconds"
  done
}

# ------------------------------------------------------------------------------
# Argument parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--account-id)
      ACCOUNT_ID="$2"
      shift 2
      ;;
    -c|--cluster-name)
      CLUSTER_NAME="$2"
      shift 2
      ;;
    -w|--workspace-name)
      WORKSPACE_NAME="$2"
      shift 2
      ;;
    -n|--keycloak-namespace)
      KEYCLOAK_NAMESPACE="$2"
      shift 2
      ;;
    -r|--keycloak-realm)
      KEYCLOAK_REALM="$2"
      shift 2
      ;;
    -h|--help)
      SHOW_HELP="YES"
      shift
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

if [[ "$SHOW_HELP" == "YES" ]]; then
  usage
  exit 0
fi

[[ -n "$CLUSTER_NAME" ]] || die "Amazon EKS cluster name is required."
[[ -n "$WORKSPACE_NAME" ]] || die "Amazon Managed Grafana workspace name is required."

# ------------------------------------------------------------------------------
# Dependency checks
# ------------------------------------------------------------------------------
for cmd in aws jq curl openssl tar uname; do
  require_cmd "$cmd"
done

install_kubectl_if_missing() {
  if command -v kubectl >/dev/null 2>&1; then
    log "kubectl is already installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1)"
    return
  fi

  log "kubectl is not installed. Installing kubectl..."
  local arch
  local os

  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    arm64)   arch="arm64" ;;
    *)       die "Unsupported architecture: $(uname -m)" ;;
  esac

  local kubectl_version
  kubectl_version="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"

  curl -fsSLO "https://dl.k8s.io/release/${kubectl_version}/bin/${os}/${arch}/kubectl"

  if command -v sudo >/dev/null 2>&1; then
    sudo install -m 0755 kubectl /usr/local/bin/kubectl
  else
    install -m 0755 kubectl /usr/local/bin/kubectl
  fi

  rm -f kubectl
  require_cmd kubectl
  log "kubectl installed successfully: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1)"
}

install_eksctl_if_missing() {
  if command -v eksctl >/dev/null 2>&1; then
    log "eksctl is already installed."
    return
  fi

  log "eksctl is not installed. Installing eksctl..."
  local arch="amd64"
  local platform
  platform="$(uname -s)_${arch}"

  curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_${platform}.tar.gz"
  tar -xzf "eksctl_${platform}.tar.gz" -C /tmp
  rm -f "eksctl_${platform}.tar.gz"

  if command -v sudo >/dev/null 2>&1; then
    sudo install -m 0755 /tmp/eksctl /usr/local/bin/eksctl
  else
    install -m 0755 /tmp/eksctl /usr/local/bin/eksctl
  fi

  rm -f /tmp/eksctl
  require_cmd eksctl
}

install_helm_if_missing() {
  if command -v helm >/dev/null 2>&1; then
    log "helm is already installed: $(helm version --short 2>/dev/null)"
    return
  fi

  log "helm is not installed. Installing helm..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  require_cmd helm
  log "helm installed successfully: $(helm version --short 2>/dev/null)"
}

# ------------------------------------------------------------------------------
# AWS context
# ------------------------------------------------------------------------------
resolve_aws_context() {
  if [[ -z "$AWS_REGION" ]]; then
    AWS_REGION="$(aws configure get region || true)"
  fi
  [[ -n "$AWS_REGION" ]] || die "Could not determine AWS region."

  if [[ -z "$ACCOUNT_ID" ]]; then
    ACCOUNT_ID="$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || true)"
  fi
  [[ -n "$ACCOUNT_ID" && "$ACCOUNT_ID" != "None" ]] || die "Could not determine AWS account ID."
}

print_script_arguments() {
  echo ""
  echo "Script arguments:"
  echo "---------------------------------------------------------------------------------------------"
  echo "  ACCOUNT_ID..........$ACCOUNT_ID"
  echo "  AWS_REGION..........$AWS_REGION"
  echo "  CLUSTER_NAME........$CLUSTER_NAME"
  echo "  WORKSPACE_NAME......$WORKSPACE_NAME"
  echo "  KEYCLOAK_NAMESPACE..$KEYCLOAK_NAMESPACE"
  echo "  KEYCLOAK_REALM......$KEYCLOAK_REALM"
  echo "---------------------------------------------------------------------------------------------"
  echo ""
}

# ------------------------------------------------------------------------------
# EKS / AMG discovery
# ------------------------------------------------------------------------------
locate_eks_cluster() {
  log "Searching Amazon EKS cluster with name '$CLUSTER_NAME'..."
  aws eks describe-cluster --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null \
    || die "Could not locate Amazon EKS cluster with name '$CLUSTER_NAME'."
  log "Found Amazon EKS cluster."
}

configure_kubeconfig() {
  log "Updating kubeconfig..."
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null \
    || die "Failed to update kubeconfig."
}

locate_amg_workspace() {
  log "Searching Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'..."
  WORKSPACE_ID="$(
    aws grafana list-workspaces \
      --region "$AWS_REGION" \
      --query "workspaces[?name==\`$WORKSPACE_NAME\`].id | [0]" \
      --output text
  )"

  [[ -n "$WORKSPACE_ID" && "$WORKSPACE_ID" != "None" ]] \
    || die "Could not locate Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'."

  log "Found Amazon Managed Grafana workspace."
}

wait_for_active_amg_workspace() {
  local workspace_meta
  local workspace_status

  workspace_meta="$(aws grafana describe-workspace --region "$AWS_REGION" --workspace-id "$WORKSPACE_ID")" \
    || die "Failed to describe AMG workspace."

  workspace_status="$(echo "$workspace_meta" | jq -r '.workspace.status')"

  while [[ "$workspace_status" != "ACTIVE" ]]; do
    log "Workspace status is '$workspace_status'. Waiting for 10 seconds."
    sleep 10
    workspace_meta="$(aws grafana describe-workspace --region "$AWS_REGION" --workspace-id "$WORKSPACE_ID")" \
      || die "Failed to describe AMG workspace."
    workspace_status="$(echo "$workspace_meta" | jq -r '.workspace.status')"
  done

  WORKSPACE_ENDPOINT="$(echo "$workspace_meta" | jq -r '.workspace.endpoint')"
}

# ------------------------------------------------------------------------------
# EBS CSI
# ------------------------------------------------------------------------------
install_ebs_csi_driver() {
  log "Checking IRSA for EBS CSI driver add-on..."
  local irsa
  irsa="$(
    eksctl get iamserviceaccount \
      --cluster "$CLUSTER_NAME" \
      --namespace kube-system \
      --name "$EBS_SERVICE_ACCOUNT" \
      -o json 2>/dev/null | jq -r '.[].metadata.name' || true
  )"

  if [[ -z "$irsa" ]]; then
    log "IRSA for EBS CSI driver add-on will be created."
    eksctl create iamserviceaccount \
      --name "$EBS_SERVICE_ACCOUNT" \
      --namespace kube-system \
      --cluster "$CLUSTER_NAME" \
      --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
      --approve \
      --role-only \
      --role-name "$EBS_ROLE_NAME" \
      >/dev/null
  else
    log "Found IRSA for EBS CSI driver add-on."
  fi

  log "Checking if EBS CSI add-on is installed..."
  local addon
  addon="$(
    aws eks list-addons \
      --region "$AWS_REGION" \
      --cluster-name "$CLUSTER_NAME" \
      --query 'addons[?@==`aws-ebs-csi-driver`]' \
      --output text || true
  )"

  if [[ -z "$addon" ]]; then
    log "Installing EBS CSI driver add-on..."
    eksctl create addon \
      --name aws-ebs-csi-driver \
      --cluster "$CLUSTER_NAME" \
      --service-account-role-arn "arn:aws:iam::$ACCOUNT_ID:role/$EBS_ROLE_NAME" \
      --force \
      >/dev/null

    log "Waiting for EBS CSI add-on to become ACTIVE..."
    aws eks wait addon-active \
      --region "$AWS_REGION" \
      --cluster-name "$CLUSTER_NAME" \
      --addon-name aws-ebs-csi-driver \
      || die "Failed waiting for EBS CSI add-on to become ACTIVE."
  else
    log "EBS CSI driver add-on is already installed."
  fi

  log "Checking if StorageClass '$EBS_STORAGE_CLASS' exists..."
  if ! kubectl get storageclass "$EBS_STORAGE_CLASS" >/dev/null 2>&1; then
    log "Creating StorageClass '$EBS_STORAGE_CLASS'..."
    cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${EBS_STORAGE_CLASS}
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
EOF
  else
    log "StorageClass '$EBS_STORAGE_CLASS' already exists."
  fi
}

# ------------------------------------------------------------------------------
# Helm / namespace
# ------------------------------------------------------------------------------
ensure_helm_repo() {
  local repo="$1"
  local url="$2"

  if helm repo list -o json | jq -e ".[] | select(.name == \"$repo\")" >/dev/null 2>&1; then
    log "Found helm repo '$repo'."
  else
    log "Adding helm repo '$repo'..."
    helm repo add "$repo" "$url" >/dev/null
  fi
}

ensure_namespace() {
  log "Checking if namespace '$KEYCLOAK_NAMESPACE' exists..."
  kubectl get ns "$KEYCLOAK_NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$KEYCLOAK_NAMESPACE" >/dev/null
}

# ------------------------------------------------------------------------------
# Keycloak install
# ------------------------------------------------------------------------------
install_keycloak() {
  log "Installing/upgrading Keycloak..."

  local values_file
  values_file="$(mktemp)"

  cat > "$values_file" <<EOF
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
EOF

  helm upgrade --install "$KEYCLOAK_RELEASE" "$KEYCLOAK_CHART" \
    --version "$KEYCLOAK_CHART_VERSION" \
    --namespace "$KEYCLOAK_NAMESPACE" \
    -f "$values_file" \
    >/dev/null

  rm -f "$values_file"
}

wait_for_keycloak_pod() {
  log "Waiting for Keycloak StatefulSet pod to be Running..."
  retry 90 10 kubectl get pod "${KEYCLOAK_RELEASE}-0" -n "$KEYCLOAK_NAMESPACE" >/dev/null 2>&1 \
    || die "Keycloak pod was not created."

  local pod_phase
  pod_phase="$(kubectl get pod "${KEYCLOAK_RELEASE}-0" -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}')"

  while [[ "$pod_phase" != "Running" ]]; do
    log "Keycloak pod status is '$pod_phase'. Waiting for 10 seconds."
    sleep 10
    pod_phase="$(kubectl get pod "${KEYCLOAK_RELEASE}-0" -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  done
}

get_keycloak_admin_password() {
  local pw=""
  pw="$(kubectl -n "$KEYCLOAK_NAMESPACE" get secret "$KEYCLOAK_RELEASE" -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || true)"

  if [[ -z "$pw" ]]; then
    local secret_name
    secret_name="$(
      kubectl -n "$KEYCLOAK_NAMESPACE" get secrets -o json |
      jq -r '.items[] | select(.data["admin-password"] != null) | .metadata.name' |
      head -n 1
    )"

    if [[ -n "$secret_name" ]]; then
      pw="$(kubectl -n "$KEYCLOAK_NAMESPACE" get secret "$secret_name" -o jsonpath='{.data.admin-password}' | base64 -d 2>/dev/null || true)"
    fi
  fi

  [[ -n "$pw" ]] || die "Could not retrieve Keycloak admin password from Kubernetes secret."
  KEYCLOAK_ADMIN_PASSWORD="$pw"
}

# ------------------------------------------------------------------------------
# Keycloak config
# ------------------------------------------------------------------------------
configure_keycloak() {
  log "Configuring Keycloak realm/users/client for AMG SAML..."

  KEYCLOAK_USER_ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"
  KEYCLOAK_USER_EDITOR_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"

  get_keycloak_admin_password

  local tmp_script
  tmp_script="$(mktemp)"

  cat > "$tmp_script" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

KCADM="/opt/bitnami/keycloak/bin/kcadm.sh"

wait_for_http() {
  while true; do
    if curl -fsS http://localhost:8080/ >/dev/null 2>&1; then
      return 0
    fi
    echo "Keycloak admin server not available. Waiting for 10 seconds..."
    sleep 10
  done
}

get_user_id() {
  local realm="$1"
  local username="$2"
  "$KCADM" get users -r "$realm" -q username="$username" --fields id,username --config /tmp/kcadm.config 2>/dev/null \
    | tr -d '\n' \
    | sed 's/},{/}\n{/g' \
    | grep "\"username\"[[:space:]]*:[[:space:]]*\"${username}\"" \
    | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

realm_exists() {
  local realm="$1"
  "$KCADM" get "realms/$realm" --config /tmp/kcadm.config >/dev/null 2>&1
}

client_exists() {
  local realm="$1"
  local client_id="$2"
  "$KCADM" get clients -r "$realm" -q clientId="$client_id" --config /tmp/kcadm.config 2>/dev/null \
    | tr -d '\n' \
    | grep -q "\"clientId\"[[:space:]]*:[[:space:]]*\"${client_id//\//\\/}\""
}

wait_for_http

"$KCADM" config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_MASTER_ADMIN_USER" \
  --password "$KC_MASTER_ADMIN_PASSWORD" \
  --config /tmp/kcadm.config >/dev/null

"$KCADM" update realms/master -s sslRequired=NONE --config /tmp/kcadm.config >/dev/null || true

CLIENT_ID="https://${WORKSPACE_ENDPOINT}/saml/metadata"

if realm_exists "$KC_REALM"; then
  echo "Realm '$KC_REALM' already exists."
else
  cat > /tmp/realm.json <<JSON
{
  "realm": "$KC_REALM",
  "enabled": true,
  "sslRequired": "none",
  "roles": {
    "realm": [
      { "name": "admin" },
      { "name": "editor" }
    ]
  },
  "users": [
    {
      "username": "admin",
      "email": "admin@keycloak",
      "enabled": true,
      "firstName": "Admin",
      "realmRoles": ["admin"]
    },
    {
      "username": "editor",
      "email": "editor@keycloak",
      "enabled": true,
      "firstName": "Editor",
      "realmRoles": ["editor"]
    }
  ],
  "clients": [
    {
      "clientId": "${CLIENT_ID}",
      "name": "amazon-managed-grafana",
      "enabled": true,
      "protocol": "saml",
      "adminUrl": "https://${WORKSPACE_ENDPOINT}/login/saml",
      "redirectUris": [
        "https://${WORKSPACE_ENDPOINT}/saml/acs"
      ],
      "attributes": {
        "saml.authnstatement": "true",
        "saml.server.signature": "true",
        "saml_name_id_format": "email",
        "saml_force_name_id_format": "true",
        "saml.assertion.signature": "true",
        "saml.client.signature": "false"
      },
      "defaultClientScopes": [],
      "protocolMappers": [
        {
          "name": "name",
          "protocol": "saml",
          "protocolMapper": "saml-user-property-mapper",
          "consentRequired": false,
          "config": {
            "attribute.nameformat": "Unspecified",
            "user.attribute": "firstName",
            "attribute.name": "displayName"
          }
        },
        {
          "name": "email",
          "protocol": "saml",
          "protocolMapper": "saml-user-property-mapper",
          "consentRequired": false,
          "config": {
            "attribute.nameformat": "Unspecified",
            "user.attribute": "email",
            "attribute.name": "mail"
          }
        },
        {
          "name": "role list",
          "protocol": "saml",
          "protocolMapper": "saml-role-list-mapper",
          "config": {
            "single": "true",
            "attribute.nameformat": "Unspecified",
            "attribute.name": "role"
          }
        }
      ]
    }
  ]
}
JSON

  "$KCADM" create realms -f /tmp/realm.json --config /tmp/kcadm.config >/dev/null
fi

if ! client_exists "$KC_REALM" "$CLIENT_ID"; then
  cat > /tmp/amg-client.json <<JSON
{
  "clientId": "${CLIENT_ID}",
  "name": "amazon-managed-grafana",
  "enabled": true,
  "protocol": "saml",
  "adminUrl": "https://${WORKSPACE_ENDPOINT}/login/saml",
  "redirectUris": [
    "https://${WORKSPACE_ENDPOINT}/saml/acs"
  ],
  "attributes": {
    "saml.authnstatement": "true",
    "saml.server.signature": "true",
    "saml_name_id_format": "email",
    "saml_force_name_id_format": "true",
    "saml.assertion.signature": "true",
    "saml.client.signature": "false"
  },
  "defaultClientScopes": [],
  "protocolMappers": [
    {
      "name": "name",
      "protocol": "saml",
      "protocolMapper": "saml-user-property-mapper",
      "consentRequired": false,
      "config": {
        "attribute.nameformat": "Unspecified",
        "user.attribute": "firstName",
        "attribute.name": "displayName"
      }
    },
    {
      "name": "email",
      "protocol": "saml",
      "protocolMapper": "saml-user-property-mapper",
      "consentRequired": false,
      "config": {
        "attribute.nameformat": "Unspecified",
        "user.attribute": "email",
        "attribute.name": "mail"
      }
    },
    {
      "name": "role list",
      "protocol": "saml",
      "protocolMapper": "saml-role-list-mapper",
      "config": {
        "single": "true",
        "attribute.nameformat": "Unspecified",
        "attribute.name": "role"
      }
    }
  ]
}
JSON

  "$KCADM" create clients -r "$KC_REALM" -f /tmp/amg-client.json --config /tmp/kcadm.config >/dev/null || true
fi

ADMIN_ID="$(get_user_id "$KC_REALM" admin)"
EDITOR_ID="$(get_user_id "$KC_REALM" editor)"

[[ -n "$ADMIN_ID" ]] || { echo "Admin user not found"; exit 1; }
[[ -n "$EDITOR_ID" ]] || { echo "Editor user not found"; exit 1; }

"$KCADM" update "users/${ADMIN_ID}" -r "$KC_REALM" \
  -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_ADMIN_PASSWORD}\",\"temporary\":false}]" \
  --config /tmp/kcadm.config >/dev/null

"$KCADM" update "users/${EDITOR_ID}" -r "$KC_REALM" \
  -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_EDITOR_PASSWORD}\",\"temporary\":false}]" \
  --config /tmp/kcadm.config >/dev/null

echo "Keycloak realm configuration completed."
EOF

  chmod +x "$tmp_script"

  kubectl cp "$tmp_script" "${KEYCLOAK_NAMESPACE}/${KEYCLOAK_RELEASE}-0:/tmp/keycloak-config.sh" >/dev/null

  kubectl exec -n "$KEYCLOAK_NAMESPACE" "${KEYCLOAK_RELEASE}-0" -- env \
    KC_MASTER_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
    KC_MASTER_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
    KC_REALM="$KEYCLOAK_REALM" \
    WORKSPACE_ENDPOINT="$WORKSPACE_ENDPOINT" \
    KC_REALM_ADMIN_PASSWORD="$KEYCLOAK_USER_ADMIN_PASSWORD" \
    KC_REALM_EDITOR_PASSWORD="$KEYCLOAK_USER_EDITOR_PASSWORD" \
    bash /tmp/keycloak-config.sh \
    || die "Failed to configure Keycloak."

  rm -f "$tmp_script"
}

# ------------------------------------------------------------------------------
# Load balancer / SAML URL
# ------------------------------------------------------------------------------
wait_for_load_balancer() {
  log "Waiting for Keycloak service load balancer hostname..."

  local hostname=""
  while [[ -z "$hostname" ]]; do
    hostname="$(kubectl get service "$KEYCLOAK_RELEASE" -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
    [[ -z "$hostname" ]] && log "Load balancer hostname not ready yet. Waiting 10 seconds." && sleep 10
  done

  log "Checking target group health..."
  local lb_arn
  lb_arn="$(
    aws elbv2 describe-load-balancers \
      --region "$AWS_REGION" \
      --query "LoadBalancers[?DNSName==\`$hostname\`].LoadBalancerArn | [0]" \
      --output text
  )"
  [[ -n "$lb_arn" && "$lb_arn" != "None" ]] || die "Could not find load balancer ARN for hostname $hostname."

  local tg_arn
  tg_arn="$(
    aws elbv2 describe-target-groups \
      --region "$AWS_REGION" \
      --load-balancer-arn "$lb_arn" \
      --query 'TargetGroups[0].TargetGroupArn' \
      --output text
  )"
  [[ -n "$tg_arn" && "$tg_arn" != "None" ]] || die "Could not find target group for Keycloak load balancer."

  local state
  state="$(
    aws elbv2 describe-target-health \
      --region "$AWS_REGION" \
      --target-group-arn "$tg_arn" \
      --query 'TargetHealthDescriptions[0].TargetHealth.State' \
      --output text
  )"

  while [[ "$state" != "healthy" ]]; do
    log "Target health is $state. Waiting 10 seconds."
    sleep 10
    state="$(
      aws elbv2 describe-target-health \
        --region "$AWS_REGION" \
        --target-group-arn "$tg_arn" \
        --query 'TargetHealthDescriptions[0].TargetHealth.State' \
        --output text
    )"
  done

  log "Target health is healthy."
  SAML_URL="http://${hostname}/realms/${KEYCLOAK_REALM}/protocol/saml/descriptor"
}

# ------------------------------------------------------------------------------
# AMG SAML
# ------------------------------------------------------------------------------
update_workspace_saml_auth() {
  local expected_saml_config
  expected_saml_config="$(cat <<EOF | jq -S -r '.'
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
EOF
)"

  log "Retrieving AMG workspace authentication configuration..."
  local auth_config
  auth_config="$(aws grafana describe-workspace-authentication --region "$AWS_REGION" --workspace-id "$WORKSPACE_ID")" \
    || die "Failed to retrieve AMG workspace authentication configuration."

  local auth_providers
  auth_providers="$(echo "$auth_config" | jq -c '.authentication.providers')"

  if echo "$auth_config" | jq -e '.authentication.providers | index("SAML")' >/dev/null; then
    local actual_saml_config
    actual_saml_config="$(echo "$auth_config" | jq -S -r '.authentication.saml.configuration | {
      assertionAttributes: .assertionAttributes,
      idpMetadata: .idpMetadata,
      loginValidityDuration: .loginValidityDuration,
      roleValues: .roleValues
    }')"

    if diff <(echo "$expected_saml_config") <(echo "$actual_saml_config") >/dev/null; then
      log "AMG workspace SAML authentication configuration matches expected configuration."
      return
    fi

    log "AMG workspace SAML authentication configuration does not match expected configuration."
    log "Configuration will be updated."
  else
    log "AMG workspace is not configured for SAML authentication."
  fi

  local merged_auth_providers
  merged_auth_providers="$(jq -nc --argjson arr1 "$auth_providers" --argjson arr2 '["SAML"]' '$arr1 + $arr2 | unique')"

  local input_json
  input_json="$(cat <<EOF | jq -c -r '.'
{
  "authenticationProviders": ${merged_auth_providers},
  "samlConfiguration": ${expected_saml_config},
  "workspaceId": "${WORKSPACE_ID}"
}
EOF
)"

  log "Updating AMG workspace SAML authentication..."
  local status
  status="$(
    aws grafana update-workspace-authentication \
      --region "$AWS_REGION" \
      --cli-input-json "$input_json" \
      --query 'authentication.saml.status' \
      --output text
  )" || die "Failed to update AMG workspace SAML authentication."

  log "AMG workspace SAML authentication status: $status"
}

# ------------------------------------------------------------------------------
# Output
# ------------------------------------------------------------------------------
print_final_credentials() {
  get_keycloak_admin_password

  echo ""
  echo "-------------------"
  echo "Workspace endpoint: https://${WORKSPACE_ENDPOINT}/"
  echo "-------------------"
  echo ""
  echo "-------------------"
  echo "Keycloak (master realm) admin console credentials"
  echo "-------------------"
  echo "username: ${KEYCLOAK_ADMIN_USER}"
  echo "password: ${KEYCLOAK_ADMIN_PASSWORD}"
  echo ""
  echo "-------------------"
  echo "Keycloak realm users (for SAML testing)"
  echo "-------------------"
  echo "realm: ${KEYCLOAK_REALM}"
  echo "admin  password: ${KEYCLOAK_USER_ADMIN_PASSWORD}"
  echo "editor password: ${KEYCLOAK_USER_EDITOR_PASSWORD}"
  echo ""
  echo "SAML metadata URL: ${SAML_URL}"
  echo ""
  echo "Setup done."
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
main() {
  install_kubectl_if_missing
  install_helm_if_missing
  install_eksctl_if_missing
  resolve_aws_context
  print_script_arguments

  locate_eks_cluster
  configure_kubeconfig

  locate_amg_workspace
  wait_for_active_amg_workspace

  install_ebs_csi_driver

  ensure_helm_repo "bitnami" "https://charts.bitnami.com/bitnami"
  helm repo update >/dev/null

  ensure_namespace
  install_keycloak
  wait_for_keycloak_pod

  configure_keycloak
  wait_for_load_balancer
  update_workspace_saml_auth

  print_final_credentials
}

main "$@"
