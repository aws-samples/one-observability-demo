#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_FILE="$SCRIPT_DIR/seed.json"
TABLE_NAME="$1"

# Check if seed.json exists
if [[ ! -f "$SEED_FILE" ]]; then
    echo "Error: seed.json file not found at $SEED_FILE"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
    echo "Error: Valid AWS credentials not found. Please configure AWS CLI."
    exit 1
fi

if [[ -n "$TABLE_NAME" ]]; then
    SELECTED_TABLE="$TABLE_NAME"
else
    echo "Fetching DynamoDB tables..."
    TABLES=$(aws dynamodb list-tables --query 'TableNames' --output text)

    if [[ -z "$TABLES" ]]; then
        echo "No DynamoDB tables found in the current region."
        exit 1
    fi

    # Find table containing "Petadoption"
    DEFAULT_TABLE=""
    TABLE_ARRAY=($TABLES)
    for table in "${TABLE_ARRAY[@]}"; do
        if [[ "$table" == *"Petadoption"* ]]; then
            DEFAULT_TABLE="$table"
            break
        fi
    done

    echo "Available DynamoDB tables:"
    select table in $TABLES; do
        if [[ -n "$table" ]]; then
            SELECTED_TABLE="$table"
            break
        else
            echo "Invalid selection. Please try again."
        fi
    done

    # Set default if Petadoption table found
    if [[ -n "$DEFAULT_TABLE" && "$SELECTED_TABLE" != "$DEFAULT_TABLE" ]]; then
        read -p "Use $DEFAULT_TABLE instead? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            SELECTED_TABLE="$DEFAULT_TABLE"
        fi
    fi
fi

echo "Seeding table: $SELECTED_TABLE"

# Read and process seed data
jq -c '.[]' "$SEED_FILE" | while read -r item; do
    petid=$(echo "$item" | jq -r '.petid')
    echo "Inserting item with petid: $petid"

    # Convert JSON to DynamoDB format
    dynamo_item=$(echo "$item" | jq 'with_entries(select(.value != null and .key != null)) | with_entries(.value = {S: (.value | tostring)})')

    aws dynamodb put-item \
        --table-name "$SELECTED_TABLE" \
        --item "$dynamo_item"
done

echo "Successfully seeded $SELECTED_TABLE with data from $SEED_FILE"