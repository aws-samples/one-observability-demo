#!/bin/bash

if [[ -z "$1" ]]; then
    echo "Error: .env file location is required"
    echo "Usage: $0 <path-to-.env-file>"
    exit 1
fi

ENV_FILE="$1"
AUTO_TRANSACTION_SEARCH_CONFIGURED=""

# Function to read existing .env file
read_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        while IFS='=' read -r key value; do
            [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
            value="${value%\"}"
            value="${value#\"}"
            if [[ "$key" == "AUTO_TRANSACTION_SEARCH_CONFIGURED" ]]; then
                AUTO_TRANSACTION_SEARCH_CONFIGURED="$value"
            fi
        done < "$ENV_FILE"
    fi
}

# Function to write .env file
write_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        grep -v "^AUTO_TRANSACTION_SEARCH_CONFIGURED=" "$ENV_FILE" > "$ENV_FILE.tmp"
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED" >> "$ENV_FILE"
}

# Validation function for AUTO_TRANSACTION_SEARCH_CONFIGURED
validate_auto_transaction_search() {
    local result
    local error_output

    error_output=$(mktemp)
    result=$(aws xray get-trace-segment-destination --query 'Destination' --output text 2>"$error_output")
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo "Error: AWS CLI command failed" >&2
        cat "$error_output" >&2
        rm -f "$error_output"
        exit 1
    fi
    rm -f "$error_output"

    if [[ "$result" == "CloudWatchLogs" ]]; then
        AUTO_TRANSACTION_SEARCH_CONFIGURED="true"
    else
        AUTO_TRANSACTION_SEARCH_CONFIGURED="false"
    fi
}

# Main execution
main() {
    read_env_file
    validate_auto_transaction_search
    write_env_file

    echo "Validation complete. Updated .env file:"
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED"
}

main "$@"