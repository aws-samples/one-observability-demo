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

#title           keycloak-setup.sh
#description     This script sets up keycloak related resources for Amazon Managed Grafana SAML authentication.
#author          Sourav Paul (@psour)
#contributors    @psour
#date            2023-09-06
#version         1.0
#usage           ./keycloak-setup.sh -c|--cluster-name <CLUSTER_NAME> -w|--workspace-name <WORKSPACE_NAME> [-a|--account-id <ACCOUNT_ID>] [-n|--keycloak-namespace <KEYCLOAK_NAMESPACE>] [-r|--keycloak-realm <KEYCLOAK_REALM>] [-h|--help]
#==============================================================================

echo ---------------------------------------------------------------------------------------------
echo "This script sets up keycloak related resources for Amazon Managed Grafana SAML authentication."
echo ---------------------------------------------------------------------------------------------

#### Resolve command line arguments
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    -a|--account-id)
      ACCOUNT_ID="$2"
      shift # past argument
      shift # past value
      ;;
    -c|--cluster-name)
      CLUSTER_NAME="$2"
      shift # past argument
      shift # past value
      ;;
    -w|--workspace-name)
      WORKSPACE_NAME="$2"
      shift # past argument
      shift # past value
      ;;
    -n|--keycloak-namespace)
      KEYCLOAK_NAMESPACE="$2"
      shift # past argument
      shift # past value
      ;;
    -r|--keycloak-realm)
      KEYCLOAK_REALM="$2"
      shift # past argument
      shift # past value
      ;;
    -h|--help)
      SHOW_HELP=YES
      shift # past argument
      ;;
    -*|--*)
      echo "Unknown option $1"
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1") # save positional arg
      shift # past argument
      ;;
  esac
done

#### Functions
function print_usage() {
  echo ""
  echo "Options:"
  echo "    -a, --account_id string            AWS account id (default inferred from ACCOUNT_ID environment variable or else by calling STS GetCallerIdentity)"
  echo "    -c, --cluster-name string          Amazon EKS cluster name"
  echo "    -w, --workspace-name string        Amazon Managed Grafana workspace name"
  echo "    -n, --keycloak-namespace string    Namespace for keycloak (default keycloak)"
  echo "    -r, --keycloak-realm string        Keycloak realm for Amazon Manaaged Grafana workspace (default amg)"
  echo "    -h, --help                         Show this help message"
}

function handle_error() {
  echo ""
  echo $1
  exit 1
}

function handle_error_with_usage() {
  echo ""
  echo $1
  echo ""
  echo "Printing help..."
  print_usage
  exit 1
}

function handle_arg_help() {
  if [ "$SHOW_HELP" = "YES" ]; then
    print_usage
    exit 0
  fi
}

function resolve_arg_account_id() {
  if [ -z "$ACCOUNT_ID" ]; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error_with_usage "ERROR: Failed to invoke STS GetCallerIdentity."
    fi
    if [ -z "$ACCOUNT_ID" ]; then
      handle_error_with_usage "ERROR: Could not infer ACCOUNT_ID."
    fi
  fi
}

function validate_arg_cluster_name() {
  if [ -z "$CLUSTER_NAME" ]; then
    handle_error_with_usage "ERROR: Amazon EKS cluster name is required."
  fi
}

function validate_arg_workspace_name() {
  if [ -z "$WORKSPACE_NAME" ]; then
    handle_error_with_usage "ERROR: Amazon Managed Grafana workspace name is required."
  fi
}

function resolve_arg_keycloak_namespace() {
  if [ -z "$KEYCLOAK_NAMESPACE" ]; then
    KEYCLOAK_NAMESPACE=keycloak
  fi
}

function resolve_arg_keycloak_realm() {
  if [ -z "$KEYCLOAK_REALM" ]; then
    KEYCLOAK_REALM=amg
  fi
}

function print_script_arguments() {
  echo ""
  echo "Script arguments:"
  echo "---------------------------------------------------------------------------------------------"
  echo "  ACCOUNT_ID..........$ACCOUNT_ID"
  echo "  CLUSTER_NAME........$CLUSTER_NAME"
  echo "  WORKSPACE_NAME......$WORKSPACE_NAME"
  echo "  KEYCLOAK_NAMESPACE..$KEYCLOAK_NAMESPACE"
  echo "  KEYCLOAK_REALM......$KEYCLOAK_REALM"
  echo "---------------------------------------------------------------------------------------------"
  echo ""
}

