#!/bin/bash
set -e

cd $WORKING_FOLDER

# Install dependencies and synthesize CDK
npm install
cdk synth --quiet
cdk deploy --require-approval never --outputs-file cdk-outputs.json --quiet

# Extract pipeline ARN for later use
PIPELINE_ARN=$(cat cdk-outputs.json | jq -r '.[] | select(has("PipelineArn")) | .PipelineArn')

if [ -z "$PIPELINE_ARN" ] || [ "$PIPELINE_ARN" = "null" ]; then
  echo "ERROR: Pipeline ARN is empty or null. CDK deployment failed to create pipeline."
  exit 1
fi

echo "Pipeline ARN: $PIPELINE_ARN"
PIPELINE_NAME=$(echo $PIPELINE_ARN | cut -d':' -f6)
echo "Pipeline Name: $PIPELINE_NAME"

# Wait for pipeline to complete using direct status checking with retry handling
echo "Waiting for pipeline ${PIPELINE_NAME} execution to complete..."
TIMEOUT=3600  # 1 hour timeout
ELAPSED=0
SLEEP_INTERVAL=30
INITIAL_EXECUTION_ID=""
RETRY_COUNT=0
MAX_RETRIES=3
RETRY_LOOP_COUNT=0
MAX_RETRY_LOOPS=10

# Get the initial execution ID to track retries
INITIAL_EXECUTION_ID=$(aws codepipeline list-pipeline-executions \
  --pipeline-name "$PIPELINE_NAME" \
  --max-items 1 \
  --query 'pipelineExecutionSummaries[0].pipelineExecutionId' \
  --output text)

echo "Initial pipeline execution ID: $INITIAL_EXECUTION_ID"

while [ $ELAPSED -lt $TIMEOUT ]; do
  # Get the most recent pipeline execution details
  EXECUTION_DETAILS=$(aws codepipeline list-pipeline-executions \
    --pipeline-name "$PIPELINE_NAME" \
    --max-items 1 \
    --query 'pipelineExecutionSummaries[0].[pipelineExecutionId,status]' \
    --output text)

  CURRENT_EXECUTION_ID=$(echo "$EXECUTION_DETAILS" | cut -f1)
  EXECUTION_STATUS=$(echo "$EXECUTION_DETAILS" | cut -f2)

  # Check if this is a new execution (retry scenario)
  if [ "$CURRENT_EXECUTION_ID" != "$INITIAL_EXECUTION_ID" ]; then
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Detected new pipeline execution (retry #$RETRY_COUNT): $CURRENT_EXECUTION_ID"
    INITIAL_EXECUTION_ID="$CURRENT_EXECUTION_ID"
    RETRY_LOOP_COUNT=0  # Reset retry loop counter for new execution
    echo "Continuing to monitor new execution..."
  fi

  echo "Current pipeline execution status: $EXECUTION_STATUS (ID: $CURRENT_EXECUTION_ID)"

  case "$EXECUTION_STATUS" in
    "Succeeded")
      echo "Pipeline execution completed successfully!"
      if [ $RETRY_COUNT -gt 0 ]; then
        echo "Success achieved after $RETRY_COUNT retry(ies)"
      fi
      echo "Signaling CloudFormation SUCCESS"
      WAIT_HANDLE_URL=$(aws cloudformation describe-stack-resource --stack-name $STACK_NAME --logical-resource-id rCDKDeploymentWaitConditionHandle --query 'StackResourceDetail.PhysicalResourceId' --output text --region $AWS_REGION)
      curl -X PUT -H 'Content-Type:' --data-binary '{"Status" : "SUCCESS","Reason" : "Pipeline completed successfully","UniqueId" : "'$(uuidgen)'","Data" : "Pipeline execution finished"}' "$WAIT_HANDLE_URL"
      break
      ;;
    "Failed")
      echo "Pipeline execution failed with status: $EXECUTION_STATUS"
      RETRY_LOOP_COUNT=$((RETRY_LOOP_COUNT + 1))
      echo "Retry loop count: $RETRY_LOOP_COUNT/$MAX_RETRY_LOOPS"

      if [ $RETRY_LOOP_COUNT -lt $MAX_RETRY_LOOPS ]; then
        echo "Waiting for potential retry... (loop $RETRY_LOOP_COUNT of $MAX_RETRY_LOOPS)"
        sleep 60
        ELAPSED=$((ELAPSED + 60))
        continue
      else
        echo "Maximum retry loops ($MAX_RETRY_LOOPS) reached without new execution. Build failed."
        exit 1
      fi
      ;;
    "Cancelled"|"Stopped")
      echo "Pipeline execution was cancelled or stopped: $EXECUTION_STATUS"
      echo "This may indicate manual intervention or system issues."
      exit 1
      ;;
    "Superseded")
      echo "Pipeline execution was superseded by a newer execution"
      echo "Continuing to monitor the newer execution..."
      sleep $SLEEP_INTERVAL
      ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
      ;;
    "InProgress")
      echo "Pipeline execution in progress..."
      sleep $SLEEP_INTERVAL
      ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
      ;;
    "Stopping")
      echo "Pipeline execution is stopping..."
      sleep $SLEEP_INTERVAL
      ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
      ;;
    *)
      echo "Unknown pipeline status: $EXECUTION_STATUS"
      echo "Continuing to monitor..."
      sleep $SLEEP_INTERVAL
      ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
      ;;
  esac

  # Additional safety check for stuck executions
  if [ $ELAPSED -gt 0 ] && [ $((ELAPSED % 300)) -eq 0 ]; then
    echo "Progress check: $((ELAPSED / 60)) minutes elapsed, status: $EXECUTION_STATUS"

    # Get detailed stage information for better visibility
    aws codepipeline get-pipeline-state \
      --name "$PIPELINE_NAME" \
      --query 'stageStates[*].[stageName,latestExecution.status]' \
      --output table || echo "Could not retrieve detailed stage information"
  fi
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "Timeout reached after $((TIMEOUT / 60)) minutes"
  echo "Final pipeline status: $EXECUTION_STATUS"
  echo "Total retries attempted: $RETRY_COUNT"

  # Get final pipeline state for debugging
  echo "Final pipeline state:"
  aws codepipeline get-pipeline-state \
    --name "$PIPELINE_NAME" \
    --query 'stageStates[*].[stageName,latestExecution.status,latestExecution.errorDetails.message]' \
    --output table || echo "Could not retrieve final pipeline state"

  exit 1
fi