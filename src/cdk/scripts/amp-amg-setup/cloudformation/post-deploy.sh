#!/usr/bin/env bash
set -Eeuo pipefail

# =============================================================================
# Post-deploy companion script for CloudFormation stack
#
# Completes the steps that CloudFormation cannot handle natively:
#   - Managed scraper creation + RBAC + eksctl identity mapping
#   - Keycloak deployment on EKS (Helm)
#   - Keycloak realm/SAML client configuration
#   - AMG SAML authentication update
#   - Grafana datasource + dashboard 3119 import
#
# Usage:
#   ./post-deploy.sh --region us-east-1 --stack-name amp-amg-stack
# =============================================================================

AWS_REGION=""
STACK_NAME=""
CLUSTER_NAME="devops-agent-eks"
KEYCLOAK_NAMESPACE="keycloak"
KEYCLOAK_REALM="amg"
KEYCLOAK_ADMIN_USER="user"
KEYCLOAK_CHART_VERSION="24.2.3"
SCRAPER_ALIAS="demo-amp-scraper"
DASHBOARD_ID="3119"

log() { echo "$*"; }
die() { echo "ERROR: $*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)     AWS_REGION="$2";     shift 2 ;;
    --stack-name) STACK_NAME="$2";     shift 2 ;;
    --cluster)    CLUSTER_NAME="$2";   shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -n "$AWS_REGION" ]]  || die "--region is required"
[[ -n "$STACK_NAME" ]]  || die "--stack-name is required"

for cmd in aws jq kubectl curl openssl helm; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required: $cmd"
done

