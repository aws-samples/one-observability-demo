#!/bin/bash
#
# Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#
#title keycloak-setup.sh
#description This script sets up Keycloak using StatefulSet for Amazon Managed Grafana SAML authentication.
#author AWS Observability Workshop Team
#date 2026-02-28
#version 2.0
#usage ./keycloak-setup.sh -c|--cluster-name -w|--workspace-name [-n|--keycloak-namespace] [-r|--keycloak-realm] [-h|--help]
#==============================================================================

set -e

echo "---------------------------------------------------------------------------------------------"
echo "This script sets up Keycloak for Amazon Managed Grafana SAML authentication."
echo "---------------------------------------------------------------------------------------------"

#### Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -c|--cluster-name)
      CLUSTER_NAME="$2"
      shift; shift
      ;;
    -w|--workspace-name)
      WORKSPACE_NAME="$2"
      shift; shift
      ;;
    -n|--keycloak-namespace)
      KEYCLOAK_NAMESPACE="$2"
      shift; shift
      ;;
    -r|--keycloak-realm)
      KEYCLOAK_REALM="$2"
      shift; shift
      ;;
    -h|--help)
      echo ""
      echo "Options:"
      echo "  -c, --cluster-name       string  Amazon EKS cluster name (required)"
      echo "  -w, --workspace-name     string  Amazon Managed Grafana workspace name (required)"
      echo "  -n, --keycloak-namespace string  Namespace for keycloak (default: keycloak)"
      echo "  -r, --keycloak-realm     string  Keycloak realm name (default: amg)"
      echo "  -h, --help                       Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Set defaults
KEYCLOAK_NAMESPACE=${KEYCLOAK_NAMESPACE:-keycloak}
KEYCLOAK_REALM=${KEYCLOAK_REALM:-amg}
AWS_REGION=${AWS_DEFAULT_REGION:-$(aws configure get region)}

# Validate required arguments
if [ -z "$CLUSTER_NAME" ]; then
  echo "ERROR: Cluster name is required (-c option)"
  exit 1
fi

if [ -z "$WORKSPACE_NAME" ]; then
  echo "ERROR: Workspace name is required (-w option)"
  exit 1
fi

echo ""
echo "Setup arguments:"
echo "---------------------------------------------------------------------------------------------"
echo "  CLUSTER_NAME........$CLUSTER_NAME"
echo "  WORKSPACE_NAME......$WORKSPACE_NAME"
echo "  KEYCLOAK_NAMESPACE..$KEYCLOAK_NAMESPACE"
echo "  KEYCLOAK_REALM......$KEYCLOAK_REALM"
echo "  AWS_REGION..........$AWS_REGION"
echo "---------------------------------------------------------------------------------------------"
echo ""

# Update kubeconfig
echo "Updating kubeconfig..."
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION >/dev/null 2>&1

# Get workspace details
echo "Getting Amazon Managed Grafana workspace details..."
WORKSPACE_ID=$(aws grafana list-workspaces --region $AWS_REGION --query "workspaces[?name=='$WORKSPACE_NAME'].id" --output text)
if [ -z "$WORKSPACE_ID" ]; then
  echo "ERROR: Workspace '$WORKSPACE_NAME' not found"
  exit 1
fi

WORKSPACE_ENDPOINT=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID --region $AWS_REGION --query 'workspace.endpoint' --output text)
SAML_CALLBACK_URL="https://${WORKSPACE_ENDPOINT}/saml/acs"
SAML_ENTITY_ID="https://${WORKSPACE_ENDPOINT}/saml/metadata"

echo "  Workspace ID: $WORKSPACE_ID"
echo "  Workspace Endpoint: $WORKSPACE_ENDPOINT"
echo "  SAML Callback URL: $SAML_CALLBACK_URL"
echo ""

# Generate passwords
ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
EDITOR_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

# Create namespace
echo "Creating namespace..."
kubectl create namespace $KEYCLOAK_NAMESPACE --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

# Create database secret
echo "Creating database secret..."
kubectl create secret generic keycloak-db-secret \
  --from-literal=username=keycloak \
  --from-literal=password=$DB_PASSWORD \
  --namespace=$KEYCLOAK_NAMESPACE \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

# Deploy PostgreSQL
echo "Deploying PostgreSQL..."
cat <<EOF | kubectl apply -f - >/dev/null 2>&1
apiVersion: v1
kind: Service
metadata:
  name: keycloak-postgresql
  namespace: $KEYCLOAK_NAMESPACE