function locate_eks_cluster() {
  echo "Searching Amazon EKS cluster with name '$CLUSTER_NAME'..."
  CLUSTER_META=$(aws eks describe-cluster --name $CLUSTER_NAME)
  CMD_RESULT=$?
  if [ -z "$CLUSTER_META" ] || [ $CMD_RESULT -ne 0 ] ; then
    handle_error "ERROR: Could not locate Amazon EKS cluster with name '$CLUSTER_NAME'."
  fi
  echo "Found Amazon EKS cluster."
}

function locate_amg_workspace() {
  echo "Searching Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'..."
  WORKSPACE_ID=$(aws grafana list-workspaces --query 'workspaces[?name==`'$WORKSPACE_NAME'`].id' --output text)
  if [ -z "$WORKSPACE_ID" ]; then
    handle_error "ERROR: Could not locate Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'."
  fi
  echo "Found Amazon Managed Grafana workspace."
}

function wait_for_active_amg_workspace() {
  WORKSPACE_META=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe AMG workspace."
  fi
  WORKSPACE_STATUS=$(echo $WORKSPACE_META | jq -r '.workspace.status')
  while [ "$WORKSPACE_STATUS" != "ACTIVE" ]
  do
    echo "Workspace status is '$WORKSPACE_STATUS'. Waiting for 10 seconds."
    sleep 10
    WORKSPACE_META=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to describe AMG workspace."
    fi
    WORKSPACE_STATUS=$(echo $WORKSPACE_META | jq -r '.workspace.status')
  done

  WORKSPACE_ENDPOINT=$(echo $WORKSPACE_META | jq -r '.workspace.endpoint')
}

function install_ebs_csi_driver() {
  echo "Searching IRSA for EBS CSI driver addon..."
  IRSA=$(eksctl get iamserviceaccount --cluster $CLUSTER_NAME --namespace kube-system --name ebs-csi-controller-sa -o json | jq -r '.[].metadata.name')
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to query IRSA metadata for EBS CSI driver addon."
  fi

  if [ -z "$IRSA" ]; then
    echo "IRSA for EBS CSI driver addon will be created."
    eksctl create iamserviceaccount \
      --name ebs-csi-controller-sa \
      --namespace kube-system \
      --cluster $CLUSTER_NAME \
      --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
      --approve \
      --role-only \
      --role-name AmazonEKS_EBS_CSI_DriverRole
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to create IAM role for EBS CSI driver addon."
    fi
  else
    echo "Found IRSA for EBS CSI driver addon."
  fi

  echo "Searching if EBS CSI driver addon is installed in the cluster..."
  EBS_CSI_ADDON=$(aws eks list-addons --cluster-name $CLUSTER_NAME --query 'addons[?@==`aws-ebs-csi-driver`]' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list EKS addons."
  fi

  if [ -z "$EBS_CSI_ADDON" ]; then
    echo "The EBS CSI driver addon will be installed in the cluster."
    eksctl create addon \
      --name aws-ebs-csi-driver \
      --cluster $CLUSTER_NAME \
      --service-account-role-arn arn:aws:iam::$ACCOUNT_ID:role/AmazonEKS_EBS_CSI_DriverRole \
      --force
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to install EBS CSI driver addon."
    fi
    
    echo "Waiting for EBS CSI driver addon status to become 'ACTIVE'..."
    aws eks wait addon-active \
      --cluster-name $CLUSTER_NAME \
      --addon-name aws-ebs-csi-driver
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to wait on EBS CSI driver addon status to become 'ACTIVE'."
    fi
  else
    echo "Found EBS CSI driver addon is already installed in the cluster."
  fi

  EBS_SC=ebs-sc
  echo "Checking if StorageClass '$EBS_SC' exists..."
  CMD_OUT=$(kubectl get storageclass $EBS_SC -o jsonpath={.metadata.name} 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"NotFound"* )
        echo "StorageClass '$EBS_SC' will be created."
        CMD_OUT=$(cat <<EOF | kubectl apply -f - 2>&1
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: $EBS_SC
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
EOF
)
        CMD_RESULT=$?
        if [ $CMD_RESULT -ne 0 ]; then
          case "$CMD_OUT" in
            *"AlreadyExists"* )
              echo "WARNING: StorageClass '$EBS_SC' already exists. May be created by another concurrent process."
              ;;
            *)
              handle_error "ERROR: Failed to create EBS StorageClass '$EBS_SC'."
              ;;
          esac
        fi
        ;;
      *)
        handle_error "ERROR: Failed to check if StorageClass '$EBS_SC' exists."
        ;;
    esac
  else
    echo "StorageClass '$EBS_SC' already exists."
  fi
}

