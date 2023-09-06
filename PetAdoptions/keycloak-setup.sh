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
  echo ""
  echo "Exiting script with code: $2..."
  exit $2
}

function handle_error_with_usage() {
  echo ""
  echo $1
  echo ""
  echo "Printing help..."
  print_usage
  echo ""
  echo "Exiting script with code: $2..."
  echo ""
  exit $2
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
      handle_error_with_usage "ERROR: Failed to invoke STS GetCallerIdentity." 2
    fi
    if [ -z "$ACCOUNT_ID" ]; then
      handle_error_with_usage "ERROR: Could not infer ACCOUNT_ID." 3
    fi
  fi
}

function validate_arg_cluster_name() {
  if [ -z "$CLUSTER_NAME" ]; then
    handle_error_with_usage "ERROR: Amazon EKS cluster name is required." 4
  fi
}

function validate_arg_workspace_name() {
  if [ -z "$WORKSPACE_NAME" ]; then
    handle_error_with_usage "ERROR: Amazon Managed Grafana workspace name is required." 5
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
    handle_error "ERROR: Could not locate Amazon EKS cluster with name '$CLUSTER_NAME'." 6
  fi
  echo "Found Amazon EKS cluster."
}

function locate_amg_workspace() {
  echo "Searching Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'..."
  WORKSPACE_ID=$(aws grafana list-workspaces --query 'workspaces[?name==`'$WORKSPACE_NAME'`].id' --output text)
  if [ -z "$WORKSPACE_ID" ]; then
    handle_error "ERROR: Could not locate Amazon Managed Grafana workspace with name '$WORKSPACE_NAME'." 7
  fi
  echo "Found Amazon Managed Grafana workspace."
}

