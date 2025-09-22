#!/bin/bash
set -e

if [ "$CODEBUILD_BUILD_SUCCEEDING" = "0" ]; then
  if [ "$DISABLE_CLEANUP" = "true" ]; then
    echo "Build failed, but cleanup is disabled. Skipping resource cleanup."
  else
    echo "Build failed, cleaning up S3 bucket for rollback"
    aws s3 rm s3://$CONFIG_BUCKET --recursive
    echo "Triggering CDK stack cleanup via Step Function"
    aws stepfunctions start-execution \
      --state-machine-arn "arn:aws:states:$AWS_REGION:$AWS_ACCOUNT_ID:stateMachine:$STACK_NAME-cdk-cleanup" \
      --input '{}' || echo "Failed to trigger cleanup, continuing..."
  fi
  WAIT_HANDLE_URL=$(aws cloudformation describe-stack-resource --stack-name $STACK_NAME --logical-resource-id rCDKDeploymentWaitConditionHandle --query 'StackResourceDetail.PhysicalResourceId' --output text --region $AWS_REGION)
  curl -X PUT -H 'Content-Type:' --data-binary '{"Status" : "FAILURE","Reason" : "Build failed","UniqueId" : "'$(uuidgen)'","Data" : "Build execution failed"}' "$WAIT_HANDLE_URL"
else
  echo "Build completed - signal already sent during pipeline monitoring"
fi