function check_helm() {
  echo "Checking if helm is installed."
  HELM_VER=$(helm version --short 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    echo "Helm will be installed."
    curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Could not download helm installation script."
    fi
    chmod 700 get_helm.sh
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Could not change file permissions of the downloaded helm installation script 'get_helm.sh'."
    fi
    ./get_helm.sh
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Helm installation failed with code $CMD_RESULT."
    fi
    echo "Removing helm installation script 'get_helm.sh'..."
    rm -rf get_helm.sh
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      echo "WARNING: Could not remove helm installation script 'get_helm.sh'. Please remove it manually."
    fi
  else
    echo "Helm $HELM_VER is installed."
  fi
}

function add_helm_repo() {
  REPO=$1
  REPO_URL=$2
  echo "Searching if helm repo '$REPO' is installed..."
  HELM_REPO=$(helm repo list -o json | jq -r ".[] | select(.name == \"$REPO\") | .name")
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list helm repo '$REPO'."
  fi
  if [ -z "$HELM_REPO" ]; then
    echo "Adding helm repo '$REPO'..."
    helm repo add $REPO $REPO_URL
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to add helm repo '$REPO'."
    fi
  else
    echo "Found helm repo '$REPO'."
  fi
}

function install_external_secrets() {
  echo "Searching if application 'external-secrets' is installed..."
  EXT_SECRET_REL=$(helm list -f external-secrets -n external-secrets -o json -q)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list application 'external-secrets'."
  fi
  
  if [ "$EXT_SECRET_REL" != "[]" ]; then
    echo "Application 'external-secrets' is already installed."
    return 0
  fi
  
  echo "Application 'external-secrets' will be installed."
  echo "---------------------------------------------------------------------------------------------"
  helm install external-secrets \
     external-secrets/external-secrets \
      -n external-secrets \
      --create-namespace
  CMD_RESULT=$?
  echo "---------------------------------------------------------------------------------------------"
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to execute helm install external-secrets."
  fi
}

function configure_keycloak_password() {
  echo "Checking saved keycloak password in AWS Secrets Manager..."
  SECRET_NAME="oneobservabilityworkshop/keycloak"
  SECRET_ARN=$(aws secretsmanager list-secrets --filters Key=name,Values=$SECRET_NAME Key=tag-key,Values=Project Key=tag-value,Values=OneObservabilityWorkshop --query "SecretList[0].ARN" --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to check saved keycloak password in AWS Secrets Manager."
  fi
  if [ "$SECRET_ARN" != "None" ]; then
    echo "Found saved keycloak password. Retrieving saved value..."
    KEYCLOAK_PASSWORDS=$(aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query "SecretString" --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to retrieve saved keycloak password from AWS Secrets Manager."
    fi
    KEYCLOAK_ADMIN_PASSWORD=$(echo $KEYCLOAK_PASSWORDS | jq -r '.["admin-password"]')
    KEYCLOAK_USER_ADMIN_PASSWORD=$(echo $KEYCLOAK_PASSWORDS | jq -r '.["user-admin-password"]')
    KEYCLOAK_USER_EDITOR_PASSWORD=$(echo $KEYCLOAK_PASSWORDS | jq -r '.["user-editor-password"]')
  else
    echo "Generating keycloak password..."
    KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -base64 8)
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to generate keycloak admin password."
    fi
    KEYCLOAK_USER_ADMIN_PASSWORD=$(openssl rand -base64 8)
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to generate keycloak user admin password."
    fi
    KEYCLOAK_USER_EDITOR_PASSWORD=$(openssl rand -base64 8)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to generate keycloak user editor password."
    fi
    echo "Saving generated keycloak passwords in AWS Secrets Manager..."
    SECRET_ARN=$(aws secretsmanager create-secret --name $SECRET_NAME --secret-string "{\"admin-password\":\"$KEYCLOAK_ADMIN_PASSWORD\",\"user-admin-password\":\"$KEYCLOAK_USER_ADMIN_PASSWORD\",\"user-editor-password\":\"$KEYCLOAK_USER_EDITOR_PASSWORD\"}" --tags "Key=Project,Value=OneObservabilityWorkshop" --query "ARN" --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to save generated keycloak passwords in AWS Secrets Manager."
    fi
  fi
}

function configure_keycloak_externalsecret() {
  echo "Checking existing IAM policy information for keycloak SecretStore..."
  POLICY_ARN=$(aws iam get-policy --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/keycloak-secretstore-policy" --query "Policy.Arn" --output text 2>&1)
  CMD_RESULT=$?
  if [[ $CMD_RESULT -ne 0 ]] && [[ "$POLICY_ARN" =~ ^.*(NoSuchEntity).*$ ]]; then
    echo "Creating new IAM policy for keycloak SecretStore..."
    KEYCLOAK_IAM_POLICY_DOC=$(cat <<EOF | jq --compact-output -r '.'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": "arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:oneobservabilityworkshop/keycloak-*"
        }
    ]
}
EOF
)
    POLICY_ARN=$(aws iam create-policy --policy-name OneObservabilityWorkshopKeycloakSecretStorePolicy --policy-document "$KEYCLOAK_IAM_POLICY_DOC" --tags Key=Project,Value=OneObservabilityWorkshop --query "Policy.Arn" --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to create new IAM policy for keycloak SecretStore."
    fi
  elif [[ $CMD_RESULT -ne 0 ]]; then
    handle_error "ERROR: Failed to check existing IAM policy information for keycloak SecretStore."
  fi
  
  echo "Checking if namespace '$KEYCLOAK_NAMESPACE' exists..."
  CMD_OUT=$(kubectl get ns keycloak -o jsonpath={.metadata.name} 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"NotFound"* )
        echo "Namespace '$KEYCLOAK_NAMESPACE' will be created."
        CMD_OUT=$(kubectl create ns $KEYCLOAK_NAMESPACE 2>&1)
        CMD_RESULT=$?
        if [ $CMD_RESULT -ne 0 ]; then
          case "$CMD_OUT" in
            *"AlreadyExists"* )
              echo "WARNING: Namespace '$KEYCLOAK_NAMESPACE' already exists. May be created by another concurrent process."
              ;;
            *)
              handle_error "ERROR: Failed to create namespace '$KEYCLOAK_NAMESPACE'."
              ;;
          esac
        fi
        ;;
      *)
        handle_error "ERROR: Failed to check if namespace '$KEYCLOAK_NAMESPACE' exists."
        ;;
    esac
  else
    echo "Namespace '$KEYCLOAK_NAMESPACE' exists."
  fi
  
  echo "Searching IRSA for keycloak SecretStore..."
  IRSA=$(eksctl get iamserviceaccount --cluster $CLUSTER_NAME --namespace $KEYCLOAK_NAMESPACE --name keycloaksecretstore -o json | jq -r '.[].metadata.name')
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to query IRSA metadata for keycloak SecretStore."
  fi
  
  if [ -z "$IRSA" ]; then
    echo "Creating IRSA for keycloak SecretStore"
    eksctl create iamserviceaccount \
      --name keycloaksecretstore \
      --namespace $KEYCLOAK_NAMESPACE \
      --cluster $CLUSTER_NAME \
      --role-name "KeycloakSecretStore" \
      --attach-policy-arn "$POLICY_ARN" \
      --approve \
      --override-existing-serviceaccounts
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to create service account for keycloak SecretStore."
    fi
  else
    echo "Found IRSA for keycloak SecretStore"
  fi
  
  echo "Checking existing keycloak SecretStore..."
  CMD_OUT=$(kubectl get secretstore keycloak -n $KEYCLOAK_NAMESPACE -o jsonpath={.metadata.name} 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *NotFound* )
        echo "Keycloak SecretStore will be created."
        cat<<EOF | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: keycloak
  namespace: $KEYCLOAK_NAMESPACE
