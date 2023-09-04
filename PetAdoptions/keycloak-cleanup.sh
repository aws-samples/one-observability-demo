#!/bin/bash

echo "This script cleans up keycloak related resources for Amazon Managed Grafana SAML authentication."

export CLUSTER_NAME=PetSite
export KEYCLOAK_NAMESPACE=keycloak

echo "Uninstall keycloak..."
helm uninstall keycloak --namespace $KEYCLOAK_NAMESPACE
echo "Delete keycloak namespace..."
kubectl delete ns $KEYCLOAK_NAMESPACE

echo "Remove bitnami helm repo..."
helm repo remove bitnami

echo "Delete EBS CSI StorageClass..."
kubectl delete -f storageclass.yaml

echo "Delete EBS CSI addon..."
eksctl delete addon \
    --name aws-ebs-csi-driver \
    --cluster $CLUSTER_NAME

echo "Wait for addone deletion..."
aws eks wait addon-deleted \
    --cluster-name $CLUSTER_NAME \
    --addon-name aws-ebs-csi-driver

echo "Delete IRSA for EBS CSI addon..."
eksctl delete iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster $CLUSTER_NAME

echo ""
echo "Cleanup done."