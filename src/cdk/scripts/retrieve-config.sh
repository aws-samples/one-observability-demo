#!/bin/bash

# Script to retrieve configuration from Parameter Store and create .env file
# This script is used by CodeBuild jobs to get configuration parameters

set -e

PARAMETER_STORE_BASE_PATH="$1"
TARGET_ENV_FILE="${2:-.env}"

if [ -z "$PARAMETER_STORE_BASE_PATH" ]; then
    echo "Usage: $0 <parameter-store-base-path> [target-env-file]"
    echo "Example: $0 /oneobservability/workshop .env"
    exit 1
fi

echo "=============================================="
echo "Retrieving configuration from Parameter Store"
echo "Base path: $PARAMETER_STORE_BASE_PATH"
echo "Target file: $TARGET_ENV_FILE"
echo "=============================================="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI is not installed or not available in PATH"
    exit 1
fi

# Retrieve parameters from Parameter Store and format as .env
echo "Fetching parameters..."
aws ssm get-parameters-by-path \
    --path "$PARAMETER_STORE_BASE_PATH" \
    --recursive \
    --with-decryption \
    --query "Parameters[*].[Name,Value]" \
    --output text | \
    sed "s|$PARAMETER_STORE_BASE_PATH/||g" | \
    sed 's/\t/=/g' > "$TARGET_ENV_FILE"

if [ $? -eq 0 ] && [ -s "$TARGET_ENV_FILE" ]; then
    echo "Configuration successfully retrieved from Parameter Store:"
    echo "----------------------------------------------"
    cat "$TARGET_ENV_FILE"
    echo "----------------------------------------------"
    echo "Configuration file created at: $TARGET_ENV_FILE"
else
    echo "WARNING: No parameters found or failed to retrieve from Parameter Store"
    echo "Checking for existing .env file..."

    if [ -f ".env" ]; then
        echo "Using existing local .env file:"
        echo "----------------------------------------------"
        cat .env
        echo "----------------------------------------------"
    else
        echo "No .env file found. Creating empty configuration file."
        touch "$TARGET_ENV_FILE"
    fi
fi

echo "Configuration setup completed."
