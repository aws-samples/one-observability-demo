#!/bin/bash

echo ---------------------------------------------------------------------------------------------
echo This script deploys petsite service, xray daemon and the CloudWatch agent to the EKS cluster
echo ---------------------------------------------------------------------------------------------

STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)

# READ Stack name from SSM
PETSITE_IMAGE_URL=$(aws cloudformation describe-stacks  --stack-name $STACK_NAME | jq '.Stacks[0].Outputs[] | select(.OutputKey == "PetSiteECRImageURL").OutputValue' -r)

sed -i "s~{{ECR_IMAGE_URL}}~$PETSITE_IMAGE_URL~" ../../petsite/petsite/kubernetes/deployment.yaml

kubectl apply -f ../../petsite/petsite/kubernetes/deployment.yaml

kubectl apply -f ../../petsite/petsite/kubernetes/service.yaml

kubectl apply -f ../../petsite/petsite/kubernetes/xray-daemon/xray-daemon-config.yaml

# Setup Container Insights
# Removing this because we want the user to know how CWCI is being setup
# curl https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluentd-quickstart.yaml | sed "s/{{cluster_name}}/PetSite/;s/{{region_name}}/$AWS_REGION/" | kubectl apply -f -

# Wait a little bit for the ELB to be created
sleep 5 

# Get the ELB URL
ELB=$(kubectl get service service-petsite -o json | jq -r '.status.loadBalancer.ingress[].hostname')
ELB="http://"$ELB

echo ----- Creating SSM Parameter -----

aws ssm put-parameter --name "/petstore/petsiteurl" --value $ELB --type "String"  --region $AWS_REGION --overwrite

echo ----- ✅ DONE --------
