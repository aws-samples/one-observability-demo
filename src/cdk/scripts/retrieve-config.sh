#!/bin/bash

# Script to retrieve configuration from Parameter Store and create .env file
# This script is used by CodeBuild jobs to get configuration parameters

set -e

PARAMETER_NAME="$1"
TARGET_ENV_FILE="${2:-.env}"

if [ -z "$PARAMETER_NAME" ]; then
    echo "Usage: $0 <parameter-name> [target-env-file]"
    echo "Example: $0 /oneobservability/workshop/MyStack/config .env"
    exit 1
fi

echo "=============================================="
echo "Retrieving configuration from Parameter Store"
echo "Parameter name: $PARAMETER_NAME"
echo "Target file: $TARGET_ENV_FILE"
echo "=============================================="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI is not installed or not available in PATH"
    exit 1
fi

# Retrieve the single parameter containing the complete .env content
echo "Fetching configuration parameter..."
CONFIG_CONTENT=$(aws ssm get-parameter \
    --name "$PARAMETER_NAME" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$CONFIG_CONTENT" ]; then
    echo "$CONFIG_CONTENT" > "$TARGET_ENV_FILE"
    echo "Configuration successfully retrieved from Parameter Store:"
    echo "----------------------------------------------"
    cat "$TARGET_ENV_FILE"
    echo "----------------------------------------------"
    echo "Configuration file created at: $TARGET_ENV_FILE"
else
    echo "WARNING: Parameter '$PARAMETER_NAME' not found or failed to retrieve from Parameter Store"
    echo "Checking for existing .env file..."

    if [ -f ".env" ]; then
        echo "Using existing local .env file:"
        echo "----------------------------------------------"
        cat .env
        echo "----------------------------------------------"
        cp .env "$TARGET_ENV_FILE"
    else
        echo "No .env file found. Creating empty configuration file."
        touch "$TARGET_ENV_FILE"
    fi
fi

echo "Configuration setup completed."
