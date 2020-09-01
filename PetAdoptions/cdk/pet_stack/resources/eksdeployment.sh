#!/bin/bash

echo ---------------------------------------------------------------------------------------------
echo This script deploys petsite service, xray daemon and the CloudWatch agent to the EKS cluster
echo ---------------------------------------------------------------------------------------------

STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)

# READ Stack name from SSM
PETSITE_IMAGE_URL=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "PetSiteECRImageURL").OutputValue' -r)



CLOUDWATCH_SA_ROLE=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "CWServiceAccountArn").OutputValue' -r)
XRAY_SA_ROLE=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "XRayServiceAccountArn").OutputValue' -r)
PETSITE_SA_ROLE=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "PetStoreServiceAccountArn").OutputValue' -r)

ACCOUNT_ID="$(aws sts get-caller-identity | jq -r .Account)"
OIDC_PROVIDER=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "OIDCProviderUrl").OutputValue' -r | sed -e "s/^https:\/\///")

cat > trust.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF



aws iam update-assume-role-policy --role-name $(aws iam list-roles  --query "Roles[?Arn=='${CLOUDWATCH_SA_ROLE}'].RoleName" --output text) --policy-document file://trust.json 
aws iam update-assume-role-policy --role-name $(aws iam list-roles  --query "Roles[?Arn=='${XRAY_SA_ROLE}'].RoleName" --output text) --policy-document file://trust.json 
aws iam update-assume-role-policy --role-name $(aws iam list-roles  --query "Roles[?Arn=='${PETSITE_SA_ROLE}'].RoleName" --output text) --policy-document file://trust.json 

rm trust.json



SEARCH_API_URL="$(aws ssm get-parameter --name "/petstore/searchapiurl" --query Parameter.Value --output text)"
UPDATE_ADOPTION_STATUS_URL="$(aws ssm get-parameter --name "/petstore/updateadoptionstatusurl" --query Parameter.Value --output text)"
PAYMENT_API_URL="$(aws ssm get-parameter --name "/petstore/paymentapiurl" --query Parameter.Value --output text)"
QUEUE_URL="$(aws ssm get-parameter --name "/petstore/queueurl" --query Parameter.Value --output text)"
SNS_ARN="$(aws ssm get-parameter --name "/petstore/snsarn" --query Parameter.Value --output text)"
PET_LIST_ADOPTION_URL="$(aws ssm get-parameter --name "/petstore/petlistadoptionsurl" --query Parameter.Value --output text)"

sed -i "s~{{SEARCH_API_URL}}~$SEARCH_API_URL~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{UPDATE_ADOPTION_STATUS_URL}}~$UPDATE_ADOPTION_STATUS_URL~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{PAYMENT_API_URL}}~$PAYMENT_API_URL~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{QUEUE_URL}}~$QUEUE_URL~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{SNS_ARN}}~$SNS_ARN~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{PET_LIST_ADOPTION_URL}}~$PET_LIST_ADOPTION_URL~" ../../petsite/petsite/kubernetes/deployment.yaml


sed -i "s~{{ECR_IMAGE_URL}}~$PETSITE_IMAGE_URL~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{PETSITE_SA_ROLE}}~$PETSITE_SA_ROLE~" ../../petsite/petsite/kubernetes/deployment.yaml
sed -i "s~{{XRAY_SA_ROLE}}~$XRAY_SA_ROLE~" ../../petsite/petsite/kubernetes/xray-daemon/xray-daemon-config.yaml


kubectl apply -f ../../petsite/petsite/kubernetes/deployment.yaml

kubectl apply -f ../../petsite/petsite/kubernetes/service.yaml

kubectl apply -f ../../petsite/petsite/kubernetes/xray-daemon/xray-daemon-config.yaml

# Pre-configure the Service account for cloudwatch agent
kubectl create namespace amazon-cloudwatch
kubectl create sa cloudwatch-agent -n amazon-cloudwatch
kubectl annotate serviceaccount -n amazon-cloudwatch cloudwatch-agent eks.amazonaws.com/role-arn=${CLOUDWATCH_SA_ROLE}


# Setup Container Insights
# Removing this because we want the user to know how CWCI is being setup
# curl https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluentd-quickstart.yaml | sed "s/{{cluster_name}}/PetSite/;s/{{region_name}}/$AWS_REGION/" | kubectl apply -f -
# Test code for EKS Container Insight (manually run on step 7.2)

#STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)
#CLOUDWATCH_SA_ROLE=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "CWServiceAccountArn").OutputValue' -r)

#kubectl create namespace amazon-cloudwatch
#kubectl create sa cloudwatch-agent -n amazon-cloudwatch
#kubectl annotate serviceaccount -n amazon-cloudwatch cloudwatch-agent eks.amazonaws.com/role-arn=${CLOUDWATCH_SA_ROLE}

#curl https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluentd-quickstart.yaml | sed "s/{{cluster_name}}/PetSite/;s/{{region_name}}/$AWS_REGION/" | kubectl apply -f -

#kubectl annotate serviceaccount -n amazon-cloudwatch cloudwatch-agent eks.amazonaws.com/role-arn=${CLOUDWATCH_SA_ROLE}



# Wait a little bit for ELB to be created
sleep 5 

# GET address of the ELB
ELB=$(kubectl get service service-petsite -o json | jq -r '.status.loadBalancer.ingress[].hostname')
ELB="http://"$ELB

echo ----- Creating SSM Parameter -----

aws ssm put-parameter --name "/petstore/petsiteurl" --value $ELB --type "String"  --region $AWS_REGION --overwrite

echo ----- ✅ DONE --------
