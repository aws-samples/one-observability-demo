#!/bin/bash

if [[ -z "$1" ]]; then
    echo "Error: .env file location is required"
    echo "Usage: $0 <path-to-.env-file>"
    exit 1
fi

ENV_FILE="$1"
AUTO_TRANSACTION_SEARCH_CONFIGURED=""
ENABLE_PET_FOOD_AGENT=""
AWS_REGION=""
AVAILABILITY_ZONES=""

# Function to read existing .env file
read_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        while IFS='=' read -r key value; do
            [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
            value="${value%\"}"
            value="${value#\"}"
            if [[ "$key" == "AUTO_TRANSACTION_SEARCH_CONFIGURED" ]]; then
                AUTO_TRANSACTION_SEARCH_CONFIGURED="$value"
            elif [[ "$key" == "ENABLE_PET_FOOD_AGENT" ]]; then
                ENABLE_PET_FOOD_AGENT="$value"
            elif [[ "$key" == "AWS_REGION" ]]; then
                AWS_REGION="$value"
            fi
        done < "$ENV_FILE"
    fi
}

# Function to write .env file
write_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        grep -v "^AUTO_TRANSACTION_SEARCH_CONFIGURED=\|^AVAILABILITY_ZONES=" "$ENV_FILE" > "$ENV_FILE.tmp"
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED" >> "$ENV_FILE"
    if [[ -n "$AVAILABILITY_ZONES" ]]; then
        echo "AVAILABILITY_ZONES=$AVAILABILITY_ZONES" >> "$ENV_FILE"
    fi
}

# Validation function for AUTO_TRANSACTION_SEARCH_CONFIGURED
validate_auto_transaction_search() {
    local region="${AWS_REGION:-$AWS_DEFAULT_REGION}"
    local result
    local error_output

    error_output=$(mktemp)
    result=$(aws xray get-trace-segment-destination --region "$region" --query 'Destination' --output text 2>"$error_output")
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

# Function to retrieve and map availability zones
retrieve_availability_zones() {
    local region="${AWS_REGION:-$AWS_DEFAULT_REGION}"
    if [[ "$ENABLE_PET_FOOD_AGENT" == "true" && -n "$region" ]]; then
        local az_data
        local error_output

        error_output=$(mktemp)
        az_data=$(aws ec2 describe-availability-zones --region "$region" --query "AvailabilityZones[].{ZoneName:ZoneName,ZoneId:ZoneId}" --output json 2>"$error_output")
        local exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            echo "Error: Failed to retrieve availability zones" >&2
            cat "$error_output" >&2
            rm -f "$error_output"
            exit 1
        fi
        rm -f "$error_output"

        local region_az_map
        case "$region" in
            us-west-2)
                region_az_map="usw2-az1,usw2-az2,usw2-az3"
                ;;
            us-east-1)
                region_az_map="use1-az1,use1-az2,use1-az4"
                ;;
            eu-central-1)
                region_az_map="euc1-az1,euc1-az2,euc1-az3"
                ;;
            ap-southeast-2)
                region_az_map="apse2-az1,apse2-az2,apse2-az3"
                ;;
            *)
                echo "Error: Agent Core is not supported in region: $region" >&2
                exit 1
                ;;
        esac

        local mapped_zones=()
        IFS=',' read -ra target_zones <<< "$region_az_map"

        for target_zone in "${target_zones[@]}"; do
            local zone_name=$(echo "$az_data" | jq -r ".[] | select(.ZoneId == \"$target_zone\") | .ZoneName")
            if [[ -n "$zone_name" ]]; then
                mapped_zones+=("$zone_name")
            fi
        done

        AVAILABILITY_ZONES=$(IFS=','; echo "${mapped_zones[*]}")
    fi
}

# Main execution
main() {
    read_env_file
    validate_auto_transaction_search
    retrieve_availability_zones
    write_env_file

    echo "Validation complete. Updated .env file:"
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED"
    if [[ -n "$AVAILABILITY_ZONES" ]]; then
        echo "AVAILABILITY_ZONES=$AVAILABILITY_ZONES"
    fi
    echo "Contents of $ENV_FILE after script:"
    cat "$ENV_FILE"
}

main "$@"