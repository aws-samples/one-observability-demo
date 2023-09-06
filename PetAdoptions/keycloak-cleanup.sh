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
#usage           ./keycloak-cleanup.sh -c <EKS_CLUSTER_NAME> [-n|--keycloak-namespace <KEYCLOAK_NAMESPACE>] [-h|--help]
#==============================================================================

echo ---------------------------------------------------------------------------------------------
echo "This script cleans up keycloak related resources for Amazon Managed Grafana SAML authentication."
echo ---------------------------------------------------------------------------------------------

#### Resolve command line arguments
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    -c|--cluster-name)
      CLUSTER_NAME="$2"
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
  echo "    -c, --cluster-name string          Amazon EKS cluster name"
  echo "    -n, --keycloak-namespace string    Namespace for keycloak (default keycloak)"
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

function validate_arg_cluster_name() {
  if [ -z "$CLUSTER_NAME" ]; then
    handle_error_with_usage "ERROR: Amazon EKS cluster name is required." 2
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
  echo "  CLUSTER_NAME........$CLUSTER_NAME"
  echo "  KEYCLOAK_NAMESPACE..$KEYCLOAK_NAMESPACE"
  echo "---------------------------------------------------------------------------------------------"
  echo ""
}

function locate_eks_cluster() {
  echo "Searching Amazon EKS cluster with name '$CLUSTER_NAME'..."
  CLUSTER_META=$(aws eks describe-cluster --name $CLUSTER_NAME)
  CMD_RESULT=$?
  if [ -z "$CLUSTER_META" ] || [ $CMD_RESULT -ne 0 ] ; then
    handle_error "ERROR: Could not locate Amazon EKS cluster with name '$CLUSTER_NAME'. Please check error message." 3
  fi
  echo "Found Amazon EKS cluster."
}

function uninstall_keycloak() {
  echo "Uninstalling application 'keycloak'..."
  helm uninstall keycloak --namespace $KEYCLOAK_NAMESPACE
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to uninstall application 'keycloak'." 4
  fi

  echo "Deleting namespace '$KEYCLOAK_NAMESPACE'..."
  kubectl delete ns $KEYCLOAK_NAMESPACE
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to delete namespce '$KEYCLOAK_NAMESPACE'." 5
  fi
}

function remove_helm_repo() {
  echo "Removing helm repo 'bitnami'..."
  helm repo remove bitnami
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to remove helm repo 'bitnami'." 6
  fi
}

function uninstall_ebs_csi_driver_addon() {
  echo "Deleting EBS StorageClass..."
  kubectl delete -f storageclass.yaml
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to delete EBS StorageClass." 7
  fi

  echo "Uninstalling EBS CSI driver addon from cluster..."
  eksctl delete addon \
    --name aws-ebs-csi-driver \
    --cluster $CLUSTER_NAME
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to uninstall EBS CSI driver addon from cluster." 8
  fi

  echo "Waiting for EBS CSI driver addon deletion to complete..."
  aws eks wait addon-deleted \
    --cluster-name $CLUSTER_NAME \
    --addon-name aws-ebs-csi-driver
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to wait for EBS CSI driver addon deletion to complete." 9
  fi

  echo "Deleting IRSA for EBS CSI driver addon..."
  eksctl delete iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster $CLUSTER_NAME
  CMD_RESULT=$?
  if [ $CMD_RESULT -ne 0 ]; then
    handle_error "ERROR: Failed to delete IRSA for EBS CSI driver addon." 10
  fi
}

#### Main ####

handle_arg_help

validate_arg_cluster_name

resolve_arg_keycloak_namespace

print_script_arguments

locate_eks_cluster

uninstall_keycloak

remove_helm_repo

uninstall_ebs_csi_driver_addon

echo ""
echo "Cleanup done."