#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../bin/environment.ts"
PARAMETER_KEY="$1"

if [[ -z "$PARAMETER_KEY" ]]; then
    echo "-1"
    exit 0
fi

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null 2>&1; then
    echo "-2"
    exit 0
fi

# Extract PARAMETER_STORE_PREFIX from environment.ts
PARAMETER_STORE_PREFIX=$(grep "PARAMETER_STORE_PREFIX = " "$ENV_FILE" 2>/dev/null | sed "s/.*= '\(.*\)';/\1/")

if [[ -z "$PARAMETER_STORE_PREFIX" ]]; then
    echo "-1"
    exit 0
fi

FULL_PARAMETER_NAME="${PARAMETER_STORE_PREFIX}/${PARAMETER_KEY}"

# Try to get parameter, handle errors silently
RESULT=$(aws ssm get-parameter --name "$FULL_PARAMETER_NAME" --query 'Parameter.Value' --output text 2>/dev/null)
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
    echo "$RESULT"
elif [[ $EXIT_CODE -eq 255 ]] && aws ssm get-parameter --name "$FULL_PARAMETER_NAME" 2>&1 | grep -q "AccessDenied\|UnauthorizedOperation"; then
    echo "-2"
else
    echo "-1"
fi