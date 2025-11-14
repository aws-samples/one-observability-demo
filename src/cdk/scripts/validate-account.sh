#!/bin/bash

CLEAN_MODE=false
ENV_FILE=""

# Parse arguments
for arg in "$@"; do
    if [[ "$arg" == "--clean" ]]; then
        CLEAN_MODE=true
    elif [[ -z "$ENV_FILE" ]]; then
        ENV_FILE="$arg"
    fi
done

if [[ -z "$ENV_FILE" ]]; then
    echo "Error: .env file location is required"
    echo "Usage: $0 <path-to-.env-file> [--clean]"
    exit 1
fi

echo "[DEBUG] CLEAN_MODE=$CLEAN_MODE"
echo "[DEBUG] ENV_FILE=$ENV_FILE"
AUTO_TRANSACTION_SEARCH_CONFIGURED=""
ENABLE_PET_FOOD_AGENT=""
AWS_REGION="${AWS_REGION:-}"
AVAILABILITY_ZONES=""
EKS_CLUSTER_ACCESS_ROLE_NAME=""

# Log initial environment variable values
if [[ -n "$AWS_REGION" ]]; then
    echo "[INFO] AWS_REGION from environment: $AWS_REGION"
fi

# Function to read existing .env file
read_env_file() {
    echo "[INFO] Reading .env file: $ENV_FILE"
    if [[ -f "$ENV_FILE" ]]; then
        while IFS='=' read -r key value || [[ -n "$key" ]]; do
            [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
            value="${value%\"}"
            value="${value#\"}"
            value="$(echo "$value" | xargs)"
            if [[ "$key" == "AUTO_TRANSACTION_SEARCH_CONFIGURED" ]]; then
                AUTO_TRANSACTION_SEARCH_CONFIGURED="$value"
            elif [[ "$key" == "ENABLE_PET_FOOD_AGENT" ]]; then
                ENABLE_PET_FOOD_AGENT="$value"
                echo "[INFO] ENABLE_PET_FOOD_AGENT from .env: $value"
            elif [[ "$key" == "AWS_REGION" ]]; then
                if [[ -z "$AWS_REGION" ]]; then
                    AWS_REGION="$value"
                    echo "[INFO] AWS_REGION from .env: $value"
                else
                    echo "[INFO] AWS_REGION from .env ignored (using environment value): $AWS_REGION"
                fi
            elif [[ "$key" == "EKS_CLUSTER_ACCESS_ROLE_NAME" ]]; then
                EKS_CLUSTER_ACCESS_ROLE_NAME="$value"
                echo "[INFO] EKS_CLUSTER_ACCESS_ROLE_NAME from .env: $value"
            fi
        done < "$ENV_FILE"
    else
        echo "[WARN] .env file not found: $ENV_FILE"
    fi
}

# Function to write .env file
write_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        grep -v "^AUTO_TRANSACTION_SEARCH_CONFIGURED=\|^AVAILABILITY_ZONES=\|^EKS_CLUSTER_ACCESS_ROLE_NAME=" "$ENV_FILE" > "$ENV_FILE.tmp"
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED" >> "$ENV_FILE"
    if [[ -n "$AVAILABILITY_ZONES" ]]; then
        echo "AVAILABILITY_ZONES=$AVAILABILITY_ZONES" >> "$ENV_FILE"
    fi
    if [[ -n "$EKS_CLUSTER_ACCESS_ROLE_NAME" ]]; then
        echo "EKS_CLUSTER_ACCESS_ROLE_NAME=$EKS_CLUSTER_ACCESS_ROLE_NAME" >> "$ENV_FILE"
    fi
}

