#!/bin/bash
# Wait for CodePipeline execution to complete
# Usage: ./wait-for-pipeline.sh <pipeline-name> <stack-name> <region>

set -e

PIPELINE_NAME=$1
STACK_NAME=$2
REGION=$3

if [ -z "$PIPELINE_NAME" ] || [ -z "$STACK_NAME" ] || [ -z "$REGION" ]; then
  echo "Usage: $0 <pipeline-name> <stack-name> <region>"
  exit 1
fi

echo "Waiting for pipeline ${PIPELINE_NAME} execution to complete..."

TIMEOUT=3600
ELAPSED=0
SLEEP_INTERVAL=30
RETRY_LOOP_COUNT=0
MAX_RETRY_LOOPS=10

INITIAL_EXECUTION_ID=$(aws codepipeline list-pipeline-executions \
  --pipeline-name "$PIPELINE_NAME" \
  --region "$REGION" \
  --max-items 1 \
  --query 'pipelineExecutionSummaries[0].pipelineExecutionId' \
  --output text)

echo "Initial pipeline execution ID: $INITIAL_EXECUTION_ID"

while [ $ELAPSED -lt $TIMEOUT ]; do
  EXECUTION_DETAILS=$(aws codepipeline list-pipeline-executions \
    --pipeline-name "$PIPELINE_NAME" \
    --region "$REGION" \
    --max-items 1 \
    --query 'pipelineExecutionSummaries[0].[pipelineExecutionId,status]' \
    --output text)

  CURRENT_EXECUTION_ID=$(echo "$EXECUTION_DETAILS" | cut -f1)
  EXECUTION_STATUS=$(echo "$EXECUTION_DETAILS" | cut -f2)

  if [ "$CURRENT_EXECUTION_ID" != "$INITIAL_EXECUTION_ID" ]; then
    echo "Detected new pipeline execution: $CURRENT_EXECUTION_ID"
    INITIAL_EXECUTION_ID="$CURRENT_EXECUTION_ID"
    RETRY_LOOP_COUNT=0
  fi

  echo "Current pipeline execution status: $EXECUTION_STATUS (ID: $CURRENT_EXECUTION_ID)"

  case "$EXECUTION_STATUS" in
    "Succeeded")
      echo "Pipeline execution completed successfully!"
      WAIT_HANDLE_URL=$(aws cloudformation describe-stack-resource --stack-name "$STACK_NAME" --logical-resource-id rCDKDeploymentWaitConditionHandle --query 'StackResourceDetail.PhysicalResourceId' --output text --region "$REGION")
      curl -X PUT -H 'Content-Type:' --data-binary '{"Status":"SUCCESS","Reason":"Pipeline completed successfully","UniqueId":"'$(uuidgen)'","Data":"Pipeline execution finished"}' "$WAIT_HANDLE_URL"
      exit 0
      ;;
    "Failed")
      echo "Pipeline execution failed with status: $EXECUTION_STATUS"
      RETRY_LOOP_COUNT=$((RETRY_LOOP_COUNT + 1))
      if [ $RETRY_LOOP_COUNT -lt $MAX_RETRY_LOOPS ]; then
        echo "Waiting for potential retry... (loop $RETRY_LOOP_COUNT of $MAX_RETRY_LOOPS)"
        sleep 60
        ELAPSED=$((ELAPSED + 60))
        continue
      else
        echo "Maximum retry loops ($MAX_RETRY_LOOPS) reached. Build failed."
        exit 1
      fi
      ;;
    "Cancelled"|"Stopped")
      echo "Pipeline execution was cancelled or stopped: $EXECUTION_STATUS"
      exit 1
      ;;
    "Superseded")
      echo "Pipeline execution was superseded by a newer execution"
      ;;
    "InProgress"|"Stopping")
      echo "Pipeline execution in progress..."
      ;;
    *)
      echo "Unknown pipeline status: $EXECUTION_STATUS"
      ;;
  esac

  if [ $ELAPSED -gt 0 ] && [ $((ELAPSED % 300)) -eq 0 ]; then
    echo "Progress check: $((ELAPSED / 60)) minutes elapsed, status: $EXECUTION_STATUS"
    aws codepipeline get-pipeline-state \
      --name "$PIPELINE_NAME" \
      --region "$REGION" \
      --query 'stageStates[*].[stageName,latestExecution.status]' \
      --output table || echo "Could not retrieve detailed stage information"
  fi

  sleep $SLEEP_INTERVAL
  ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
done

echo "Timeout reached after $((TIMEOUT / 60)) minutes"
exit 1
