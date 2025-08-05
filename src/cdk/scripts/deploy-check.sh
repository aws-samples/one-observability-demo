#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

# Parse command line arguments
PUSH_FLAG=false
if [[ "$1" == "--push" ]]; then
    PUSH_FLAG=true
fi

ENV_FILE=".env"

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env file must exist at $ENV_FILE"
    exit 1
fi

# Load environment variables
source "$ENV_FILE"

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
    echo "Error: Valid AWS credentials not found. Please assume a role in the target account."
    exit 1
fi

# Print current AWS info
CALLER_IDENTITY=$(aws sts get-caller-identity)
ROLE_ARN=$(echo "$CALLER_IDENTITY" | jq -r '.Arn')
ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | jq -r '.Account')
REGION=$(aws configure get region)

echo "Current AWS Role: $ROLE_ARN"
echo "Account ID: $ACCOUNT_ID"
echo "Region: $REGION"

# Check if bucket exists
if ! aws s3api head-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null; then
    if [[ "$PUSH_FLAG" == true ]]; then
        aws s3 mb "s3://$CONFIG_BUCKET"
        aws s3api put-bucket-versioning --bucket "$CONFIG_BUCKET" --versioning-configuration Status=Enabled
        echo "Bucket created successfully with versioning enabled."
    else
        read -p "Bucket $CONFIG_BUCKET does not exist. Create it? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            aws s3 mb "s3://$CONFIG_BUCKET"
            aws s3api put-bucket-versioning --bucket "$CONFIG_BUCKET" --versioning-configuration Status=Enabled
            echo "Bucket created successfully with versioning enabled."
        else
            echo "Bucket creation cancelled."
            exit 1
        fi
    fi
fi

# Check if repo.zip exists or push flag is set
OBJECT_KEY="repo/refs/heads/${BRANCH_NAME}/repo.zip"
if [[ "$PUSH_FLAG" == true ]] || ! aws s3api head-object --bucket "$CONFIG_BUCKET" --key "$OBJECT_KEY" &>/dev/null; then
    if [[ "$PUSH_FLAG" == true ]]; then
        echo "Push flag detected. Overriding repository content..."
        TEMP_REMOTE="temp-s3-remote"
        git remote add "$TEMP_REMOTE" "s3+zip://${CONFIG_BUCKET}/repo"
        git push "$TEMP_REMOTE" "$BRANCH_NAME"
        git remote remove "$TEMP_REMOTE"
        echo "Repository pushed to S3 successfully."
    else
        read -p "Object $OBJECT_KEY does not exist. Create it? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            TEMP_REMOTE="temp-s3-remote"
            git remote add "$TEMP_REMOTE" "s3+zip://${CONFIG_BUCKET}/repo"
            git push "$TEMP_REMOTE" "$BRANCH_NAME"
            git remote remove "$TEMP_REMOTE"
            echo "Repository pushed to S3 successfully."
        else
            echo "Repository upload cancelled."
            exit 1
        fi
    fi
fi

echo "All checks completed successfully."