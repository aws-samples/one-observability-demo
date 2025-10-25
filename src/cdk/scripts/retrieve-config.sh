#!/bin/bash

# Script to retrieve configuration from Parameter Store and create .env file
# This script is used by CodeBuild jobs to get configuration parameters
#
# Enhanced with improved error handling, logging, and troubleshooting support

# Exit on any error, but we'll handle errors explicitly
set -eE

# Configuration
SCRIPT_NAME=$(basename "$0")
LOG_LEVEL="${LOG_LEVEL:-INFO}"  # DEBUG, INFO, WARN, ERROR
PARAMETER_NAME="$1"
TARGET_ENV_FILE="${2:-.env}"

# Colors for output (if terminal supports them)
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_debug() {
    if [[ "$LOG_LEVEL" == "DEBUG" ]]; then
        echo -e "${BLUE}[DEBUG]${NC} $*" >&2
    fi
}

log_info() {
    if [[ "$LOG_LEVEL" =~ ^(DEBUG|INFO)$ ]]; then
        echo -e "${GREEN}[INFO]${NC} $*" >&2
    fi
}

log_warn() {
    if [[ "$LOG_LEVEL" =~ ^(DEBUG|INFO|WARN)$ ]]; then
        echo -e "${YELLOW}[WARN]${NC} $*" >&2
    fi
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Error handler
error_handler() {
    local exit_code=$?
    local line_number=$1
    log_error "Script failed at line $line_number with exit code $exit_code"
    log_error "Current working directory: $(pwd)"
    log_error "Environment variables:"
    env | grep -E "^(AWS_|PARAMETER_|TARGET_)" | while read -r var; do
        log_error "  $var"
    done
    exit $exit_code
}

# Set up error trapping
trap 'error_handler $LINENO' ERR

# Validation function
validate_inputs() {
    log_debug "Validating script inputs..."

    if [ -z "$PARAMETER_NAME" ]; then
        log_error "Missing required parameter: PARAMETER_NAME"
        echo
        echo "Usage: $SCRIPT_NAME <parameter-name> [target-env-file]"
        echo "Example: $SCRIPT_NAME /oneobservability/workshop/MyStack/config .env"
        echo
        echo "Environment variables:"
        echo "  LOG_LEVEL=DEBUG|INFO|WARN|ERROR  (default: INFO)"
        exit 1
    fi

    # Validate parameter name format
    if [[ ! "$PARAMETER_NAME" =~ ^/ ]]; then
        log_warn "Parameter name should typically start with '/' for SSM parameters"
        log_warn "Current parameter name: '$PARAMETER_NAME'"
    fi

    log_debug "Parameter name: '$PARAMETER_NAME'"
    log_debug "Target file: '$TARGET_ENV_FILE'"
}

# AWS CLI validation
validate_aws_cli() {
    log_debug "Validating AWS CLI installation and credentials..."

    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed or not available in PATH"
        log_error "Please install AWS CLI: https://aws.amazon.com/cli/"
        exit 1
    fi

    local aws_version
    aws_version=$(aws --version 2>&1 | head -n1)
    log_debug "AWS CLI version: $aws_version"

    # Test AWS credentials
    log_debug "Testing AWS credentials..."
    local identity_output
    if identity_output=$(aws sts get-caller-identity 2>&1); then
        local account_id
        local user_arn
        account_id=$(echo "$identity_output" | jq -r '.Account' 2>/dev/null || echo "unknown")
        user_arn=$(echo "$identity_output" | jq -r '.Arn' 2>/dev/null || echo "unknown")
        log_debug "AWS Account ID: $account_id"
        log_debug "AWS User/Role ARN: $user_arn"
    else
        log_error "AWS credentials validation failed:"
        log_error "$identity_output"
        log_error ""
        log_error "Please configure AWS credentials using one of:"
        log_error "  - AWS CLI: aws configure"
        log_error "  - Environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
        log_error "  - IAM roles (for EC2/ECS/Lambda)"
        log_error "  - AWS SSO: aws sso login"
        exit 1
    fi

    # Check current region
    local current_region
    current_region=$(aws configure get region 2>/dev/null || echo "${AWS_REGION:-not set}")
    log_debug "AWS Region: $current_region"
}

# Parameter retrieval with detailed error handling
retrieve_parameter() {
    log_info "=============================================="
    log_info "Retrieving configuration from Parameter Store"
    log_info "Parameter name: $PARAMETER_NAME"
    log_info "Target file: $TARGET_ENV_FILE"
    log_info "=============================================="

    log_debug "Attempting to retrieve parameter from SSM..."

    local ssm_output
    local ssm_error
    local exit_code

    # Capture both stdout and stderr
    set +e  # Temporarily disable exit on error
    {
        ssm_output=$(aws ssm get-parameter \
            --name "$PARAMETER_NAME" \
            --with-decryption \
            --query "Parameter.Value" \
            --output text 2>&1)
        exit_code=$?
    }
    set -e  # Re-enable exit on error

    log_debug "AWS SSM command exit code: $exit_code"

    if [ $exit_code -eq 0 ] && [ -n "$ssm_output" ] && [ "$ssm_output" != "None" ]; then
        # Success case
        log_info "Parameter retrieved successfully"
        log_debug "Parameter content length: ${#ssm_output} characters"

        # Validate content format (basic checks)
        if [[ "$ssm_output" == *"="* ]]; then
            log_debug "Content appears to contain environment variable assignments"
        else
            log_warn "Content does not appear to contain typical .env format (no '=' found)"
        fi

        # Write to file
        echo "$ssm_output" > "$TARGET_ENV_FILE"

        if [ -f "$TARGET_ENV_FILE" ]; then
            local file_size
            file_size=$(wc -c < "$TARGET_ENV_FILE" 2>/dev/null || echo "0")
            log_info "Configuration file created: $TARGET_ENV_FILE ($file_size bytes)"

            # Show content (be careful with sensitive data)
            if [[ "$LOG_LEVEL" == "DEBUG" ]]; then
                log_debug "Configuration file contents:"
                log_debug "----------------------------------------------"
                cat "$TARGET_ENV_FILE" | sed 's/\(.*=\).*/\1[REDACTED]/' >&2
                log_debug "----------------------------------------------"
            else
                log_info "Configuration contains $(wc -l < "$TARGET_ENV_FILE") lines"
            fi
        else
            log_error "Failed to create configuration file"
            exit 1
        fi

        return 0
    else
        # Error case - analyze the specific error
        log_warn "Failed to retrieve parameter from SSM (exit code: $exit_code)"

        # Analyze error message for common issues
        if echo "$ssm_output" | grep -q "ParameterNotFound"; then
            log_error "Parameter '$PARAMETER_NAME' does not exist in Parameter Store"
            log_error "Troubleshooting steps:"
            log_error "  1. Verify the parameter name is correct"
            log_error "  2. Check if the parameter exists: aws ssm describe-parameters --parameter-filters \"Key=Name,Values=$PARAMETER_NAME\""
            log_error "  3. Verify you have access to the parameter"
        elif echo "$ssm_output" | grep -q "AccessDenied"; then
            log_error "Access denied to parameter '$PARAMETER_NAME'"
            log_error "Troubleshooting steps:"
            log_error "  1. Check IAM permissions for ssm:GetParameter"
            log_error "  2. For encrypted parameters, ensure kms:Decrypt permissions"
            log_error "  3. Verify resource-based policies on the parameter"
        elif echo "$ssm_output" | grep -q "InvalidRequestException"; then
            log_error "Invalid request format"
            log_error "Parameter name: '$PARAMETER_NAME'"
        else
            log_error "Unexpected error retrieving parameter:"
            log_error "$ssm_output"
        fi

        return 1
    fi
}

# Fallback handling
handle_fallback() {
    log_warn "Attempting fallback options..."

    # Try to use existing .env file
    if [ -f ".env" ]; then
        log_info "Found existing .env file, using as fallback"

        local env_size
        env_size=$(wc -c < ".env" 2>/dev/null || echo "0")
        log_debug "Existing .env file size: $env_size bytes"

        if [ "$env_size" -gt 0 ]; then
            cp ".env" "$TARGET_ENV_FILE"
            log_info "Copied existing .env to $TARGET_ENV_FILE"

            if [[ "$LOG_LEVEL" == "DEBUG" ]]; then
                log_debug "Existing .env contents:"
                log_debug "----------------------------------------------"
                cat ".env" | sed 's/\(.*=\).*/\1[REDACTED]/' >&2
                log_debug "----------------------------------------------"
            fi

            return 0
        else
            log_warn "Existing .env file is empty"
        fi
    fi

    # Create empty file as last resort
    log_warn "No existing .env file found or it's empty"
    log_warn "Creating empty configuration file as last resort"

    touch "$TARGET_ENV_FILE"

    if [ -f "$TARGET_ENV_FILE" ]; then
        log_info "Created empty configuration file: $TARGET_ENV_FILE"
        log_warn "WARNING: Application may not function correctly with empty configuration"
        return 0
    else
        log_error "Failed to create configuration file"
        return 1
    fi
}

# Main execution
main() {
    log_debug "Starting $SCRIPT_NAME with PID $$"
    log_debug "Command line arguments: $*"

    validate_inputs
    validate_aws_cli

    if retrieve_parameter; then
        log_info "Configuration setup completed successfully"
        exit 0
    else
        log_warn "Parameter retrieval failed, trying fallback options"
        if handle_fallback; then
            log_info "Configuration setup completed with fallback"
            exit 0
        else
            log_error "All configuration retrieval methods failed"
            exit 1
        fi
    fi
}

# Run main function
main "$@"
