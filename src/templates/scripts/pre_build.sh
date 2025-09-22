#!/bin/bash
set -e

# Configure git with generic user info
git config --global user.email "codebuild@aws.amazon.com"
git config --global user.name "AWS CodeBuild"

# Download configuration file and append to .env
curl -o ./config.env "$CONFIG_FILE_URL"
cat ./config.env >> ${WORKING_FOLDER}/.env

# Run account validation script
./${WORKING_FOLDER}/scripts/validate-account.sh

# Append additional environment variables to .env file
cat >> ${WORKING_FOLDER}/.env << EOF
CONFIG_FILE_URL=$CONFIG_FILE_URL
CONFIG_BUCKET=$CONFIG_BUCKET
ORGANIZATION_NAME=$ORGANIZATION_NAME
REPOSITORY_NAME=$REPOSITORY_NAME
BRANCH_NAME=$BRANCH_NAME
WORKING_FOLDER=$WORKING_FOLDER
STACK_NAME=$STACK_NAME
AWS_REGION=$AWS_REGION
AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID
DISABLE_CLEANUP=$DISABLE_CLEANUP
EOF

# Add only .env file to repository
git add ${WORKING_FOLDER}/.env -f
git commit -m "Add merged configuration and environment variables to .env"

# Configure S3 remote with s3+zip protocol for CodePipeline
git remote add s3 s3+zip://$CONFIG_BUCKET/repo
git push s3 $BRANCH_NAME

# Check if account is bootstrapped
STACK_EXISTS=$(aws cloudformation list-stacks --query "StackSummaries[?StackName=='CDKToolkitPetsite' && StackStatus!='DELETE_COMPLETE'].StackName" --output text)
STACK_DELETE_COMPLETE=$(aws cloudformation list-stacks --query "StackSummaries[?StackName=='CDKToolkitPetsite' && StackStatus=='DELETE_COMPLETE'].StackName" --output text)

if [ -z "$STACK_EXISTS" ] && [ -z "$STACK_DELETE_COMPLETE" ]; then
  echo "Account not bootstrapped, bootstrapping now..."
  cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
elif [ -n "$STACK_DELETE_COMPLETE" ]; then
  echo "CDK bootstrap stack in DELETE_COMPLETE state, cleaning up resources..."
  # Force remove ECR and S3 buckets
  aws ecr delete-repository --repository-name "cdk-petsite-container-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}" --force 2>/dev/null || true
  bucket="cdk-petsite-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}"
  if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    aws s3api delete-objects --bucket "$bucket" --delete "$(aws s3api list-object-versions --bucket "$bucket" --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
    aws s3api delete-objects --bucket "$bucket" --delete "$(aws s3api list-object-versions --bucket "$bucket" --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
    aws s3api delete-bucket --bucket "$bucket" || true
  fi
  # Bootstrap again
  cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
else
  STACK_STATUS=$(aws cloudformation list-stacks --query "StackSummaries[?StackName=='CDKToolkitPetsite' && StackStatus!='DELETE_COMPLETE'].StackStatus" --output text)
  if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
    echo "CDK bootstrap stack in ROLLBACK_COMPLETE state, cleaning up resources..."
    # Force remove ECR and S3 buckets
    aws ecr delete-repository --repository-name "cdk-petsite-container-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}" --force 2>/dev/null || true
    bucket="cdk-petsite-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}"
    if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
      aws s3api delete-objects --bucket "$bucket" --delete "$(aws s3api list-object-versions --bucket "$bucket" --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
      aws s3api delete-objects --bucket "$bucket" --delete "$(aws s3api list-object-versions --bucket "$bucket" --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null || true
      aws s3api delete-bucket --bucket "$bucket" || true
    fi
    # Delete the stack
    aws cloudformation delete-stack --stack-name CDKToolkitPetsite
    aws cloudformation wait stack-delete-complete --stack-name CDKToolkitPetsite
    # Bootstrap again
    cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} --toolkit-stack-name CDKToolkitPetsite --qualifier petsite
  else
    echo "CDK bootstrap stack exists with status: $STACK_STATUS"
  fi
fi