# Get stack outputs
get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey==\`$1\`].OutputValue | [0]" --output text
}

AMP_WORKSPACE_ARN=$(get_output AmpWorkspaceArn)
AMP_WORKSPACE_ID=$(get_output AmpWorkspaceId)
AMG_WORKSPACE_ID=$(get_output AmgWorkspaceId)
AMG_ENDPOINT=$(get_output AmgEndpoint)
AMP_ALIAS=$(aws amp describe-workspace --workspace-id "$AMP_WORKSPACE_ID" --region "$AWS_REGION" \
  --query 'workspace.alias' --output text)
AMP_ENDPOINT=$(aws amp describe-workspace --workspace-id "$AMP_WORKSPACE_ID" --region "$AWS_REGION" \
  --query 'workspace.prometheusEndpoint' --output text)

log "Stack outputs:"
log "  AMP: $AMP_WORKSPACE_ID ($AMP_ALIAS)"
log "  AMG: $AMG_WORKSPACE_ID ($AMG_ENDPOINT)"

aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null

# --- Managed Scraper ---
log ""
log "=== Creating managed scraper ==="
EXISTING_SCRAPER=$(aws amp list-scrapers --region "$AWS_REGION" --output json 2>/dev/null | \
  jq -r ".scrapers[] | select(.alias==\"${SCRAPER_ALIAS}\") | .scraperId" | head -1 || true)

if [[ -n "$EXISTING_SCRAPER" && "$EXISTING_SCRAPER" != "null" ]]; then
  log "  Scraper exists: $EXISTING_SCRAPER"
  SCRAPER_ID="$EXISTING_SCRAPER"
else
  CLUSTER_INFO=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --output json)
  CLUSTER_ARN=$(echo "$CLUSTER_INFO" | jq -r '.cluster.arn')
  SUBNET_ARRAY=$(echo "$CLUSTER_INFO" | jq -c '.cluster.resourcesVpcConfig.subnetIds')
  CLUSTER_SG=$(echo "$CLUSTER_INFO" | jq -r '.cluster.resourcesVpcConfig.clusterSecurityGroupId')

  SCRAPE_CONFIG_B64=$(base64 -w 0 < "$(dirname "$0")/../terraform/scraper-config.yaml" 2>/dev/null || \
    cat <<'SCEOF' | base64 -w 0
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
SCEOF
  )

  # RBAC
  cat <<RBACEOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: amp-iamproxy-ingest-role
rules:
  - apiGroups: [""]
    resources: ["nodes","nodes/proxy","nodes/metrics","services","endpoints","pods"]
    verbs: ["get","list","watch"]
  - apiGroups: ["extensions","networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get","list","watch"]
  - nonResourceURLs: ["/metrics","/metrics/cadvisor"]
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

  SCRAPER_RESULT=$(aws amp create-scraper \
    --alias "$SCRAPER_ALIAS" \
    --source "{\"eksConfiguration\":{\"clusterArn\":\"${CLUSTER_ARN}\",\"subnetIds\":${SUBNET_ARRAY},\"securityGroupIds\":[\"${CLUSTER_SG}\"]}}" \
    --destination "{\"ampConfiguration\":{\"workspaceArn\":\"${AMP_WORKSPACE_ARN}\"}}" \
    --scrape-configuration "{\"configurationBlob\":\"${SCRAPE_CONFIG_B64}\"}" \
    --region "$AWS_REGION" --output json)

  SCRAPER_ID=$(echo "$SCRAPER_RESULT" | jq -r '.scraperId')
  SCRAPER_ROLE_ARN=$(echo "$SCRAPER_RESULT" | jq -r '.roleArn')
  log "  Created scraper: $SCRAPER_ID"

  if command -v eksctl >/dev/null 2>&1; then
    eksctl create iamidentitymapping \
      --cluster "$CLUSTER_NAME" --region "$AWS_REGION" \
      --arn "$SCRAPER_ROLE_ARN" --username "aps-collector-user" 2>/dev/null || true
  fi
  log "  Scraper initiated (background)..."
fi

# --- Keycloak ---
log ""
log "=== Deploying Keycloak ==="
KC_POD_PHASE=$(kubectl get pod keycloak-0 -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)

if [[ "$KC_POD_PHASE" == "Running" ]]; then
  log "  Keycloak already running"
else
  helm repo add bitnami https://charts.bitnami.com/bitnami >/dev/null 2>&1 || true
  helm repo update >/dev/null
  kubectl get ns "$KEYCLOAK_NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$KEYCLOAK_NAMESPACE" >/dev/null

  # Detect EBS CSI provisioner
  if kubectl get csidrivers ebs.csi.eks.amazonaws.com >/dev/null 2>&1; then
    EBS_PROV="ebs.csi.eks.amazonaws.com"
  else
    EBS_PROV="ebs.csi.aws.com"
  fi

  kubectl get storageclass ebs-sc >/dev/null 2>&1 || cat <<SCEOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
provisioner: ${EBS_PROV}
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
SCEOF

  HELM_VALUES=$(mktemp)
  cat > "$HELM_VALUES" <<HVEOF
global:
  storageClass: "ebs-sc"
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

  helm upgrade --install keycloak bitnami/keycloak \
    --version "$KEYCLOAK_CHART_VERSION" --namespace "$KEYCLOAK_NAMESPACE" -f "$HELM_VALUES" >/dev/null
  rm -f "$HELM_VALUES"

  log "  Waiting for Keycloak pod..."
  for i in $(seq 1 90); do
    KC_POD_PHASE=$(kubectl get pod keycloak-0 -n "$KEYCLOAK_NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)
    [[ "$KC_POD_PHASE" == "Running" ]] && break
    sleep 10
  done
  [[ "$KC_POD_PHASE" == "Running" ]] || die "Keycloak pod not Running"
fi

KC_ADMIN_PASSWORD=$(kubectl -n "$KEYCLOAK_NAMESPACE" get secret keycloak \
  -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || true)
[[ -n "$KC_ADMIN_PASSWORD" ]] || die "Cannot get Keycloak admin password"

KC_HOSTNAME=""
while [[ -z "$KC_HOSTNAME" ]]; do
  KC_HOSTNAME=$(kubectl get service keycloak -n "$KEYCLOAK_NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  [[ -z "$KC_HOSTNAME" ]] && sleep 10
done
log "  Keycloak LB: $KC_HOSTNAME"

# Wait for LB health
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
      sleep 10
    done
  fi
fi

# --- CloudFront distribution for HTTPS ---
log ""
log "=== Creating CloudFront distribution for Keycloak HTTPS ==="
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

# --- Keycloak SAML config ---
log ""
log "=== Configuring Keycloak SAML ==="

KC_USER_ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"
KC_USER_EDITOR_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"

# Strip https:// prefix if present
AMG_ENDPOINT_CLEAN="${AMG_ENDPOINT#https://}"

kubectl exec -n "$KEYCLOAK_NAMESPACE" keycloak-0 -- env \
  KC_MASTER_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  KC_MASTER_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
  KC_REALM="$KEYCLOAK_REALM" \
  WORKSPACE_ENDPOINT="$AMG_ENDPOINT_CLEAN" \
  KC_REALM_ADMIN_PASSWORD="$KC_USER_ADMIN_PASSWORD" \
  KC_REALM_EDITOR_PASSWORD="$KC_USER_EDITOR_PASSWORD" \
  bash -c '
KCADM="/opt/bitnami/keycloak/bin/kcadm.sh"
while true; do curl -fsS http://localhost:8080/ >/dev/null 2>&1 && break; sleep 10; done
$KCADM config credentials --server http://localhost:8080 --realm master \
  --user "$KC_MASTER_ADMIN_USER" --password "$KC_MASTER_ADMIN_PASSWORD" --config /tmp/kcadm.config >/dev/null
$KCADM update realms/master -s sslRequired=NONE --config /tmp/kcadm.config >/dev/null || true
CLIENT_ID="https://${WORKSPACE_ENDPOINT}/saml/metadata"
if ! $KCADM get "realms/$KC_REALM" --config /tmp/kcadm.config >/dev/null 2>&1; then
  cat > /tmp/realm.json <<JSON
{"realm":"$KC_REALM","enabled":true,"sslRequired":"none",
 "roles":{"realm":[{"name":"admin"},{"name":"editor"}]},
 "users":[
   {"username":"admin","email":"admin@keycloak","enabled":true,"firstName":"Admin","realmRoles":["admin"]},
   {"username":"editor","email":"editor@keycloak","enabled":true,"firstName":"Editor","realmRoles":["editor"]}
 ],
 "clients":[{
   "clientId":"${CLIENT_ID}","name":"amazon-managed-grafana","enabled":true,"protocol":"saml",
   "adminUrl":"https://${WORKSPACE_ENDPOINT}/login/saml",
   "redirectUris":["https://${WORKSPACE_ENDPOINT}/saml/acs"],
   "attributes":{"saml.authnstatement":"true","saml.server.signature":"true","saml_name_id_format":"email","saml_force_name_id_format":"true","saml.assertion.signature":"true","saml.client.signature":"false"},
   "defaultClientScopes":[],
   "protocolMappers":[
     {"name":"name","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"firstName","attribute.name":"displayName"}},
     {"name":"email","protocol":"saml","protocolMapper":"saml-user-property-mapper","consentRequired":false,"config":{"attribute.nameformat":"Unspecified","user.attribute":"email","attribute.name":"mail"}},
     {"name":"role list","protocol":"saml","protocolMapper":"saml-role-list-mapper","config":{"single":"true","attribute.nameformat":"Unspecified","attribute.name":"role"}}
   ]
 }]
}
JSON
  $KCADM create realms -f /tmp/realm.json --config /tmp/kcadm.config >/dev/null
fi
get_user_id() {
  $KCADM get users -r "$1" -q username="$2" --fields id,username --config /tmp/kcadm.config 2>/dev/null \
    | tr -d "\n" | sed "s/},{/}\n{/g" \
    | grep "\"username\"[[:space:]]*:[[:space:]]*\"${2}\"" \
    | sed -n "s/.*\"id\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}
ADMIN_ID="$(get_user_id "$KC_REALM" admin)"
EDITOR_ID="$(get_user_id "$KC_REALM" editor)"
[[ -n "$ADMIN_ID" ]] && $KCADM update "users/${ADMIN_ID}" -r "$KC_REALM" \
  -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_ADMIN_PASSWORD}\",\"temporary\":false}]" --config /tmp/kcadm.config >/dev/null
[[ -n "$EDITOR_ID" ]] && $KCADM update "users/${EDITOR_ID}" -r "$KC_REALM" \
  -s "credentials=[{\"type\":\"password\",\"value\":\"${KC_REALM_EDITOR_PASSWORD}\",\"temporary\":false}]" --config /tmp/kcadm.config >/dev/null
echo "Keycloak realm configured"
' || die "Failed to configure Keycloak"

# Update AMG SAML auth
SAML_CONFIG=$(cat <<SAMLEOF
{
  "assertionAttributes":{"email":"mail","login":"mail","name":"displayName","role":"role"},
  "idpMetadata":{"url":"${SAML_URL}"},
  "loginValidityDuration":120,
  "roleValues":{"admin":["admin"],"editor":["editor"]}
}
SAMLEOF
)
AUTH_INPUT=$(jq -nc --argjson saml "$SAML_CONFIG" --arg wid "$AMG_WORKSPACE_ID" \
  '{authenticationProviders:["SAML"],samlConfiguration:$saml,workspaceId:$wid}')
aws grafana update-workspace-authentication --region "$AWS_REGION" --cli-input-json "$AUTH_INPUT" >/dev/null
log "  SAML configured"

# --- Datasource + Dashboard ---
log ""
log "=== Adding datasource and dashboard ==="

GRAFANA_URL="https://${AMG_ENDPOINT_CLEAN}"
API_KEY_RESULT=$(aws grafana create-workspace-api-key \
  --workspace-id "$AMG_WORKSPACE_ID" --key-name "cfn-post-deploy-$(date +%s)" \
  --key-role "ADMIN" --seconds-to-live 3600 --region "$AWS_REGION" --output json)
GRAFANA_API_KEY=$(echo "$API_KEY_RESULT" | jq -r '.key')

DS_PAYLOAD="{\"name\":\"${AMP_ALIAS}\",\"type\":\"prometheus\",\"access\":\"proxy\",\"url\":\"${AMP_ENDPOINT}\",\"isDefault\":true,\"jsonData\":{\"httpMethod\":\"POST\",\"sigV4Auth\":true,\"sigV4AuthType\":\"default\",\"sigV4Region\":\"${AWS_REGION}\"}}"
curl -s -X POST "${GRAFANA_URL}/api/datasources" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" -H "Content-Type: application/json" -d "$DS_PAYLOAD" >/dev/null 2>&1 || true

DS_UID=$(curl -s "${GRAFANA_URL}/api/datasources/name/${AMP_ALIAS}" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" | jq -r '.uid // empty')
[[ -z "$DS_UID" ]] && DS_UID=$(curl -s "${GRAFANA_URL}/api/datasources" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" | jq -r '.[0].uid // empty')
log "  Datasource UID: $DS_UID"

DASHBOARD_JSON=$(curl -s "https://grafana.com/api/dashboards/${DASHBOARD_ID}/revisions/latest/download")
IMPORT_PAYLOAD=$(jq -n --argjson dashboard "$DASHBOARD_JSON" --arg ds_uid "$DS_UID" \
  '{dashboard:$dashboard,overwrite:true,inputs:[{name:"DS_PROMETHEUS",type:"datasource",pluginId:"prometheus",value:$ds_uid}],folderId:0}' \
  | jq '.dashboard.id = null')
curl -s -X POST "${GRAFANA_URL}/api/dashboards/import" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" -H "Content-Type: application/json" -d "$IMPORT_PAYLOAD" >/dev/null 2>&1 || true
log "  Dashboard ${DASHBOARD_ID} imported"

# --- Wait for scraper ---
if [[ -n "${SCRAPER_ID:-}" ]]; then
  log ""
  log "=== Waiting for scraper ==="
  while true; do
    S_STATUS=$(aws amp describe-scraper --scraper-id "$SCRAPER_ID" --region "$AWS_REGION" \
      --query 'scraper.status.statusCode' --output text)
    [[ "$S_STATUS" == "ACTIVE" ]] && break
    [[ "$S_STATUS" == "CREATION_FAILED" ]] && die "Scraper creation failed"
    echo "  Status: $S_STATUS - waiting..."
    sleep 15
  done
  log "  Scraper ACTIVE"
fi

echo ""
echo "============================================================"
echo "  POST-DEPLOY COMPLETE"
echo "============================================================"
echo "  AMG URL:      ${GRAFANA_URL}"
echo "  SAML URL:     ${SAML_URL}"
echo "  CloudFront:   https://${CF_DOMAIN}"
echo "  admin pw:     ${KC_USER_ADMIN_PASSWORD}"
echo "  editor pw:    ${KC_USER_EDITOR_PASSWORD}"
echo "============================================================"

# --- Upload credentials to Secrets Manager ---
log ""
log "=== Uploading credentials to Secrets Manager ==="

SECRET_NAME="amp-amg-setup-credentials"
SECRET_VALUE=$(jq -nc \
  --arg amg_url "$GRAFANA_URL" \
  --arg saml_url "$SAML_URL" \
  --arg cf_url "https://${CF_DOMAIN}" \
  --arg cf_id "${CF_ID:-}" \
  --arg kc_lb "$KC_HOSTNAME" \
  --arg kc_admin_user "$KEYCLOAK_ADMIN_USER" \
  --arg kc_admin_pw "$KC_ADMIN_PASSWORD" \
  --arg realm_admin_pw "$KC_USER_ADMIN_PASSWORD" \
  --arg realm_editor_pw "$KC_USER_EDITOR_PASSWORD" \
  --arg amp_id "$AMP_WORKSPACE_ID" \
  --arg amg_id "$AMG_WORKSPACE_ID" \
  '{
    amp_workspace_id: $amp_id,
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
