#!/bin/bash

echo ---------------------------------------------------------------------------------------------
echo This script destroys the resources created in the workshop
echo ---------------------------------------------------------------------------------------------

if [ -z "$AWS_REGION" ]; then
	echo "Fatal: environment variable AWS_REGION not set. Aborting."
	exit 1
fi

# Disable Contributor Insights
DDB_CONTRIB=$(aws ssm get-parameter --name '/petstore/dynamodbtablename' | jq .Parameter.Value -r)
aws dynamodb update-contributor-insights --table-name $DDB_CONTRIB --contributor-insights-action DISABLE

echo STARTING SERVICES CLEANUP
echo -----------------------------

# Get the main stack name
STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)
STACK_NAME_APP=$(aws ssm get-parameter --name '/eks/petsite/stackname' --region $AWS_REGION | jq .Parameter.Value -r)

# Set default name in case Parameters are gone (partial deletion)
if [ -z $STACK_NAME ]; then STACK_NAME="Services"; fi
if [ -z $STACK_NAME_APP ]; then STACK_NAME_APP="Applications"; fi
if [ -z $STACK_NAME_CODEPIPELINE ]; then STACK_NAME_CODEPIPELINE="Observability-Workshop"; fi

# Fix for CDK teardown issues
aws eks update-kubeconfig --name PetSite
kubectl delete -f https://raw.githubusercontent.com/aws-samples/one-observability-demo/main/PetAdoptions/cdk/pet_stack/resources/load_balancer/crds.yaml

#Deleting keycloak
kubectl delete namespace keycloak --force

# Sometimes the SqlSeeder doesn't get deleted cleanly. This helps clean up the environment completely including Sqlseeder
aws cloudformation delete-stack --stack-name $STACK_NAME_APP
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME_APP
aws cloudformation delete-stack --stack-name $STACK_NAME
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME

aws cloudwatch delete-dashboards --dashboard-names "EKS_FluentBit_Dashboard"

# delete the code pipeline stack
aws cloudformation delete-stack --stack-name $STACK_NAME_CODEPIPELINE
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME_CODEPIPELINE

echo CDK BOOTSTRAP WAS NOT DELETED

echo ----- ✅ DONE --------