spec:
  ports:
  - port: 5432
    protocol: TCP
    targetPort: 5432
  selector:
    app: keycloak-postgresql
  type: ClusterIP
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: keycloak-postgresql
  namespace: $KEYCLOAK_NAMESPACE
spec:
  serviceName: keycloak-postgresql
  replicas: 1
  selector:
    matchLabels:
      app: keycloak-postgresql
  template:
    metadata:
      labels:
        app: keycloak-postgresql
    spec:
      containers:
      - name: postgresql
        image: postgres:15
        env:
        - name: POSTGRES_DB
          value: keycloak
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secret
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secret
              key: password
        ports:
        - containerPort: 5432
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
          subPath: postgres
      volumes:
      - name: data
        emptyDir: {}
EOF

echo "Waiting for PostgreSQL to be ready..."
kubectl wait --for=condition=ready pod/keycloak-postgresql-0 -n $KEYCLOAK_NAMESPACE --timeout=120s >/dev/null 2>&1

# Generate TLS certificate for Keycloak
echo "Generating TLS certificate..."
openssl req -newkey rsa:2048 -nodes \
  -keyout /tmp/keycloak-server.key.pem \
  -x509 -days 365 \
  -out /tmp/keycloak-server.crt.pem \
  -subj "/CN=keycloak" >/dev/null 2>&1

openssl pkcs12 -export \
  -in /tmp/keycloak-server.crt.pem \
  -inkey /tmp/keycloak-server.key.pem \
  -out /tmp/keycloak-keystore.p12 \
  -name keycloak \
  -passout pass:changeit >/dev/null 2>&1

kubectl create secret generic keycloak-tls \
  --from-file=keystore.p12=/tmp/keycloak-keystore.p12 \
  -n $KEYCLOAK_NAMESPACE >/dev/null 2>&1

# Prepare realm import JSON
echo "Preparing realm import..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REALM_JSON=$(cat "$SCRIPT_DIR/keycloak-realm-template.json" \
  | sed "s|__REALM__|$KEYCLOAK_REALM|g" \
  | sed "s|__SAML_ENTITY_ID__|$SAML_ENTITY_ID|g" \
  | sed "s|__SAML_CALLBACK_URL__|$SAML_CALLBACK_URL|g" \
  | sed "s|__ADMIN_PASSWORD__|$ADMIN_PASSWORD|g" \
  | sed "s|__EDITOR_PASSWORD__|$EDITOR_PASSWORD|g")

kubectl create configmap keycloak-realm-import \
  --from-literal=realm.json="$REALM_JSON" \
  -n $KEYCLOAK_NAMESPACE --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

# Deploy Keycloak with TLS and realm import
echo "Deploying Keycloak..."
cat <<EOF | kubectl apply -f - >/dev/null 2>&1
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: $KEYCLOAK_NAMESPACE
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
    service.beta.kubernetes.io/aws-load-balancer-type: external
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: instance
spec:
  type: LoadBalancer
  ports:
  - port: 8443
    targetPort: 8443
    protocol: TCP
  selector:
    app: keycloak
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: keycloak
  namespace: $KEYCLOAK_NAMESPACE
spec:
  serviceName: keycloak
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:26.0.0
        args:
        - start-dev
        - --hostname-strict=false
        - --import-realm
        - --https-key-store-file=/opt/keycloak/conf/keystore.p12
        - --https-key-store-password=changeit
        - --http-enabled=false
        env:
        - name: KC_DB
          value: postgres
        - name: KC_DB_URL
          value: jdbc:postgresql://keycloak-postgresql:5432/keycloak
        - name: KC_DB_USERNAME
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secret
              key: username
        - name: KC_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secret
              key: password
        - name: KEYCLOAK_ADMIN
          value: admin
        - name: KEYCLOAK_ADMIN_PASSWORD
          value: "$KEYCLOAK_ADMIN_PASSWORD"
        - name: KC_HEALTH_ENABLED
          value: "true"
        - name: KC_METRICS_ENABLED
          value: "true"
        ports:
        - containerPort: 8443
          name: https
        volumeMounts:
        - name: tls
          mountPath: /opt/keycloak/conf/keystore.p12
          subPath: keystore.p12
          readOnly: true
        - name: realm-import
          mountPath: /opt/keycloak/data/import
          readOnly: true
        readinessProbe:
          httpGet:
            path: /realms/master
            port: 8443
            scheme: HTTPS
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /realms/master
            port: 8443
            scheme: HTTPS
          initialDelaySeconds: 60
          periodSeconds: 30
      volumes:
      - name: tls
        secret:
          secretName: keycloak-tls
      - name: realm-import
        configMap:
          name: keycloak-realm-import
