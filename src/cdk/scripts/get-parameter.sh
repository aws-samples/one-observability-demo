#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../bin/environment.ts"
PARAMETER_KEY="$1"

if [[ -z "$PARAMETER_KEY" ]]; then
    echo "Error: No parameter key provided" >&2
    echo "-1"
    exit 0
fi

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null 2>&1; then
    echo "Error: AWS credentials not configured" >&2
    echo "-2"
    exit 0
fi

# Extract PARAMETER_STORE_PREFIX from environment.ts
PARAMETER_STORE_PREFIX=$(grep "PARAMETER_STORE_PREFIX = " "$ENV_FILE" 2>/dev/null | sed "s/.*= '\(.*\)';/\1/")

if [[ -z "$PARAMETER_STORE_PREFIX" ]]; then
    echo "Error: Could not extract PARAMETER_STORE_PREFIX from $ENV_FILE" >&2
    echo "-1"
    exit 0
fi

FULL_PARAMETER_NAME="${PARAMETER_STORE_PREFIX}/${PARAMETER_KEY}"

echo "Retrieving parameter: $FULL_PARAMETER_NAME" >&2

# Try to get parameter
RESULT=$(aws ssm get-parameter --name "$FULL_PARAMETER_NAME" --query 'Parameter.Value' --output text 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
    echo "$RESULT"
elif echo "$RESULT" | grep -q "AccessDenied\|UnauthorizedOperation"; then
    echo "Error: Access denied to parameter $FULL_PARAMETER_NAME" >&2
    echo "-2"
else
    echo "Error: Parameter $FULL_PARAMETER_NAME not found" >&2
    echo "-1"
fi