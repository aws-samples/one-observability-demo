#!/bin/bash

echo ---------------------------------------------------------------------------------------------
echo This script destroys the CDK stack
echo ---------------------------------------------------------------------------------------------

# Disable Contributor Insights
DDB_CONTRIB=$(aws ssm get-parameter --name '/petstore/dynamodbtablename' | jq .Parameter.Value -r)
aws dynamodb update-contributor-insights --table-name $DDB_CONTRIB --contributor-insights-action DISABLE  

# Fetch the name of the S3 bucket created by CDKToolkit for bootstrap
CDK_S3_BUCKET_NAME=$(aws cloudformation describe-stacks  --stack-name CDKToolkit | jq '.Stacks[0].Outputs[] | select(.OutputKey == "BucketName").OutputValue' -r)

# Empty the S3 bucket CDKToolkit
echo CLEANING OUT BOOTSTRAP S3 BUCKET CONTENTS
echo -----------------------------------------
aws s3 rm s3://$CDK_S3_BUCKET_NAME --recursive   

# Delete resources such as S3 buckets etc created by CDKToolkit

aws cloudformation delete-stack --stack-name CDKToolkit
echo DELETED THE BOOTSTRAP S3 BUCKET
echo ----------------------------------

echo STARTING SERVICES CLEANUP
echo -----------------------------

# Get the main stack name
STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)
STACK_NAME_APP=$(aws ssm get-parameter --name '/eks/petsite/stackname' --region $AWS_REGION | jq .Parameter.Value -r)

# Set default name in case Parameters are gone (partial deletion)
if [ -z $STACK_NAME ]; then STACK_NAME="Services"; fi
if [ -z $STACK_NAME_APP ]; then STACK_NAME_APP="Applications"; fi 

# Fix for CDK teardown issues
aws eks update-kubeconfig --name PetSite
kubectl delete -f ./resources/load_balancer/crds.yaml

# Get rid of all resources (Application first, then cluster or it will fail)
cdk destroy $STACK_NAME_APP $STACK_NAME --force
cdk destroy $STACK_NAME --force

# Sometimes the SqlSeeder doesn't get deleted cleanly. This helps clean up the environment completely including Sqlseeder
aws cloudformation delete-stack --stack-name $STACK_NAME 
aws cloudformation delete-stack --stack-name $STACK_NAME_APP

aws cloudwatch delete-dashboards --dashboard-names "EKS_FluentBit_Dashboard"

echo ----- ✅ DONE --------