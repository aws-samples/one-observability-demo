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

#title           keycloak-cleanup.sh
#description     This script cleans up keycloak related resources for Amazon Managed Grafana SAML authentication.
#author          Sourav Paul (@psour)
#contributors    @psour
#date            2023-09-06
#version         1.0
#usage           ./keycloak-cleanup.sh -c <EKS_CLUSTER_NAME> -w|--workspace-name <WORKSPACE_NAME> [-a|--account-id <ACCOUNT_ID>] [-n|--keycloak-namespace <KEYCLOAK_NAMESPACE>] [-h|--help]
#==============================================================================

echo ---------------------------------------------------------------------------------------------
echo "This script cleans up keycloak related resources for Amazon Managed Grafana SAML authentication."
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

function print_script_arguments() {
  echo ""
  echo "Script arguments:"
  echo "---------------------------------------------------------------------------------------------"
  echo "  ACCOUNT_ID..........$ACCOUNT_ID"
  echo "  CLUSTER_NAME........$CLUSTER_NAME"
  echo "  WORKSPACE_NAME......$WORKSPACE_NAME"
  echo "  KEYCLOAK_NAMESPACE..$KEYCLOAK_NAMESPACE"
  echo "---------------------------------------------------------------------------------------------"
  echo ""
}

function locate_eks_cluster() {
  echo "Searching Amazon EKS cluster with name '$CLUSTER_NAME'..."
  CLUSTER_META=$(aws eks describe-cluster --name $CLUSTER_NAME)
  CMD_RESULT=$?
  if [ -z "$CLUSTER_META" ] || [ $CMD_RESULT -ne 0 ] ; then
    handle_error "ERROR: Could not locate Amazon EKS cluster with name '$CLUSTER_NAME'. Please check error message."
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
}

function remove_workspace_saml_auth() {
  echo "Retrieving AMG workspace authentication configuration..."
  WORKSPACE_AUTH_CONFIG=$(aws grafana describe-workspace-authentication --workspace-id $WORKSPACE_ID)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to retrieve AMG workspace SAML authentication configuration."
  fi
  echo "Removing SAML authentication configuration..."
  AUTH_PROVIDERS=$(echo $WORKSPACE_AUTH_CONFIG | jq --compact-output -r '.authentication.providers')
  MERGED_AUTH_PROVIDERS=$(jq --compact-output --argjson arr1 "$AUTH_PROVIDERS" --argjson arr2 '["SAML"]' -n '$arr1 - $arr2 | unique_by(.)')
  echo "Generating AMG workspace authentication input configuration..."
  WORKSPACE_AUTH_SAML_INPUT_CONFIG=$(cat <<EOF | jq --compact-output -r '.'
{
    "authenticationProviders": $MERGED_AUTH_PROVIDERS,
    "workspaceId": "${WORKSPACE_ID}"
}
EOF
)
  echo "Updating AMG workspace SAML authentication..."
  aws grafana update-workspace-authentication --cli-input-json "$WORKSPACE_AUTH_SAML_INPUT_CONFIG"
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to update AMG workspace SAML authentication."
  fi
}

function uninstall_keycloak() {
  echo "Uninstalling application 'keycloak'..."
  CMD_OUT=$(helm uninstall keycloak --namespace $KEYCLOAK_NAMESPACE 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"not found"* )
        ;;
      *)
        handle_error "ERROR: Failed to uninstall application 'keycloak'."
        ;;
    esac
  fi
}

