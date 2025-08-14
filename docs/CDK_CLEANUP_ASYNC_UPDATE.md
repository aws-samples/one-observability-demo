<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# CDK Stack Cleanup - Async Implementation Update

## Problem Addressed
The original Lambda-based approach had a 15-minute timeout limit, which is insufficient for deleting long-running resources like EKS clusters and Aurora databases that can take 30+ minutes to delete.

## Solution: Step Functions Native CloudFormation Integration

### Key Changes Made

#### 1. Replaced Lambda-based Deletion with Step Functions Native Calls
**Before**: Single Lambda function that waited for stack deletion completion
**After**: Step Functions using native AWS SDK integration with async polling

#### 2. New State Machine Flow
```
CheckStackExists → StackExistsChoice → DeleteStack → WaitForDeletion → CheckDeletionStatus
                                   ↓
                              StackNotFound (skip)
```

#### 3. Async Polling Pattern
- **DeleteStack**: Uses `arn:aws:states:::aws-sdk:cloudformation:deleteStack`
- **WaitForDeletion**: 30-second wait between status checks
- **CheckDeletionStatus**: Uses `arn:aws:states:::aws-sdk:cloudformation:describeStacks`
- **Loop**: Continues until stack is deleted or fails

#### 4. Simplified Lambda Function
**Old**: `rCDKStackDeleterFunction` (900s timeout, complex deletion logic)
**New**: `rCDKStackCheckerFunction` (60s timeout, simple existence check)

```python
def handler(event, context):
    stack_name = event['stackName'].strip()
    if not stack_name:
        return {'exists': False}

    cf_client = boto3.client('cloudformation')
    try:
        cf_client.describe_stacks(StackName=stack_name)
        return {'exists': True}
    except cf_client.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            return {'exists': False}
        raise
```

#### 5. Enhanced Error Handling
- **ValidationError**: Catches when stack no longer exists (successful deletion)
- **Graceful Failures**: Failed deletions don't stop the entire process
- **Status Evaluation**: Handles all CloudFormation stack states

## Benefits of Async Approach

### 1. No Timeout Limitations
- Step Functions can run for up to 1 year
- Each individual step has appropriate timeouts
- No 15-minute Lambda limitation

### 2. Better Resource Utilization
- Lambda only runs for quick checks (60s max)
- Step Functions handles the waiting asynchronously
- No compute resources wasted during wait periods

### 3. Improved Observability
- Each step is visible in Step Functions console
- Clear state transitions for debugging
- Detailed execution history

### 4. Cost Optimization
- Lambda execution time reduced from 900s to 60s
- Step Functions state transitions are very low cost
- No continuous compute during wait periods

## State Machine States Explained

| State | Purpose | Timeout | Error Handling |
|-------|---------|---------|----------------|
| `CheckStackExists` | Verify stack exists before deletion | 60s | Skip if check fails |
| `DeleteStack` | Initiate CloudFormation deletion | 30s | Catch all errors |
| `WaitForDeletion` | Wait 30 seconds between checks | 30s | None needed |
| `CheckDeletionStatus` | Get current stack status | 30s | ValidationError = success |
| `EvaluateDeletionStatus` | Decide next action based on status | N/A | Default to failed |

## Supported Stack States
- `DELETE_IN_PROGRESS`: Continue waiting
- `DELETE_COMPLETE`: Success, move to next stack
- `DELETE_FAILED`: Log failure, continue with other stacks
- Stack not found (ValidationError): Deletion successful

## Maximum Execution Time
With 30-second intervals, the system can theoretically wait indefinitely, but practical limits:
- EKS clusters: ~20-45 minutes
- Aurora clusters: ~15-30 minutes
- Most other resources: <10 minutes

The async approach easily handles all these scenarios without timeout issues.
