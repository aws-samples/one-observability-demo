locals {
  account_id    = data.aws_caller_identity.current.account_id
  amg_role_name = "${var.amg_workspace_name}-amg-role"
}

# =============================================================================
# Step 1: AMP Workspace
# =============================================================================

resource "aws_prometheus_workspace" "amp" {
  alias = var.amp_alias
}

# =============================================================================
# Step 2: Managed Scraper + RBAC
# =============================================================================

resource "kubernetes_cluster_role" "amp_scraper" {
  metadata {
    name = "amp-iamproxy-ingest-role"
  }

  rule {
    api_groups = [""]
    resources  = ["nodes", "nodes/proxy", "nodes/metrics", "services", "endpoints", "pods"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["extensions", "networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    non_resource_urls = ["/metrics", "/metrics/cadvisor"]
    verbs             = ["get"]
  }
}

resource "kubernetes_cluster_role_binding" "amp_scraper" {
  metadata {
    name = "amp-iamproxy-ingest-role-binding"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.amp_scraper.metadata[0].name
  }

  subject {
    kind      = "User"
    name      = "aps-collector-user"
    api_group = "rbac.authorization.k8s.io"
  }
}

resource "aws_prometheus_scraper" "eks" {
  alias = var.scraper_alias

  source {
    eks {
      cluster_arn       = data.aws_eks_cluster.cluster.arn
      subnet_ids        = data.aws_eks_cluster.cluster.vpc_config[0].subnet_ids
      security_group_ids = [data.aws_eks_cluster.cluster.vpc_config[0].cluster_security_group_id]
    }
  }

  destination {
    amp {
      workspace_arn = aws_prometheus_workspace.amp.arn
    }
  }

  scrape_configuration = file("${path.module}/scraper-config.yaml")

  depends_on = [
    kubernetes_cluster_role.amp_scraper,
    kubernetes_cluster_role_binding.amp_scraper,
  ]
}

# Map scraper IAM role to EKS aws-auth (eksctl equivalent)
resource "null_resource" "scraper_identity_mapping" {
  provisioner "local-exec" {
    command = <<-EOT
      eksctl create iamidentitymapping \
        --cluster "${var.cluster_name}" \
        --region "${var.aws_region}" \
        --arn "${aws_prometheus_scraper.eks.role_arn}" \
        --username "aps-collector-user" 2>/dev/null || true
    EOT
  }

  depends_on = [aws_prometheus_scraper.eks]
}

# =============================================================================
# Step 3: Keycloak on EKS
# =============================================================================

resource "kubernetes_namespace" "keycloak" {
  metadata {
    name = var.keycloak_namespace
  }
}

# Detect EBS CSI provisioner and create StorageClass
data "external" "ebs_provisioner" {
  program = ["bash", "-c", <<-EOT
    if kubectl get csidrivers ebs.csi.eks.amazonaws.com >/dev/null 2>&1; then
      echo '{"provisioner":"ebs.csi.eks.amazonaws.com"}'
    elif kubectl get csidrivers ebs.csi.aws.com >/dev/null 2>&1; then
      echo '{"provisioner":"ebs.csi.aws.com"}'
    else
      echo '{"provisioner":"ebs.csi.aws.com"}'
    fi
  EOT
  ]
}

resource "kubernetes_storage_class" "ebs_sc" {
  metadata {
    name = "ebs-sc"
  }
  storage_provisioner    = data.external.ebs_provisioner.result["provisioner"]
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
}

resource "helm_release" "keycloak" {
  name       = "keycloak"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "keycloak"
  version    = var.keycloak_chart_version
  namespace  = kubernetes_namespace.keycloak.metadata[0].name

  values = [yamlencode({
    global = {
      storageClass = kubernetes_storage_class.ebs_sc.metadata[0].name
    }
    image = {
      registry   = "public.ecr.aws"
      repository = "bitnami/keycloak"
      tag        = "22.0.1-debian-11-r36"
      debug      = true
    }
    auth = {
      adminUser = var.keycloak_admin_user
    }
    service = {
      type = "LoadBalancer"
      annotations = {
        "service.beta.kubernetes.io/aws-load-balancer-scheme"         = "internet-facing"
        "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type" = "ip"
      }
      http = { enabled = true }
      ports = { http = 80 }
    }
    postgresql = {
      enabled = true
      image = {
        registry   = "docker.io"
        repository = "postgres"
        tag        = "16"
      }
      auth = {
        database = "keycloak"
        username = "keycloak"
        password = "keycloak"
      }
      primary = {
        containerSecurityContext = { readOnlyRootFilesystem = false }
      }
    }
    resourcesPreset = "none"
    resources = {
      requests = { cpu = "500m", memory = "512Mi", "ephemeral-storage" = "50Mi" }
      limits   = { cpu = "750m", memory = "768Mi", "ephemeral-storage" = "2Gi" }
    }
  })]

  wait    = true
  timeout = 900
}

# =============================================================================
# Step 3b: CloudFront distribution in front of Keycloak ELB (HTTPS)
# =============================================================================

# Retrieve the Keycloak NLB hostname after Helm deploys
data "external" "keycloak_lb" {
  program = ["bash", "-c", <<-EOT
    for i in $(seq 1 60); do
      HOST=$(kubectl get service keycloak -n ${var.keycloak_namespace} \
        -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
      if [[ -n "$HOST" ]]; then echo "{\"hostname\":\"$HOST\"}"; exit 0; fi
      sleep 10
    done
    echo '{"hostname":""}'
  EOT
  ]

  depends_on = [helm_release.keycloak]
}

resource "aws_cloudfront_distribution" "keycloak" {
  enabled         = true
  comment         = "HTTPS front for Keycloak SAML IdP"
  price_class     = "PriceClass_100"
  http_version    = "http2"
  is_ipv6_enabled = true

  origin {
    domain_name = data.external.keycloak_lb.result["hostname"]
    origin_id   = "keycloak-elb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "keycloak-elb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = true
      headers      = ["Host", "Origin", "Accept", "Authorization", "Content-Type"]

      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [helm_release.keycloak]
}

# =============================================================================
# Step 4: AMG Workspace + IAM Role
# =============================================================================

resource "aws_iam_role" "amg" {
  name = local.amg_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "grafana.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "amg_amp_read" {
  name = "${var.amg_workspace_name}-amp-read"
  role = aws_iam_role.amg.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AMPReadAccess"
      Effect = "Allow"
      Action = [
        "aps:QueryMetrics",
        "aps:GetMetricMetadata",
        "aps:GetSeries",
        "aps:GetLabels",
        "aps:ListWorkspaces",
        "aps:DescribeWorkspace",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_grafana_workspace" "amg" {
  name                     = var.amg_workspace_name
  account_access_type      = "CURRENT_ACCOUNT"
  authentication_providers = ["SAML"]
  permission_type          = "SERVICE_MANAGED"
  role_arn                 = aws_iam_role.amg.arn
  data_sources             = ["PROMETHEUS"]

  depends_on = [aws_iam_role_policy.amg_amp_read]
}

# =============================================================================
# Step 5: Keycloak SAML Configuration + AMG SAML Auth
# =============================================================================

# Wait for Keycloak LB to be ready, configure realm, then update AMG SAML
resource "null_resource" "keycloak_saml_config" {
  triggers = {
    amg_endpoint      = aws_grafana_workspace.amg.endpoint
    cloudfront_domain = aws_cloudfront_distribution.keycloak.domain_name
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-'SCRIPT'
      set -euo pipefail

      NAMESPACE="${NAMESPACE}"
      REALM="${REALM}"
      ADMIN_USER="${ADMIN_USER}"
      AMG_ENDPOINT="${AMG_ENDPOINT}"
      AMG_WORKSPACE_ID="${AMG_WORKSPACE_ID}"
      REGION="${REGION}"
      CF_DOMAIN="${CF_DOMAIN}"
      SECRET_NAME="${SECRET_NAME}"

      # Get Keycloak admin password
      KC_ADMIN_PASSWORD=$(kubectl -n "$NAMESPACE" get secret keycloak \
        -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || true)
      if [[ -z "$KC_ADMIN_PASSWORD" ]]; then
        KC_ADMIN_PASSWORD=$(kubectl -n "$NAMESPACE" get secrets -o json | \
          jq -r '.items[] | select(.data["admin-password"] != null) | .data["admin-password"]' | \
          head -1 | base64 -d 2>/dev/null || true)
      fi
      [[ -n "$KC_ADMIN_PASSWORD" ]] || { echo "ERROR: Cannot get Keycloak admin password"; exit 1; }

      # Wait for Keycloak LB
      KC_HOSTNAME=""
      while [[ -z "$KC_HOSTNAME" ]]; do
        KC_HOSTNAME=$(kubectl get service keycloak -n "$NAMESPACE" \
          -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
        [[ -z "$KC_HOSTNAME" ]] && sleep 10
      done
      echo "Keycloak LB: $KC_HOSTNAME"

      # Wait for LB health
      LB_ARN=$(aws elbv2 describe-load-balancers --region "$REGION" \
        --query "LoadBalancers[?DNSName==\`$KC_HOSTNAME\`].LoadBalancerArn | [0]" --output text 2>/dev/null || true)
      if [[ -n "$LB_ARN" && "$LB_ARN" != "None" ]]; then
        TG_ARN=$(aws elbv2 describe-target-groups --region "$REGION" \
          --load-balancer-arn "$LB_ARN" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
        if [[ -n "$TG_ARN" && "$TG_ARN" != "None" ]]; then
          while true; do
            TG_STATE=$(aws elbv2 describe-target-health --region "$REGION" \
              --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text 2>/dev/null || true)
            [[ "$TG_STATE" == "healthy" ]] && break
            echo "Target health: $TG_STATE - waiting..."
            sleep 10
          done
        fi
      fi

      # Generate passwords
      KC_USER_ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"
      KC_USER_EDITOR_PASSWORD="$(openssl rand -base64 12 | tr -d '\n')"

      # Configure Keycloak realm + SAML client
      kubectl exec -n "$NAMESPACE" keycloak-0 -- env \
        KC_MASTER_ADMIN_USER="$ADMIN_USER" \
        KC_MASTER_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
        KC_REALM="$REALM" \
        WORKSPACE_ENDPOINT="$AMG_ENDPOINT" \
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
'

      # Use CloudFront HTTPS URL for SAML metadata
      SAML_URL="https://${CF_DOMAIN}/realms/${REALM}/protocol/saml/descriptor"

      # Update AMG SAML authentication
      SAML_CONFIG=$(cat <<SAMLEOF
{
  "assertionAttributes": {"email":"mail","login":"mail","name":"displayName","role":"role"},
  "idpMetadata": {"url":"${SAML_URL}"},
  "loginValidityDuration": 120,
  "roleValues": {"admin":["admin"],"editor":["editor"]}
}
SAMLEOF
)
      AUTH_INPUT=$(jq -nc \
        --argjson saml "$SAML_CONFIG" \
        --arg wid "$AMG_WORKSPACE_ID" \
        '{authenticationProviders:["SAML"],samlConfiguration:$saml,workspaceId:$wid}')

      aws grafana update-workspace-authentication \
        --region "$REGION" --cli-input-json "$AUTH_INPUT" >/dev/null

      echo "SAML authentication configured (via CloudFront HTTPS)"
      echo "Keycloak admin password: $KC_USER_ADMIN_PASSWORD"
      echo "Keycloak editor password: $KC_USER_EDITOR_PASSWORD"

      # Upload credentials to Secrets Manager
      SECRET_VALUE=$(jq -nc \
        --arg amg_url "https://$AMG_ENDPOINT" \
        --arg saml_url "$SAML_URL" \
        --arg cf_url "https://$CF_DOMAIN" \
        --arg kc_lb "$KC_HOSTNAME" \
        --arg kc_admin_user "$ADMIN_USER" \
        --arg kc_admin_pw "$KC_ADMIN_PASSWORD" \
        --arg realm_admin_pw "$KC_USER_ADMIN_PASSWORD" \
        --arg realm_editor_pw "$KC_USER_EDITOR_PASSWORD" \
        '{
          amg_url: $amg_url,
          saml_url: $saml_url,
          cloudfront_url: $cf_url,
          keycloak_lb: $kc_lb,
          keycloak_admin_user: $kc_admin_user,
          keycloak_admin_password: $kc_admin_pw,
          keycloak_realm_admin_password: $realm_admin_pw,
          keycloak_realm_editor_password: $realm_editor_pw
        }')

      if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
        aws secretsmanager put-secret-value \
          --secret-id "$SECRET_NAME" \
          --secret-string "$SECRET_VALUE" \
          --region "$REGION" >/dev/null
        echo "Credentials updated in Secrets Manager: $SECRET_NAME"
      else
        aws secretsmanager create-secret \
          --name "$SECRET_NAME" \
          --description "AMP/AMG setup credentials and URLs" \
          --secret-string "$SECRET_VALUE" \
          --region "$REGION" >/dev/null
        echo "Credentials stored in Secrets Manager: $SECRET_NAME"
      fi
    SCRIPT

    environment = {
      NAMESPACE        = var.keycloak_namespace
      REALM            = var.keycloak_realm
      ADMIN_USER       = var.keycloak_admin_user
      AMG_ENDPOINT     = aws_grafana_workspace.amg.endpoint
      AMG_WORKSPACE_ID = aws_grafana_workspace.amg.id
      REGION           = var.aws_region
      CF_DOMAIN        = aws_cloudfront_distribution.keycloak.domain_name
      SECRET_NAME      = var.secrets_manager_name
    }
  }

  depends_on = [helm_release.keycloak, aws_grafana_workspace.amg, aws_cloudfront_distribution.keycloak]
}

# =============================================================================
# Step 6: Grafana API Key + AMP Datasource
# =============================================================================

resource "null_resource" "grafana_datasource_and_dashboard" {
  triggers = {
    amg_endpoint = aws_grafana_workspace.amg.endpoint
    amp_endpoint = aws_prometheus_workspace.amp.prometheus_endpoint
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-EOT
      set -euo pipefail

      AMG_WORKSPACE_ID="${aws_grafana_workspace.amg.id}"
      AMG_ENDPOINT="${aws_grafana_workspace.amg.endpoint}"
      AMP_ENDPOINT="${aws_prometheus_workspace.amp.prometheus_endpoint}"
      AMP_ALIAS="${var.amp_alias}"
      REGION="${var.aws_region}"
      DASHBOARD_ID="${var.dashboard_id}"
      GRAFANA_URL="https://$${AMG_ENDPOINT}"

      # Create Grafana API key
      API_KEY_RESULT=$(aws grafana create-workspace-api-key \
        --workspace-id "$AMG_WORKSPACE_ID" \
        --key-name "terraform-setup-$(date +%s)" \
        --key-role "ADMIN" \
        --seconds-to-live 3600 \
        --region "$REGION" --output json)
      GRAFANA_API_KEY=$(echo "$API_KEY_RESULT" | jq -r '.key')

      # Add AMP datasource
      DS_PAYLOAD=$(cat <<DSEOF
{
  "name":"$${AMP_ALIAS}","type":"prometheus","access":"proxy",
  "url":"$${AMP_ENDPOINT}","isDefault":true,
  "jsonData":{"httpMethod":"POST","sigV4Auth":true,"sigV4AuthType":"default","sigV4Region":"$${REGION}"}
}
DSEOF
)
      DS_HTTP=$(curl -s -w "\n%{http_code}" -X POST "$${GRAFANA_URL}/api/datasources" \
        -H "Authorization: Bearer $${GRAFANA_API_KEY}" \
        -H "Content-Type: application/json" -d "$DS_PAYLOAD")
      DS_CODE=$(echo "$DS_HTTP" | tail -1)
      echo "Datasource creation HTTP: $DS_CODE"

      # Get datasource UID
      DS_UID=$(curl -s "$${GRAFANA_URL}/api/datasources/name/$${AMP_ALIAS}" \
        -H "Authorization: Bearer $${GRAFANA_API_KEY}" | jq -r '.uid // empty')
      if [[ -z "$DS_UID" ]]; then
        DS_UID=$(curl -s "$${GRAFANA_URL}/api/datasources" \
          -H "Authorization: Bearer $${GRAFANA_API_KEY}" | jq -r '.[0].uid // empty')
      fi
      echo "Datasource UID: $DS_UID"

      # Download and import dashboard
      DASHBOARD_JSON=$(curl -s "https://grafana.com/api/dashboards/$${DASHBOARD_ID}/revisions/latest/download")
      IMPORT_PAYLOAD=$(jq -n \
        --argjson dashboard "$DASHBOARD_JSON" \
        --arg ds_uid "$DS_UID" \
        '{dashboard:$dashboard,overwrite:true,inputs:[{name:"DS_PROMETHEUS",type:"datasource",pluginId:"prometheus",value:$ds_uid}],folderId:0}' \
        | jq '.dashboard.id = null')

      IMPORT_HTTP=$(curl -s -w "\n%{http_code}" -X POST "$${GRAFANA_URL}/api/dashboards/import" \
        -H "Authorization: Bearer $${GRAFANA_API_KEY}" \
        -H "Content-Type: application/json" -d "$IMPORT_PAYLOAD")
      IMPORT_CODE=$(echo "$IMPORT_HTTP" | tail -1)
      IMPORT_BODY=$(echo "$IMPORT_HTTP" | sed '$d')
      echo "Dashboard import HTTP: $IMPORT_CODE"
      if [[ "$IMPORT_CODE" == "200" ]]; then
        DASH_URL=$(echo "$IMPORT_BODY" | jq -r '.importedUrl // empty')
        echo "Dashboard URL: $${GRAFANA_URL}$${DASH_URL}"
      fi
    EOT
  }

  depends_on = [null_resource.keycloak_saml_config]
}
