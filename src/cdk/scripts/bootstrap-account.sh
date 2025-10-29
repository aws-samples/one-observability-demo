#!/bin/bash
# Bootstrap CDK account for a specific region
# Usage: ./bootstrap-account.sh <account-id> <region>

set -e

ACCOUNT_ID=$1
REGION=$2

if [ -z "$ACCOUNT_ID" ] || [ -z "$REGION" ]; then
  echo "Usage: $0 <account-id> <region>"
  exit 1
fi

echo "Checking CDK bootstrap status for account $ACCOUNT_ID in region $REGION..."

STACK_STATUS=$(aws cloudformation list-stacks --region "$REGION" --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE UPDATE_ROLLBACK_COMPLETE --query "StackSummaries[?StackName=='CDKToolkitPetsite'] | [0].StackStatus" --output text)

cleanup_resources() {
  echo "Cleaning up CDK resources..."
  aws ecr delete-repository --region "$REGION" --repository-name "cdk-petsite-container-assets-${ACCOUNT_ID}-${REGION}" --force 2>/dev/null || true
  bucket="cdk-petsite-assets-${ACCOUNT_ID}-${REGION}"
  if aws s3api head-bucket --bucket "$bucket" --region "$REGION" 2>/dev/null; then
    aws s3api delete-objects --bucket "$bucket" --region "$REGION" --delete "$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
    aws s3api delete-objects --bucket "$bucket" --region "$REGION" --delete "$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
    aws s3api delete-bucket --bucket "$bucket" --region "$REGION" || true
  fi
}

if [ "$STACK_STATUS" = "CREATE_COMPLETE" ] || [ "$STACK_STATUS" = "UPDATE_COMPLETE" ]; then
  echo "CDK bootstrap stack exists with status: $STACK_STATUS"
elif [ "$STACK_STATUS" = "DELETE_COMPLETE" ]; then
  echo "CDK bootstrap stack in DELETE_COMPLETE state, cleaning up resources..."
  cleanup_resources
  cdk bootstrap aws://${ACCOUNT_ID}/${REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
elif [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "CDK bootstrap stack in ROLLBACK_COMPLETE state, cleaning up resources..."
  cleanup_resources
  aws cloudformation delete-stack --stack-name CDKToolkitPetsite --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name CDKToolkitPetsite --region "$REGION"
  cdk bootstrap aws://${ACCOUNT_ID}/${REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
elif [ -z "$STACK_STATUS" ] || [ "$STACK_STATUS" = "None" ]; then
  echo "Account not bootstrapped, bootstrapping now..."
  cdk bootstrap aws://${ACCOUNT_ID}/${REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
else
  echo "CDK bootstrap stack in unexpected state: $STACK_STATUS. Manual intervention required."
  exit 1
fi

echo "Bootstrap complete for region $REGION"