function delete_keycloak_secrets() {
  echo "Deleting Keycloak ExternalSecret..."
  CMD_OUT=$(kubectl delete ExternalSecret keycloak -n $KEYCLOAK_NAMESPACE 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"doesn't"* | *NotFound* )
        ;;
      *)
        handle_error "ERROR: Failed to delete Keycloak ExternalSecret."
        ;;
    esac
  fi
  echo "Deleting Keycloak SecretStore..."
  CMD_OUT=$(kubectl delete SecretStore keycloak -n $KEYCLOAK_NAMESPACE 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"doesn't"* | *NotFound* )
        ;;
      *)
        handle_error "ERROR: Failed to delete Keycloak SecretStore."
        ;;
    esac
  fi
  
  echo "Deleting IRSA for Keycloak SecretStore..."
  eksctl delete iamserviceaccount \
    --name keycloaksecretstore \
    --namespace $KEYCLOAK_NAMESPACE \
    --cluster $CLUSTER_NAME
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to delete IRSA for Keycloak SecretStore."
  fi
  
  sleep 10
  echo "Deleting IAM policy for Keycloak SecretStore..."
  CMD_OUT=$(aws iam delete-policy --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/OneObservabilityWorkshopKeycloakSecretStorePolicy" 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    echo $CMD_OUT
    case "$CMD_OUT" in
      *NoSuchEntity* )
        ;;
      *)
        handle_error "ERROR: Failed to delete IAM policy for Keycloak SecretStore."
        ;;
    esac
  fi
  
  echo "Deleting namespace '$KEYCLOAK_NAMESPACE'..."
  CMD_OUT=$(kubectl delete ns $KEYCLOAK_NAMESPACE 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"doesn't"* | *NotFound* )
        ;;
      *)
        handle_error "ERROR: Failed to delete namespce '$KEYCLOAK_NAMESPACE'."
        ;;
    esac
  fi
  
  echo "Checking saved keycloak password in AWS Secrets Manager..."
  SECRET_NAME="oneobservabilityworkshop/keycloak"
  SECRET_ARN=$(aws secretsmanager list-secrets --filters Key=name,Values=$SECRET_NAME Key=tag-key,Values=Project Key=tag-value,Values=OneObservabilityWorkshop --query "SecretList[0].ARN" --output text)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to check saved keycloak password in AWS Secrets Manager."
  fi
  if [ "$SECRET_ARN" != "None" ]; then
    echo "Found saved keycloak password. Deleting saved value..."
    aws secretsmanager delete-secret --secret-id $SECRET_ARN --force-delete-without-recovery
    CMD_RESULT=$?
    if [ $CMD_RESULT -ne 0 ]; then
      handle_error "ERROR: Failed to delete saved keycloak password from AWS Secrets Manager."
    fi
  fi
}

function uninstall_external_secrets() {
  echo "Uninstalling application 'external-secrets'..."
  CMD_OUT=$(helm uninstall external-secrets --namespace external-secrets 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"not found"* )
        ;;
      *)
        handle_error "ERROR: Failed to uninstall application 'external-secrets'."
        ;;
    esac
  fi
  
  echo "Deleting namespace 'external-secrets'..."
  CMD_OUT=$(kubectl delete ns external-secrets 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"doesn't"* | *NotFound* )
        ;;
      *)
        handle_error "ERROR: Failed to delete namespce 'external-secrets'."
        ;;
    esac
  fi
}

function remove_helm_repo() {
  REPO=$1
  echo "Removing helm repo '$REPO'..."
  CMD_OUT=$(helm repo remove $REPO 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"no repo"* )
        ;;
      *)
        handle_error "ERROR: Failed to remove helm repo '$REPO'."
        ;;
    esac
  fi
}

function uninstall_ebs_csi_driver_addon() {
  echo "Deleting EBS StorageClass..."
  CMD_OUT=$(kubectl delete StorageClass ebs-sc 2>&1)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"NotFound"* )
        ;;
      *)
        handle_error "ERROR: Failed to delete EBS StorageClass 'ebs-sc'."
        ;;
    esac
  fi

  echo "Uninstalling EBS CSI driver addon from cluster..."
  CMD_OUT=$(eksctl delete addon \
    --name aws-ebs-csi-driver \
    --cluster $CLUSTER_NAME 2>&1 > /dev/null)
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    case "$CMD_OUT" in
      *"could not find addon"* )
        ;;
      *)
        handle_error "ERROR: Failed to uninstall EBS CSI driver addon from cluster."
        ;;
    esac
  fi

  echo "Waiting for EBS CSI driver addon deletion to complete..."
  aws eks wait addon-deleted \
    --cluster-name $CLUSTER_NAME \
    --addon-name aws-ebs-csi-driver
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to wait for EBS CSI driver addon deletion to complete."
  fi

  echo "Deleting IRSA for EBS CSI driver addon..."
  eksctl delete iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster $CLUSTER_NAME
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to delete IRSA for EBS CSI driver addon."
  fi
}

#### Main ####

handle_arg_help

resolve_arg_account_id

validate_arg_cluster_name

validate_arg_workspace_name

resolve_arg_keycloak_namespace

print_script_arguments

locate_eks_cluster

locate_amg_workspace

wait_for_active_amg_workspace

remove_workspace_saml_auth

uninstall_keycloak

delete_keycloak_secrets

remove_helm_repo "bitnami"

uninstall_external_secrets

remove_helm_repo "external-secrets"

uninstall_ebs_csi_driver_addon

echo ""
echo "Cleanup done."