spec:
  provider:
    aws:
      service: SecretsManager
      region: $AWS_REGION
      auth:
        jwt:
          serviceAccountRef:
            name: keycloaksecretstore
EOF

        CMD_RESULT=$?
        if [ $CMD_RESULT -ne 0 ]; then
          handle_error "ERROR: Failed to create keycloak SecretStore."
        fi
        ;;
      *)
        handle_error "ERROR: Failed to check existing keycloak SecretStore."
        ;;
    esac
  else
    echo "Found existing keycloak SecretStore."
  fi
  
  echo "Checking existing keycloak ExternalSecret..."
  CMD_OUT=$(kubectl get externalsecret keycloak -n keycloak -o jsonpath={.metadata.name} 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *NotFound* )
        echo "Creating keycloak ExternalSecret..."
        cat <<EOF | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: keycloak
  namespace: $KEYCLOAK_NAMESPACE
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: keycloak
    kind: SecretStore
  target:
    name: keycloak
    creationPolicy: Owner
  data:
  - secretKey: admin-password
    remoteRef:
      key: oneobservabilityworkshop/keycloak
      property: admin-password
EOF
  
        CMD_RESULT=$?
        if [ $CMD_RESULT -ne 0 ]; then
          handle_error "ERROR: Failed to create keycloak ExternalSecret."
        fi
        ;;
      *)
        handle_error "ERROR: Failed to check existing keycloak ExternalSecret."
        ;;
    esac
  else
    echo "Found existing keycloak ExternalSecret."
  fi
}

