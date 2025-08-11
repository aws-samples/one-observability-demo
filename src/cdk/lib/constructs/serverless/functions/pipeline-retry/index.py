# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import boto3

client = boto3.client("codepipeline")


def handler(event, context):
    detail = event["detail"]
    pipeline_name = detail["pipeline"]
    execution_id = detail["execution-id"]

    # Only retry build stage failures
    if detail.get("stage") != "build":
        return

    try:
        # Get execution details to check retry count
        response = client.get_pipeline_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id,
        )

        # Limit retries to 2 attempts
        trigger_detail = (
            response["pipelineExecution"].get("trigger", {}).get("triggerDetail", "0")
        )
        retry_count = int(trigger_detail) if trigger_detail.isdigit() else 0

        if retry_count >= 2:
            print(f"Max retries reached for execution: {execution_id}")
            return

        print(f"Retrying stage: build for pipeline: {pipeline_name}")

        client.retry_stage_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id,
            stageName="build",
        )

        print("Successfully triggered retry")

    except Exception as error:
        print(f"Failed to retry stage: {error}")
