#!/bin/bash

ENV_FILE=".env"
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
    result=$(aws xray get-trace-segment-destination --query 'Destination' --output text 2>/dev/null)

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