function install_keycloak() {
  echo "Searching if application 'keycloak' is already installed..."
  KEYCLOAK_REL=$(helm list -f keycloak -n keycloak -o json -q)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list application 'keycloak'."
  fi
  
  if [ "$KEYCLOAK_REL" != "[]" ]; then
    echo "Application 'keycloak' is already installed."
    return 0
  fi
  
  echo "Application 'keycloak' will be installed."
  
  echo "Generating keycloak chart values..."
  KEYCLOAK_HELM_VALUES=$(cat <<EOF
global:
  storageClass: "ebs-sc"
image:
  registry: public.ecr.aws
  repository: bitnami/keycloak
  tag: 22.0.1-debian-11-r36
  debug: true
auth:
  adminUser: admin
  existingSecret: keycloak
  passwordSecretKey: admin-password
service:
  type: LoadBalancer
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip
  http:
    enabled: true
  ports:
    http: 80
EOF
)

  echo "Executing helm install keycloak..."
  echo "---------------------------------------------------------------------------------------------"
  echo "$KEYCLOAK_HELM_VALUES" | helm install keycloak bitnami/keycloak \
    --namespace $KEYCLOAK_NAMESPACE \
    -f -
  CMD_RESULT=$?
  echo "---------------------------------------------------------------------------------------------"
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to execute helm install keycloak."
  fi
}

