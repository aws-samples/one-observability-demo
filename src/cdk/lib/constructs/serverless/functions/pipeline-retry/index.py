# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
import logging

import boto3

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

client = boto3.client("codepipeline")


def handler(event, context):
    logger.info(f"Received event: {json.dumps(event, indent=2)}")

    try:
        detail = event["detail"]
        pipeline_name = detail["pipeline"]
        execution_id = detail["execution-id"]

        logger.info(
            f"Processing pipeline failure - Pipeline: {pipeline_name}, "
            f"Execution: {execution_id}",
        )

        # Get pipeline execution details
        logger.info("Getting pipeline execution details...")
        response = client.get_pipeline_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id,
        )

        execution_details = response["pipelineExecution"]
        logger.info(f"Execution status: {execution_details.get('status')}")

        # Get pipeline state to find failed stages
        logger.info("Getting pipeline state...")
        state_response = client.get_pipeline_state(name=pipeline_name)

        failed_stages = []
        for stage in state_response["stageStates"]:
            if stage.get("latestExecution", {}).get("status") == "Failed":
                failed_stages.append(stage["stageName"])
                logger.info(f"Found failed stage: {stage['stageName']}")

        if not failed_stages:
            logger.warning("No failed stages found to retry")
            return {"statusCode": 200, "message": "No failed stages to retry"}

        # Check if build stage failed (our target for retry)
        if "build" not in failed_stages:
            logger.info("Build stage did not fail, skipping retry")
            return {"statusCode": 200, "message": "Build stage did not fail"}

        # Simple retry limit check using execution history
        logger.info("Checking retry count...")
        executions_response = client.list_pipeline_executions(
            pipelineName=pipeline_name,
            maxResults=10,
        )

        # Count recent failed executions as a proxy for retry attempts
        recent_failures = 0
        for exec_summary in executions_response["pipelineExecutionSummaries"]:
            if exec_summary["status"] == "Failed":
                recent_failures += 1
            else:
                break  # Stop at first non-failed execution

        logger.info(f"Recent consecutive failures: {recent_failures}")

        if recent_failures >= 3:  # Allow 2 retries (3 total attempts)
            logger.warning(
                f"Max retries reached ({recent_failures} consecutive failures)",
            )
            return {"statusCode": 200, "message": "Max retries reached"}

        # Attempt to retry the build stage
        logger.info(f"Attempting to retry build stage for pipeline: {pipeline_name}")

        retry_response = client.retry_stage_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id,
            stageName="build",
        )

        logger.info(
            f"Successfully triggered retry. "
            f"Response: {json.dumps(retry_response, default=str)}",
        )

        return {
            "statusCode": 200,
            "message": "Retry triggered successfully",
            "pipelineName": pipeline_name,
            "executionId": execution_id,
            "retriedStage": "build",
        }

    except Exception as error:
        logger.error(f"Failed to process retry: {str(error)}", exc_info=True)
        return {"statusCode": 500, "message": f"Failed to retry: {str(error)}"}
