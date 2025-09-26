<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# CDK Stack Cleanup Implementation Summary

## Overview
Added automated cleanup mechanism to the CloudFormation template that handles orphaned CDK stacks when the main stack is deleted or when CodeBuild fails.

## Changes Made

### 1. Parameter Store Integration
- **Location**: CodeBuild buildspec in `rCDKDeploymentProject`
- **Change**: Added `cdk list` command to capture all CDK stacks before deployment
- **Storage**: Saves stack list to Parameter Store at `/cdk-cleanup/${STACK_NAME}/stacks`

```bash
STACK_LIST=$(cdk list --json | jq -r '.[]' | tr '\n' ',' | sed 's/,$//')
aws ssm put-parameter --name "/cdk-cleanup/${STACK_NAME}/stacks" --value "$STACK_LIST" --type "String" --overwrite
```

### 2. Step Function State Machine
- **Resource**: `rCDKCleanupStateMachine`
- **Purpose**: Orchestrates the deletion of CDK stacks
- **Process**:
  1. Retrieves stack list from Parameter Store
  2. Parses comma-separated stack names
  3. Deletes each stack sequentially (MaxConcurrency: 1)
  4. Handles missing stacks and dependency failures gracefully

### 3. Lambda Function for Stack Deletion
- **Resource**: `rCDKStackDeleterFunction`
- **Features**:
  - Checks if stack exists before attempting deletion
  - Waits for deletion completion with proper timeout
  - Handles dependency failures gracefully (returns success to continue with other stacks)
  - Comprehensive error handling and logging

### 4. EventBridge Rules
- **Stack Deletion Trigger**: `rStackDeletionRule`
  - Monitors CloudFormation stack status changes
  - Triggers cleanup when main stack enters `DELETE_IN_PROGRESS`

- **CodeBuild Failure Trigger**: `rCodeBuildFailureRule`
  - Monitors CodeBuild project status
  - Triggers cleanup on `FAILED`, `FAULT`, `STOPPED`, or `TIMED_OUT`

### 5. Enhanced Post-Build Cleanup
- **Location**: CodeBuild post_build phase
- **Addition**: Manual Step Function trigger on build failure
- **Fallback**: Ensures cleanup runs even if EventBridge rule doesn't trigger

### 6. IAM Roles and Permissions
- **Step Function Role**: `rCDKCleanupRole`
  - SSM parameter read access
  - Lambda function invoke permissions

- **Lambda Execution Role**: `rCDKStackDeleterRole`
  - CloudFormation full access for stack operations

- **EventBridge Role**: `rEventBridgeRole`
  - Step Function execution permissions

### 7. Parameter Store Cleanup
- **Resource**: `rParameterCleanup` (Custom Resource)
- **Purpose**: Removes Parameter Store parameter when main stack is deleted
- **Implementation**: Lambda-backed custom resource

## Key Features

### Dependency Handling
- Stacks are deleted sequentially to respect dependencies
- Failed deletions due to dependencies don't stop the process
- Missing stacks are handled gracefully

### Error Resilience
- Multiple retry mechanisms in Step Function
- Graceful handling of non-existent stacks
- Comprehensive logging for troubleshooting

### Trigger Mechanisms
1. **Automatic**: EventBridge rules for stack deletion and CodeBuild failure
2. **Manual**: Direct Step Function invocation in post_build phase
3. **Cleanup**: Parameter Store cleanup on stack deletion

## Outputs Added
- `oCDKCleanupStateMachine`: ARN of the cleanup Step Function for monitoring

## Usage
The cleanup process is fully automated and requires no manual intervention. Users can monitor the cleanup process through:
1. Step Function execution logs in AWS Console
2. Lambda function logs in CloudWatch
3. CloudFormation stack deletion events

## Benefits
1. **Prevents Orphaned Resources**: Automatically cleans up CDK stacks
2. **Cost Optimization**: Removes unused infrastructure
3. **Operational Excellence**: Reduces manual cleanup tasks
4. **Fault Tolerance**: Multiple trigger mechanisms ensure cleanup runs
5. **Dependency Aware**: Handles stack dependencies intelligently