# Validation function for AUTO_TRANSACTION_SEARCH_CONFIGURED
validate_auto_transaction_search() {
    local region="$AWS_REGION"
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

# Function to validate EKS cluster access role
validate_eks_role() {
    if [[ -n "$EKS_CLUSTER_ACCESS_ROLE_NAME" ]]; then
        echo "[INFO] Validating IAM role: $EKS_CLUSTER_ACCESS_ROLE_NAME"
        local error_output
        error_output=$(mktemp)

        if aws iam get-role --role-name "$EKS_CLUSTER_ACCESS_ROLE_NAME" > /dev/null 2>"$error_output"; then
            echo "[INFO] IAM role exists: $EKS_CLUSTER_ACCESS_ROLE_NAME"
        else
            echo "[WARN] IAM role does not exist: $EKS_CLUSTER_ACCESS_ROLE_NAME. Removing from .env file."
            EKS_CLUSTER_ACCESS_ROLE_NAME=""
        fi
        rm -f "$error_output"
    fi
}

# Function to validate cross-region support stack
validate_support_stack() {
    echo "[INFO] Checking for OneObservability-support stacks"
    echo "[DEBUG] CLEAN_MODE in validate_support_stack: $CLEAN_MODE"
    local regions=("$AWS_REGION" "us-east-1")
    local found_resources=false

    for region in "${regions[@]}"; do
        echo "[DEBUG] Checking region: $region"
        local stacks=$(aws cloudformation list-stacks --region "$region" --query "StackSummaries[?starts_with(StackName, 'OneObservability-support') && StackStatus != 'DELETE_COMPLETE'].StackName" --output text 2>/dev/null)
        if [[ -n "$stacks" ]]; then
            found_resources=true
            echo "[DEBUG] Found stacks in $region: $stacks"
            if [[ "$CLEAN_MODE" == "true" ]]; then
                echo "[INFO] Deleting stack(s) in $region: $stacks"
                for stack in $stacks; do
                    echo "[DEBUG] Deleting stack: $stack"
                    aws cloudformation delete-stack --region "$region" --stack-name "$stack"
                    echo "[DEBUG] Waiting for stack deletion: $stack"
                    aws cloudformation wait stack-delete-complete --region "$region" --stack-name "$stack" 2>/dev/null || true
                    echo "[DEBUG] Stack deletion complete: $stack"
                done
            else
                echo "[WARN] OneObservability-support stack exists in $region: $stacks"
            fi
        fi
    done

    echo "[DEBUG] Checking for S3 buckets"
    local buckets=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'oneobservability-support-')].Name" --output text 2>/dev/null)
    if [[ -n "$buckets" ]]; then
        found_resources=true
        echo "[DEBUG] Found buckets: $buckets"
        if [[ "$CLEAN_MODE" == "true" ]]; then
            echo "[INFO] Deleting bucket(s): $buckets"
            for bucket in $buckets; do
                echo "[DEBUG] Emptying bucket: $bucket"
                aws s3 rm "s3://$bucket" --recursive
                echo "[DEBUG] Deleting bucket: $bucket"
                aws s3api delete-bucket --bucket "$bucket"
                echo "[DEBUG] Bucket deletion complete: $bucket"
            done
        else
            echo "[WARN] S3 bucket(s) with prefix 'oneobservability-support-' exist and need to be deleted: $buckets"
        fi
    fi

    echo "[DEBUG] found_resources=$found_resources, CLEAN_MODE=$CLEAN_MODE"
    if [[ "$found_resources" == "true" && "$CLEAN_MODE" == "false" ]]; then
        echo "[ERROR] OneObservability-support resources found. Run with --clean to remove them."
        exit 1
    elif [[ "$found_resources" == "true" && "$CLEAN_MODE" == "true" ]]; then
        echo "[INFO] Cleanup completed successfully"
    fi
}

# Function to retrieve and map availability zones
retrieve_availability_zones() {
    local region="$AWS_REGION"
    echo "[INFO] Checking AZ retrieval conditions: ENABLE_PET_FOOD_AGENT=$ENABLE_PET_FOOD_AGENT, region=$region"
    if [[ "$ENABLE_PET_FOOD_AGENT" == "true" && -n "$region" ]]; then
        echo "[INFO] Retrieving availability zones for region: $region"
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
            us-east-1)
                region_az_map="use1-az1,use1-az2,use1-az4"
                ;;
            us-east-2)
                region_az_map="use2-az1,use2-az2,use2-az3"
                ;;
            us-west-2)
                region_az_map="usw2-az1,usw2-az2,usw2-az3"
                ;;
            ap-southeast-2)
                region_az_map="apse2-az1,apse2-az2,apse2-az3"
                ;;
            ap-south-1)
                region_az_map="aps1-az1,aps1-az2,aps1-az3"
                ;;
            ap-southeast-1)
                region_az_map="apse1-az1,apse1-az2,apse1-az3"
                ;;
            ap-northeast-1)
                region_az_map="apne1-az1,apne1-az2,apne1-az4"
                ;;
            eu-west-1)
                region_az_map="euw1-az1,euw1-az2,euw1-az3"
                ;;
            eu-central-1)
                region_az_map="euc1-az1,euc1-az2,euc1-az3"
                ;;
            *)
                echo "Error: Agent Core is not supported in region: $region" >&2
                exit 1
                ;;
        esac
        echo "[INFO] Target zone IDs for $region: $region_az_map"

        local mapped_zones=()
        IFS=',' read -ra target_zones <<< "$region_az_map"

        for target_zone in "${target_zones[@]}"; do
            local zone_name=$(echo "$az_data" | jq -r ".[] | select(.ZoneId == \"$target_zone\") | .ZoneName")
            if [[ -n "$zone_name" ]]; then
                mapped_zones+=("$zone_name")
            fi
        done

        AVAILABILITY_ZONES=$(IFS=','; echo "${mapped_zones[*]}")
        echo "[INFO] Mapped availability zones: $AVAILABILITY_ZONES"
    else
        echo "[INFO] Skipping AZ retrieval (ENABLE_PET_FOOD_AGENT=$ENABLE_PET_FOOD_AGENT, region=$region)"
    fi
}

# Main execution
main() {
    read_env_file
    validate_auto_transaction_search
    validate_eks_role
    validate_support_stack
    retrieve_availability_zones
    write_env_file

    echo "Validation complete. Updated .env file:"
    echo "AUTO_TRANSACTION_SEARCH_CONFIGURED=$AUTO_TRANSACTION_SEARCH_CONFIGURED"
    if [[ -n "$AVAILABILITY_ZONES" ]]; then
        echo "AVAILABILITY_ZONES=$AVAILABILITY_ZONES"
    fi
    if [[ -n "$EKS_CLUSTER_ACCESS_ROLE_NAME" ]]; then
        echo "EKS_CLUSTER_ACCESS_ROLE_NAME=$EKS_CLUSTER_ACCESS_ROLE_NAME"
    fi
}

main "$@"