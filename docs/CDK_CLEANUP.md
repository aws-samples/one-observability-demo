<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# CDK Stack Cleanup Implementation

## Overview
Automated cleanup mechanism that handles orphaned CDK stacks when the main stack is deleted or when CodeBuild fails. Uses Step Functions with async polling, failure detection, retry capability, and complete resource cleanup on success.

## Problem Solved
- **Timeout Limitations**: Original Lambda approach had 15-minute timeout, insufficient for EKS clusters and Aurora databases (30+ minutes)
- **Orphaned Resources**: Failed cleanups would delete the cleanup mechanism itself, preventing retry
- **Silent Failures**: Stack deletion could complete even if cleanup failed

## Architecture

### Step Function State Machine (`rCDKCleanupStateMachine`)
Orchestrates the entire cleanup process with conditional execution based on results.

**Flow**:
```
ListTaggedStacks → CheckStacksFound → DeleteStacks (Map) → CheckDeletionResults → EvaluateOverallSuccess
                                                                                          ↓
                                                                    All Success? → CleanupCDKStagingBucket
                                                                          ↓              ↓
                                                                    Any Failed?    CleanupCacheBucket
                                                                          ↓              ↓
                                                                    SkipCleanup    DeleteCDKToolkitStack
                                                                       (END)           ↓
                                                                              CleanupComplete
                                                                                 (END)
```

**Stack Deletion Loop** (per stack):
```
DescribeStack → DeleteStack → WaitForDeletion (30s) → CheckDeletionStatus → EvaluateDeletionStatus
     ↓                                                                              ↓
StackAlreadyDeleted                                                    DELETE_IN_PROGRESS → Loop
(success)                                                              DELETE_COMPLETE → Success
                                                                       Other → Failed
```

### Lambda Functions

#### 1. Stack Lister (`rCDKStackListerFunction`)
- Lists all CDK stacks with matching application tag
- Sorts by sequence tag (highest first) for proper deletion order
- Returns stack names for Step Function processing

#### 2. Deletion Result Checker (`rDeletionResultCheckerFunction`)
```python
def handler(event, context):
    all_successful = all(
        result.get('status') == 'success'
        for result in event
        if isinstance(result, dict)
    )
    return {'allSuccessful': all_successful}
```
- Evaluates deletion results from all stacks
- Returns true only if ALL deletions succeeded
- Determines whether cleanup should proceed

#### 3. Bucket Cleanup (`rBucketCleanupFunction`)
- Generic function to clean up S3 buckets
- Accepts `bucketName` and `deleteBucket` parameters
- Empties bucket by deleting all objects and versions
- Optionally deletes the bucket itself
- Used for both CDK staging bucket and cache bucket
- Only runs if all stack deletions succeed

#### 4. Cleanup Completion (`rCleanupCompletionFunction`)
Deletes all retained resources when cleanup succeeds:
- Lambda functions: stack-lister, deletion-checker, bucket-cleanup, cleanup-monitor, cleanup-completion
- IAM roles: All roles for Lambda functions, Step Function, and EventBridge
- EventBridge rules matching the stack name
- Step Function state machine itself

#### 5. Cleanup Monitor (`rCleanupMonitorFunction`)
Custom resource that monitors Step Function execution during stack deletion:
```python
def handler(event, context):
    if event['RequestType'] in ['Create', 'Update']:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
        return

    # Start Step Function and poll for completion
    sf_client = boto3.client('stepfunctions')
    execution_arn = sf_client.start_execution(...)['executionArn']

    # Poll every 10 seconds for up to 14 minutes
    while time.time() - start_time < 840:
        status = sf_client.describe_execution(executionArn=execution_arn)['status']
        if status == 'SUCCEEDED':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return
        elif status in ['FAILED', 'TIMED_OUT', 'ABORTED']:
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
            return
        time.sleep(10)
```

### EventBridge Rules

#### Stack Deletion Trigger (`rStackDeletionRule`)
- Monitors CloudFormation stack status changes
- Triggers cleanup when main stack enters `DELETE_IN_PROGRESS`
- Provides async trigger (in addition to synchronous custom resource)

#### CodeBuild Failure Trigger (`rCodeBuildFailureRule`)
- Monitors CodeBuild project status
- Triggers cleanup on `FAILED`, `FAULT`, `STOPPED`, or `TIMED_OUT`

### Resources with Retain Policy
All cleanup resources have `DeletionPolicy: Retain` to enable retry on failure:
- Step Function state machine
- Lambda functions (5 total)
- IAM roles (6 total)
- EventBridge rules and role

