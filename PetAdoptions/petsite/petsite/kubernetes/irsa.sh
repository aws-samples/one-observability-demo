#!/bin/bash

# ****************************************************************************************
# WARNING: DO NOT USE. THIS SCRIPT IS INCOMPLETE AND EXPERIMENTAL. IT DOES NOT WORK
# ****************************************************************************************

ISSUER_URL=$(aws eks describe-cluster \
                       --name irptest \
                       --query cluster.identity.oidc.issuer \
                       --output text)


aws iam create-open-id-connect-provider \
          --url $ISSUER_URL \
          --thumbprint-list $ROOT_CA_FINGERPRINT \
          --client-id-list sts.amazonaws.com


# STEP 1: create IAM role and attach the target policy:
ISSUER_HOSTPATH=$(echo $ISSUER_URL | cut -f 3- -d'/')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PROVIDER_ARN="arn:aws:iam::$ACCOUNT_ID:oidc-provider/$ISSUER_HOSTPATH"
cat > irp-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${ISSUER_HOSTPATH}:sub": "system:serviceaccount:default:my-serviceaccount"
        }
      }
    }
  ]
}
EOF
ROLE_NAME=cwagentserverpolicy
aws iam create-role \
          --role-name $ROLE_NAME \
          --assume-role-policy-document file://irp-trust-policy.json
aws iam update-assume-role-policy \
          --role-name $ROLE_NAME \
          --policy-document file://irp-trust-policy.json
aws iam attach-role-policy \
          --role-name $ROLE_NAME \
          --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
CWAGENTSERVER_ROLE_ARN=$(aws iam get-role \
                        --role-name $ROLE_NAME \
                        --query Role.Arn --output text)

# STEP 2: create Kubernetes service account and annotate it with the IAM role:
kubectl create sa my-sa-cwagentserverpolicy
kubectl annotate sa -n amazon-cloudwatch my-sa-cwagentserverpolicy eks.amazonaws.com/role-arn=$CWAGENTSERVER_ROLE_ARN

# Add SSM permissions
ROLE_NAME=ssmfullaccess
aws iam create-role \
          --role-name $ROLE_NAME \
          --assume-role-policy-document file://irp-trust-policy.json
aws iam update-assume-role-policy \
          --role-name $ROLE_NAME \
          --policy-document file://irp-trust-policy.json
aws iam attach-role-policy \
          --role-name $ROLE_NAME \
          --policy-arn arn:aws:iam::aws:policy/AmazonSSMFullAccess
SSMPOLICY_ROLE_ARN=$(aws iam get-role \
                        --role-name $ROLE_NAME \
                        --query Role.Arn --output text)

# STEP 2: create Kubernetes service account and annotate it with the IAM role:
kubectl create sa my-sa-ssmfullaccess
kubectl annotate sa -n default my-sa-ssmfullaccess eks.amazonaws.com/role-arn=$SSMPOLICY_ROLE_ARN

# Add XRay permissions
ROLE_NAME=xraypolicy
aws iam create-role \
          --role-name $ROLE_NAME \
          --assume-role-policy-document file://irp-trust-policy.json
aws iam update-assume-role-policy \
          --role-name $ROLE_NAME \
          --policy-document file://irp-trust-policy.json
aws iam attach-role-policy \
          --role-name $ROLE_NAME \
          --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess 
XRAY_ROLE_ARN=$(aws iam get-role \
                        --role-name $ROLE_NAME \
                        --query Role.Arn --output text)

# STEP 2: create Kubernetes service account and annotate it with the IAM role:
kubectl create sa my-sa-xraypolicy
kubectl annotate sa -n default my-sa-xraypolicy eks.amazonaws.com/role-arn=$XRAY_ROLE_ARN