function configure_keycloak() {
  echo "Configuring keycloak..."
  REALM_JSON=$(cat <<EOF
{
  "realm": "$KEYCLOAK_REALM",
  "enabled": true,
  "sslRequired": "none",
  "roles": {
    "realm": [
      {
        "name": "admin"
      },
      {
        "name": "editor"
      }
    ]
  },
  "users": [
    {
      "username": "admin",
      "email": "admin@keycloak",
      "enabled": true,
      "firstName": "Admin",
      "realmRoles": [
         "admin"
      ]
    },
    {
      "username": "editor",
      "email": "editor@keycloak",
      "enabled": true,
      "firstName": "Editor",
      "realmRoles": [
        "editor"
      ]
    }
  ],
  "clients": [
    {
      "clientId": "https://${WORKSPACE_ENDPOINT}/saml/metadata",
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
EOF
)
  CMD="unset HISTFILE\n
if [ -f /tmp/realm.json ]; then\n
  echo \"WARNING: Found existing realm configuration file in the container. May be from a previous install. Skipping configuration.\"\n
  exit 0\n
fi\n
cat >/tmp/realm.json <<EOF\n$(echo -e "$REALM_JSON")\nEOF\n
while true; do\n
  STATUS=\$(curl -ifs http://localhost:8080/ 2>/dev/null | head -1)\n
  if [[ ! -z \"\$STATUS\" ]] && [[ \"\$STATUS\" == *\"200\"* ]]; then\n
    cd /opt/bitnami/keycloak/bin\n
    ./kcadm.sh config credentials --server http://localhost:8080/ --realm master --user admin --password \"$KEYCLOAK_ADMIN_PASSWORD\" --config /tmp/kcadm.config\n
    ./kcadm.sh update realms/master -s sslRequired=NONE --config /tmp/kcadm.config\n
    ./kcadm.sh create realms -f /tmp/realm.json --config /tmp/kcadm.config\n
    USER_ID=\$(./kcadm.sh get users -r $KEYCLOAK_REALM -q username=admin --fields id --config /tmp/kcadm.config 2>/dev/null | cut -d' ' -f5 | cut -d'\"' -f2 | tr -d '\\\n')\n
    ./kcadm.sh update users/\$USER_ID -r $KEYCLOAK_REALM -s 'credentials=[{\"type\":\"password\",\"value\":\"$KEYCLOAK_USER_ADMIN_PASSWORD\"}]' --config /tmp/kcadm.config\n
    USER_ID=\$(./kcadm.sh get users -r $KEYCLOAK_REALM -q username=editor --fields id --config /tmp/kcadm.config 2>/dev/null | cut -d' ' -f5 | cut -d'\"' -f2 | tr -d '\\\n')\n
    ./kcadm.sh update users/\$USER_ID -r $KEYCLOAK_REALM -s 'credentials=[{\"type\":\"password\",\"value\":\"$KEYCLOAK_USER_EDITOR_PASSWORD\"}]' --config /tmp/kcadm.config\n
    break\n
  fi\n
  echo \"Keycloak admin server not available. Waiting for 10 seconds...\"\n
  sleep 10\n
done;"
  echo "Checking keycloak pod status..."
  POD_PHASE=$(kubectl get pod keycloak-0 -n keycloak -o jsonpath={.status.phase})
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to check keycloak pod status."
  fi
  while [ "$POD_PHASE" != "Running" ]
  do
    echo "Keycloak pod status is '$POD_PHASE'. Waiting for 10 seconds."
    sleep 10
    POD_PHASE=$(kubectl get pod keycloak-0 -n keycloak -o jsonpath={.status.phase})
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to check keycloak pod status."
    fi
  done
  kubectl exec -it keycloak-0 -n keycloak -- /bin/bash -c "$(echo -e $CMD)"
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to configure keycloak."
  fi
}

function wait_for_load_balancer() {
  echo "Checking Target Group health..."

  LB_ARN=$(aws elbv2 describe-load-balancers --query 'LoadBalancers[?contains(LoadBalancerArn, `loadbalancer/net/k8s-keycloak-keycloak-`)].LoadBalancerArn' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak load balancer."
  fi

  TARGET_GRP_ARN=$(aws elbv2 describe-target-groups --load-balancer-arn $LB_ARN --query 'TargetGroups[0].TargetGroupArn' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak target group."
  fi

  TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak target health."
  fi

  while [ "$TARGET_HEALTH" != "healthy" ]
  do
    echo "Target health is $TARGET_HEALTH. Waiting 10 seconds."
    sleep 10
    TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to describe keycloak target health."
    fi
  done

  echo "Target health is $TARGET_HEALTH."

  ELB_HOSTNAME=$(kubectl get service/keycloak \
    -n $KEYCLOAK_NAMESPACE \
    --output go-template \
    --template='{{range .status.loadBalancer.ingress}}{{.hostname}}{{end}}')
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to get load balancer hostname."
  fi

  SAML_URL=http://$ELB_HOSTNAME/realms/$KEYCLOAK_REALM/protocol/saml/descriptor
}

function update_workspace_saml_auth() {
  EXPECTED_SAML_CONFIG=$(cat <<EOF | jq --sort-keys -r '.'
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
    "admin": [
      "admin"
    ],
    "editor": [
      "editor"
    ]
  }
}
EOF
)
  echo "Retrieving AMG workspace authentication configuration..."
  WORKSPACE_AUTH_CONFIG=$(aws grafana describe-workspace-authentication --workspace-id $WORKSPACE_ID)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to retrieve AMG workspace SAML authentication configuration."
  fi
  echo "Checking if SAML authentication is configured..."
  AUTH_PROVIDERS=$(echo $WORKSPACE_AUTH_CONFIG | jq --compact-output -r '.authentication.providers')
  SAML_INDEX=$(echo $WORKSPACE_AUTH_CONFIG | jq -r '.authentication.providers | index("SAML")')
  if [ "$SAML_INDEX" != "null" ]; then
    echo "Parsing actual SAML authentication configuration..."
    ACTUAL_SAML_CONFIG=$(echo $WORKSPACE_AUTH_CONFIG | jq --sort-keys -r '.authentication.saml.configuration | {assertionAttributes: .assertionAttributes, idpMetadata: .idpMetadata, loginValidityDuration: .loginValidityDuration, roleValues: .roleValues}')
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to JSON parse AMG workspace SAML authentication configuration."
    fi
    echo "Comparing actual SAML authentication configuration with expected configuration..."
    DIFF=$(diff <(echo "$EXPECTED_SAML_CONFIG") <(echo "$ACTUAL_SAML_CONFIG"))
    CMD_RESULT=$?
    if [ $CMD_RESULT -eq 0 ]; then
      echo "AMG workspace SAML authentication configuration matches expected configuration."
      return 0
    fi
    echo "AMG workspace SAML authentication configuration does not match expected configuration."
    echo "Configuration will be updated."
  else
    echo "AMG workspace is not configured for SAML authentication."
  fi
  
  echo "Generating AMG workspace SAML authentication input configuration..."
  MERGED_AUTH_PROVIDERS=$(jq --compact-output --argjson arr1 "$AUTH_PROVIDERS" --argjson arr2 '["SAML"]' -n '$arr1 + $arr2 | unique_by(.)')
  WORKSPACE_AUTH_SAML_INPUT_CONFIG=$(cat <<EOF | jq --compact-output -r '.'
{
    "authenticationProviders": $MERGED_AUTH_PROVIDERS,
    "samlConfiguration":
        ${EXPECTED_SAML_CONFIG},
    "workspaceId": "${WORKSPACE_ID}"
}
EOF
)

  echo "Updating AMG workspace SAML authentication..."
  WORKSPACE_AUTH_SAML_STATUS=$(aws grafana update-workspace-authentication \
    --cli-input-json "$WORKSPACE_AUTH_SAML_INPUT_CONFIG" --query "authentication.saml.status" --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to update AMG workspace SAML authentication."
  fi
  echo "AMG workspace SAML authentication status: $WORKSPACE_AUTH_SAML_STATUS"
}

#### Main ####

handle_arg_help

resolve_arg_account_id

validate_arg_cluster_name

validate_arg_workspace_name

resolve_arg_keycloak_namespace

resolve_arg_keycloak_realm

print_script_arguments

locate_eks_cluster

locate_amg_workspace

wait_for_active_amg_workspace

install_ebs_csi_driver

check_helm

add_helm_repo "external-secrets" "https://charts.external-secrets.io"

install_external_secrets

configure_keycloak_password

configure_keycloak_externalsecret

add_helm_repo "bitnami" "https://charts.bitnami.com/bitnami"

install_keycloak

configure_keycloak

wait_for_load_balancer

update_workspace_saml_auth

echo ""
echo "-------------------"
echo "Workspace endpoint: https://$WORKSPACE_ENDPOINT/"
echo "-------------------"
echo "Admin credentials"
echo "-------------------"
echo "username: admin"
echo "password: $KEYCLOAK_USER_ADMIN_PASSWORD"
echo ""
echo "**Note:** Retrieve saved workspace admin user password from AWS Secrets Manager by running following command."
echo "aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query \"SecretString\" --output text | jq -r '.[\"user-admin-password\"]'"
echo ""
echo "-------------------"
echo "Editor credentials"
echo "-------------------"
echo "username: editor"
echo "password: $KEYCLOAK_USER_EDITOR_PASSWORD"
echo ""
echo "**Note:** Retrieve saved workspace editor user password from AWS Secrets Manager by running following command."
echo "aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query \"SecretString\" --output text | jq -r '.[\"user-editor-password\"]'"
echo ""
echo "Setup done."