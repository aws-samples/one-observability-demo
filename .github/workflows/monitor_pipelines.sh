#!/bin/bash

set -e

# Check if execution ID is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <execution-id>"
    exit 1
fi

EXECUTION_ID=$1
MAIN_PIPELINE="koffir-workshop-test"

echo "Checking execution $EXECUTION_ID of pipeline $MAIN_PIPELINE..."

# Check the status of the main pipeline execution
MAIN_STATUS=$(aws codepipeline get-pipeline-execution \
    --pipeline-name "$MAIN_PIPELINE" \
    --pipeline-execution-id "$EXECUTION_ID" \
    --query 'pipelineExecution.status' \
    --output text)

echo "Main pipeline status: $MAIN_STATUS"

# If the main pipeline is not successful, exit with error
if [ "$MAIN_STATUS" != "InProgress" ]; then
    echo "Main pipeline did not started. Exiting."
    exit 1
fi

echo "Looking for Observability Workshop Pipeline..."
sleep 30

# Find the Observability Workshop Pipeline
WORKSHOP_PIPELINE=$(aws codepipeline list-pipelines \
    --query "pipelines[?starts_with(name, 'Observability-Workshop-Pipeline-')].name" \
    --output text)

if [ -z "$WORKSHOP_PIPELINE" ]; then
    echo "No Observability Workshop Pipeline found. Exiting."
    exit 1
fi

echo "Found pipeline: $WORKSHOP_PIPELINE"

# Get the latest execution ID of the workshop pipeline
WORKSHOP_EXECUTION_ID=$(aws codepipeline list-pipeline-executions \
    --pipeline-name "$WORKSHOP_PIPELINE" \
    --max-items 1 \
    --query 'pipelineExecutionSummaries[0].pipelineExecutionId' \
    --output text)

echo "Monitoring execution $WORKSHOP_EXECUTION_ID of pipeline $WORKSHOP_PIPELINE..."

# Monitor the workshop pipeline execution until completion

WORKSHOP_STATUS=$(aws codepipeline get-pipeline-execution \
    --pipeline-name "$WORKSHOP_PIPELINE" \
    --pipeline-execution-id "$WORKSHOP_EXECUTION_ID" \
    --query 'pipelineExecution.status' \
    --output text)

echo "Current status: $WORKSHOP_STATUS"

if [ "$WORKSHOP_STATUS" == "Failed" ] || [ "$WORKSHOP_STATUS" == "Stopped" ]; then
    echo "Pipeline execution failed or was stopped."
    exit 1
fi
    
    echo "Waiting for pipeline to complete..."
    sleep 30
done

# Monitor the Observability-Workshop CloudFormation stack until completion
while true; do
    # Check if the stack exists and get its status
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "Observability-Workshop" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "STACK_NOT_FOUND")

    if [ "$STACK_STATUS" == "STACK_NOT_FOUND" ]; then
        echo "Stack 'Observability-Workshop' not found yet. Waiting..."
    else
        echo "Stack 'Observability-Workshop' status: $STACK_STATUS"

        # Check if the stack is in a completed state
        if [[ "$STACK_STATUS" == *"COMPLETE"* ]]; then
            if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
                echo "Stack deployment succeeded!"
                exit 0
            else
                echo "Stack deployment failed with status: $STACK_STATUS"
                exit 1
            fi
        elif [[ "$STACK_STATUS" == *"FAILED"* || "$STACK_STATUS" == *"ROLLBACK"* ]]; then
            echo "Stack deployment failed with status: $STACK_STATUS"
            exit 1
        fi
    fi

    echo "Waiting for stack deployment to complete..."
    sleep 30
done


# Monitor the CloudFormation stack until completion
while true; do
    # Check if the stack exists and get its status
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "Services" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "STACK_NOT_FOUND")

    if [ "$STACK_STATUS" == "STACK_NOT_FOUND" ]; then
        echo "Stack 'Services' not found yet. Waiting..."
    else
        echo "Stack 'Services' status: $STACK_STATUS"

        # Check if the stack is in a completed state
        if [[ "$STACK_STATUS" == *"COMPLETE"* ]]; then
            if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
                echo "Stack deployment succeeded!"
                exit 0
            else
                echo "Stack deployment failed with status: $STACK_STATUS"
                exit 1
            fi
        elif [[ "$STACK_STATUS" == *"FAILED"* || "$STACK_STATUS" == *"ROLLBACK"* ]]; then
            echo "Stack deployment failed with status: $STACK_STATUS"
            exit 1
        fi
    fi

    echo "Waiting for stack deployment to complete..."
    sleep 30
done