function wait_for_active_amg_workspace() {
  WORKSPACE_META=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe AMG workspace." 8
  fi
  WORKSPACE_STATUS=$(echo $WORKSPACE_META | jq -r '.workspace.status')
  while [ "$WORKSPACE_STATUS" != "ACTIVE" ]
  do
    echo "Workspace status is '$WORKSPACE_STATUS'. Waiting for 10 seconds."
    sleep 10
    WORKSPACE_META=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to describe AMG workspace." 8
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
    handle_error "ERROR: Failed to query IRSA metadata for EBS CSI driver addon." 9
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
      handle_error "ERROR: Failed to create IAM role for EBS CSI driver addon." 10
    fi
  else
    echo "Found IRSA for EBS CSI driver addon."
  fi

  echo "Searching if EBS CSI driver addon is installed in the cluster..."
  EBS_CSI_ADDON=$(aws eks list-addons --cluster-name $CLUSTER_NAME --query 'addons[?@==`aws-ebs-csi-driver`]' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list EKS addons." 11
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
      handle_error "ERROR: Failed to install EBS CSI driver addon." 12
    fi
    
    echo "Waiting for EBS CSI driver addon status to become 'ACTIVE'..."
    aws eks wait addon-active \
      --cluster-name $CLUSTER_NAME \
      --addon-name aws-ebs-csi-driver
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to wait on EBS CSI driver addon status to become 'ACTIVE'." 13
    fi
  else
    echo "Found EBS CSI driver addon is already installed in the cluster."
  fi

  echo "Creating EBS StorageClass..."
  cat >storageclass.yaml <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
EOF

  kubectl apply -f storageclass.yaml
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to create EBS StorageClass." 14
  fi
}

function add_helm_repo() {
  echo "Searching if helm repo 'bitnami' is installed..."
  HELM_REPO=$(helm repo list -o json | jq -r '.[] | select(.name == "bitnami") | .name')
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list helm repo 'bitnami'." 15
  fi
  if [ -z "$HELM_REPO" ]; then
    echo "Adding helm repo 'bitnami'..."
    helm repo add bitnami https://charts.bitnami.com/bitnami
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to add helm repo 'bitnami'." 16
    fi
  else
    echo "Found helm repo 'bitnami'."
  fi
}

function install_upgrade_keycloak() {
  echo "Searching if application 'keycloak' is installed..."
  KEYCLOAK_REL=$(helm list -f keycloak -n keycloak -o json -q)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to list application 'keycloak'." 17
  fi

  if [ "$KEYCLOAK_REL" != "[]" ]; then
    echo "Application 'keycloak' is installed. Upgrade will be performed."
    HELM_ACTION=upgrade
  else
    echo "Application 'keycloak' will be installed."
    HELM_ACTION=install
  fi

  echo "Generating keycloak password..."
  KEYCLOAK_PASSWORD=$(openssl rand -base64 8)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to generate keycloak password." 18
  fi

  echo "Generating keycloak configuration..."
  cat > keycloak_values.yaml <<EOF
global:
  storageClass: "ebs-sc"
image:
  registry: public.ecr.aws
  repository: bitnami/keycloak
  tag: 22.0.1-debian-11-r36
  debug: true
auth:
  adminUser: admin
  adminPassword: "$KEYCLOAK_PASSWORD"
initdbScripts:
  prep.sh: |
    #!/bin/bash
    cat > /tmp/disable_ssl.sh <<EOT
    #!/bin/bash
    while true; do
      STATUS=\\\$(curl -ifs http://localhost:8080/ | head -1)
      if [[ ! -z "\\\$STATUS" ]] && [[ "\\\$STATUS" == *"200"* ]]; then
        cd /opt/bitnami/keycloak/bin
        ./kcadm.sh config credentials --server http://localhost:8080/ --realm master --user admin --password "$KEYCLOAK_PASSWORD" --config /tmp/kcadm.config 
        ./kcadm.sh update realms/master -s sslRequired=NONE --config /tmp/kcadm.config
        break
      fi
      sleep 10
    done;
    EOT
    chmod +x /tmp/disable_ssl.sh
    nohup /tmp/disable_ssl.sh </dev/null >/dev/null 2>&1 &
    
keycloakConfigCli:
  enabled: true
  image:
    registry: public.ecr.aws
    repository: bitnami/keycloak-config-cli
    tag: 5.8.0-debian-11-r37
  command:
  - java
  - -jar
  - /opt/keycloak-config-cli.jar
  configuration:
    realm.json: |
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
            ],
            "credentials": [
              {
                "type": "password",
                "value": "$KEYCLOAK_PASSWORD"
              }
            ]
          },
          {
            "username": "editor",
            "email": "editor@keycloak",
            "enabled": true,
            "firstName": "Editor",
            "realmRoles": [
              "editor"
            ],
            "credentials": [
              {
                "type": "password",
                "value": "$KEYCLOAK_PASSWORD"
              }
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

  echo "Executing helm $HELM_ACTION keycloak..."
  helm $HELM_ACTION keycloak bitnami/keycloak \
    --create-namespace \
    --namespace $KEYCLOAK_NAMESPACE \
    -f keycloak_values.yaml
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to execute helm $HELM_ACTION keycloak." 19
  fi
}

function wait_for_load_balancer() {
  echo "Checking Target Group health..."

  LB_ARN=$(aws elbv2 describe-load-balancers --query 'LoadBalancers[?contains(LoadBalancerArn, `loadbalancer/net/k8s-keycloak-keycloak-`)].LoadBalancerArn' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak load balancer." 20
  fi

  TARGET_GRP_ARN=$(aws elbv2 describe-target-groups --load-balancer-arn $LB_ARN --query 'TargetGroups[0].TargetGroupArn' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak target group." 21
  fi

  TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to describe keycloak target health." 22
  fi

  while [ "$TARGET_HEALTH" != "healthy" ]
  do
    echo "Target health is $TARGET_HEALTH. Waiting 10 seconds."
    sleep 10
    TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to describe keycloak target health." 22
    fi
  done

  echo "Target health is $TARGET_HEALTH."

  ELB_HOSTNAME=$(kubectl get service/keycloak \
    -n $KEYCLOAK_NAMESPACE \
    --output go-template \
    --template='{{range .status.loadBalancer.ingress}}{{.hostname}}{{end}}')
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to get load balancer hostname." 23
  fi

  SAML_URL=http://$ELB_HOSTNAME/realms/$KEYCLOAK_REALM/protocol/saml/descriptor
}

function update_workspace_saml_auth() {
  echo "Generating workspace SAML authentication configuration..."
  cat >workspace-saml-auth-config.json <<EOF
{
    "authenticationProviders": [
        "SAML"
    ],
    "samlConfiguration": {
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
    },
    "workspaceId": "${WORKSPACE_ID}"
}
EOF

  echo "Updating workspace SAML authentication..."
  aws grafana update-workspace-authentication \
    --cli-input-json file://workspace-saml-auth-config.json
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to update AMG workspace SAML authentication." 24
  fi
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

add_helm_repo

install_upgrade_keycloak

wait_for_load_balancer

update_workspace_saml_auth

echo ""
echo "-------------------"
echo "Workspace endpoint: https://$WORKSPACE_ENDPOINT/"
echo "-------------------"
echo "Admin credentials"
echo "-------------------"
echo "username: admin"
echo "password: $KEYCLOAK_PASSWORD"
echo ""
echo "-------------------"
echo "Editor credentials"
echo "-------------------"
echo "username: editor"
echo "password: $KEYCLOAK_PASSWORD"
echo ""
echo "Setup done."