These are automatically deleted by `rCleanupCompletionFunction` on successful cleanup.

## Execution Workflows

### Successful Cleanup
1. CloudFormation stack deletion initiated
2. `rCleanupMonitor` custom resource starts Step Function
3. Step Function lists CDK stacks by application tag
4. Each stack deleted sequentially with async polling
5. All deletions succeed → `{\"status\": \"success\"}`
6. `rDeletionResultCheckerFunction` confirms all successful
7. CDK staging bucket cleaned up and deleted
8. Cache bucket emptied (bucket retained)
9. CDK bootstrap stack (`CDKToolkitPetsite`) deleted
10. `rCleanupCompletionFunction` removes all retained resources
11. Step Function completes successfully
12. `rCleanupMonitor` signals SUCCESS to CloudFormation
13. CloudFormation stack deletion completes
14. **Result**: No resources left behind

### Failed Cleanup
1. CloudFormation stack deletion initiated
2. `rCleanupMonitor` custom resource starts Step Function
3. Step Function lists CDK stacks by application tag
4. One or more stack deletions fail → `{\"status\": \"failed\"}`
5. `rDeletionResultCheckerFunction` detects failure
6. Step Function skips cleanup steps and ends early
7. `rCleanupMonitor` detects Step Function failure
8. `rCleanupMonitor` signals FAILURE to CloudFormation
9. CloudFormation stack deletion fails (DELETE_FAILED)
10. **Result**: All cleanup resources preserved for retry

### Retry After Failure
1. Investigate Step Function execution history to identify failed stack
2. Manually resolve the issue (e.g., remove dependencies, fix permissions)
3. Delete the CloudFormation stack again
4. Step Function automatically runs and retries cleanup
5. If successful, all resources cleaned up; if failed, preserved for another retry

## Key Features

### Async Polling with No Timeout Limits
- Step Functions can run for up to 1 year
- 30-second wait between status checks
- Handles long-running deletions (EKS: 20-45 min, Aurora: 15-30 min)
- Lambda only runs for quick checks (60s max)

### Failure Detection and Protection
- Deletion results tracked for each stack
- Cleanup only proceeds if ALL deletions succeed
- CloudFormation stack deletion fails if cleanup incomplete
- Prevents false sense of completion

### Retry Capability
- Failed cleanups preserve all cleanup resources
- Step Function can be manually triggered or automatically retried
- All necessary resources remain available for retry

### Complete Cleanup on Success
- All Lambda functions deleted
- All IAM roles removed
- EventBridge rules cleaned up
- Step Function state machine deleted
- No resources left behind, no ongoing costs

### Dependency Handling
- Stacks deleted sequentially (MaxConcurrency: 1)
- Sorted by sequence tag for proper order
- Failed deletions don't stop the entire process
- Missing stacks handled gracefully

## Monitoring and Troubleshooting

### Monitoring Cleanup Progress
1. **Step Function Console**: View execution history and state transitions
2. **CloudWatch Logs**: Lambda function logs for detailed information
3. **CloudFormation Events**: Stack deletion events and status

### Troubleshooting Failed Cleanup
1. Check Step Function execution history for failed state
2. Review Lambda logs for specific error messages
3. Identify which CDK stack failed to delete
4. Check CloudFormation stack events for the failed stack
5. Resolve the issue (dependencies, permissions, etc.)
6. Retry by deleting the main CloudFormation stack again

### Common Failure Scenarios
- **Dependency Issues**: Resources in other stacks depend on the stack being deleted
- **Permission Issues**: IAM permissions insufficient for deletion
- **Resource Locks**: Resources have deletion protection enabled
- **Timeout**: Stack deletion takes longer than expected (rare with async approach)

## Benefits

1. **No Timeout Limitations**: Handles long-running deletions without Lambda timeout constraints
2. **Prevents Orphaned Resources**: Automatically cleans up CDK stacks and bootstrap resources
3. **Cost Optimization**: No resources left behind on success, minimal cost during failure
4. **Retry Capability**: Failed cleanups can be retried after fixing issues
5. **Failure Protection**: Stack deletion fails if cleanup incomplete, preventing silent failures
6. **Operational Excellence**: Automated cleanup with clear failure indication
7. **Better Observability**: Clear state transitions and comprehensive logging
8. **Resource Efficiency**: No compute resources wasted during wait periods

## Outputs
- `oCDKCleanupStateMachine`: ARN of the cleanup Step Function for monitoring and manual triggering