EOF

echo "Waiting for Keycloak pod to start..."
kubectl wait --for=condition=ready pod/keycloak-0 -n $KEYCLOAK_NAMESPACE --timeout=300s

echo "Waiting for Keycloak to be fully operational..."
echo "  Getting LoadBalancer URL first..."
KEYCLOAK_LB=""
for i in {1..30}; do
  KEYCLOAK_LB=$(kubectl get svc keycloak -n $KEYCLOAK_NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
  if [ -n "$KEYCLOAK_LB" ]; then
    break
  fi
  sleep 5
done

if [ -z "$KEYCLOAK_LB" ]; then
  echo "ERROR: LoadBalancer not ready"
  exit 1
fi

KEYCLOAK_BASE_URL="https://${KEYCLOAK_LB}:8443"
echo "  Keycloak URL: $KEYCLOAK_BASE_URL"
echo "  Waiting for Keycloak to respond..."

for i in {1..60}; do
  if curl -sfk "${KEYCLOAK_BASE_URL}/realms/master" >/dev/null 2>&1; then
    echo "Keycloak is ready!"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "ERROR: Keycloak failed to become ready"
    exit 1
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "  Attempt $i/60..."
  fi
  sleep 5
done

# Get SAML metadata
echo "Getting SAML metadata..."
SAML_METADATA_URL="${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/saml/descriptor"
SAML_METADATA_XML=$(curl -sfk "$SAML_METADATA_URL")

if [ -z "$SAML_METADATA_XML" ]; then
  echo "ERROR: Could not retrieve SAML metadata"
  exit 1
fi

# Update AMG workspace with SAML configuration (using XML directly since self-signed cert)
echo "Configuring Amazon Managed Grafana workspace..."
SAML_XML_ESCAPED=$(echo "$SAML_METADATA_XML" | jq -Rs .)
aws grafana update-workspace-authentication \
  --workspace-id $WORKSPACE_ID \
  --authentication-providers SAML \
  --saml-configuration "{\"idpMetadata\":{\"xml\":$SAML_XML_ESCAPED},\"assertionAttributes\":{\"email\":\"mail\",\"login\":\"mail\",\"name\":\"displayName\",\"role\":\"role\"},\"loginValidityDuration\":120,\"roleValues\":{\"admin\":[\"admin\"],\"editor\":[\"editor\"]}}" \
  --region $AWS_REGION >/dev/null 2>&1

# Store credentials in Secrets Manager
echo "Storing credentials in AWS Secrets Manager..."
aws secretsmanager create-secret \
  --name oneobservabilityworkshop/keycloak \
  --description "Keycloak credentials for One Observability Workshop" \
  --secret-string "{\"admin-password\":\"$KEYCLOAK_ADMIN_PASSWORD\",\"user-admin-password\":\"$ADMIN_PASSWORD\",\"user-editor-password\":\"$EDITOR_PASSWORD\",\"db-password\":\"$DB_PASSWORD\"}" \
  --region $AWS_REGION 2>/dev/null || \
aws secretsmanager update-secret \
  --secret-id oneobservabilityworkshop/keycloak \
  --secret-string "{\"admin-password\":\"$KEYCLOAK_ADMIN_PASSWORD\",\"user-admin-password\":\"$ADMIN_PASSWORD\",\"user-editor-password\":\"$EDITOR_PASSWORD\",\"db-password\":\"$DB_PASSWORD\"}" \
  --region $AWS_REGION >/dev/null 2>&1

echo ""
echo "---------------------------------------------------------------------------------------------"
echo "Keycloak setup complete!"
echo "---------------------------------------------------------------------------------------------"
echo ""
echo "Keycloak URL: $KEYCLOAK_BASE_URL"
echo "Realm: $KEYCLOAK_REALM"
echo ""
echo "Admin User:"
echo "  Username: admin"
echo "  Password: $ADMIN_PASSWORD"
echo ""
echo "Editor User:"
echo "  Username: editor"
echo "  Password: $EDITOR_PASSWORD"
echo ""
echo "Grafana URL: https://$WORKSPACE_ENDPOINT"
echo ""
echo "Credentials stored in AWS Secrets Manager: oneobservabilityworkshop/keycloak"
echo ""
echo "To retrieve credentials later:"
echo "  aws secretsmanager get-secret-value --secret-id oneobservabilityworkshop/keycloak --region $AWS_REGION --query SecretString --output text | jq ."
echo ""
