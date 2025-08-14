#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$CDK_DIR")")"

echo -e "${BLUE}One Observability Demo - Application Redeployment Script${NC}"
echo "=================================================="

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

# Detect OCI runner
OCI_RUNNER=""
if command -v docker &> /dev/null; then
    OCI_RUNNER="docker"
elif command -v finch &> /dev/null; then
    OCI_RUNNER="finch"
elif command -v podman &> /dev/null; then
    OCI_RUNNER="podman"
else
    echo -e "${RED}Error: No OCI runner found. Please install docker, finch, or podman${NC}"
    exit 1
fi

echo -e "${GREEN}Using OCI runner: $OCI_RUNNER${NC}"

# Check if logged in
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: Not logged into AWS. Please configure your credentials${NC}"
    exit 1
fi

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
if [ -z "$AWS_REGION" ]; then
    AWS_REGION="us-east-1"
fi

echo -e "${GREEN}Using AWS Account: $AWS_ACCOUNT${NC}"
echo -e "${GREEN}Using AWS Region: $AWS_REGION${NC}"
echo

# Parse applications from environment.ts
parse_applications() {
    local env_file="$CDK_DIR/bin/environment.ts"
    if [ ! -f "$env_file" ]; then
        echo -e "${RED}Error: environment.ts not found at $env_file${NC}"
        exit 1
    fi

    # Extract application definitions
    grep -A 6 "export const.*= {" "$env_file" | grep -E "(name:|dockerFilePath:|hostType:)" | \
    awk '
    /name:/ { name = $2; gsub(/[",]/, "", name) }
    /dockerFilePath:/ { path = $2; gsub(/[",]/, "", path) }
    /hostType:/ {
        host = $2; gsub(/[",]/, "", host); gsub(/HostType\./, "", host)
        if (name && path && host) {
            print name ":" path ":" host
            name = ""; path = ""; host = ""
        }
    }'
}

# Get applications
APPS=()
while IFS= read -r line; do
    APPS+=("$line")
done < <(parse_applications)

if [ ${#APPS[@]} -eq 0 ]; then
    echo -e "${RED}Error: No applications found in environment.ts${NC}"
    exit 1
fi

# Display applications
echo -e "${YELLOW}Available applications:${NC}"
for i in "${!APPS[@]}"; do
    IFS=':' read -r name path host <<< "${APPS[$i]}"
    echo "  $((i+1)). $name (Host: $host)"
done
echo

# Get user selection
while true; do
    read -p "Select application to redeploy (1-${#APPS[@]}): " selection
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#APPS[@]} ]; then
        break
    fi
    echo -e "${RED}Invalid selection. Please enter a number between 1 and ${#APPS[@]}${NC}"
done

# Parse selected application
IFS=':' read -r APP_NAME DOCKER_PATH HOST_TYPE <<< "${APPS[$((selection-1))]}"

# Clean any remaining quotes
APP_NAME=$(echo "$APP_NAME" | tr -d "'\"")
DOCKER_PATH=$(echo "$DOCKER_PATH" | tr -d "'\"")
HOST_TYPE=$(echo "$HOST_TYPE" | tr -d "'\"")

echo -e "${GREEN}Selected: $APP_NAME${NC}"
echo -e "${GREEN}Docker path: $DOCKER_PATH${NC}"
echo -e "${GREEN}Host type: $HOST_TYPE${NC}"
echo

# Build and push container
echo -e "${YELLOW}Building and pushing container...${NC}"
ECR_REPO="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME"

# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" | $OCI_RUNNER login --username AWS --password-stdin "$ECR_REPO"

# Build and push
cd "$REPO_ROOT/$DOCKER_PATH"
if [ "$OCI_RUNNER" = "docker" ]; then
    # Use buildx for cross-platform build (ARM to x86/amd64)
    docker buildx build --platform linux/amd64 -t "$ECR_REPO:latest" --push .
else
    # For finch/podman, use regular build with platform flag
    $OCI_RUNNER build --platform linux/amd64 -t "$APP_NAME:latest" .
    $OCI_RUNNER tag "$APP_NAME:latest" "$ECR_REPO:latest"
    $OCI_RUNNER push "$ECR_REPO:latest"
fi

echo -e "${GREEN}Container pushed successfully!${NC}"
echo

# Handle deployment based on host type
if [ "$HOST_TYPE" = "ECS" ]; then
    echo -e "${YELLOW}Handling ECS deployment...${NC}"

    # Get ECS clusters
    CLUSTERS=()
    while IFS= read -r line; do
        CLUSTERS+=("$line")
    done < <(aws ecs list-clusters --query 'clusterArns[]' --output text | xargs -n1 basename)

    if [ ${#CLUSTERS[@]} -eq 0 ]; then
        echo -e "${RED}No ECS clusters found${NC}"
        exit 1
    fi

    # Select cluster
    if [ ${#CLUSTERS[@]} -eq 1 ]; then
        CLUSTER="${CLUSTERS[0]}"
        echo -e "${GREEN}Using cluster: $CLUSTER${NC}"
    else
        echo -e "${YELLOW}Available clusters:${NC}"
        for i in "${!CLUSTERS[@]}"; do
            echo "  $((i+1)). ${CLUSTERS[$i]}"
        done

        while true; do
            read -p "Select cluster (1-${#CLUSTERS[@]}): " cluster_selection
            if [[ "$cluster_selection" =~ ^[0-9]+$ ]] && [ "$cluster_selection" -ge 1 ] && [ "$cluster_selection" -le ${#CLUSTERS[@]} ]; then
                CLUSTER="${CLUSTERS[$((cluster_selection-1))]}"
                break
            fi
            echo -e "${RED}Invalid selection${NC}"
        done
    fi

    # Get services
    SERVICES=()
    while IFS= read -r line; do
        SERVICES+=("$line")
    done < <(aws ecs list-services --cluster "$CLUSTER" --query 'serviceArns[]' --output text | xargs -n1 basename)

    if [ ${#SERVICES[@]} -eq 0 ]; then
        echo -e "${RED}No services found in cluster $CLUSTER${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Available services:${NC}"
    for i in "${!SERVICES[@]}"; do
        echo "  $((i+1)). ${SERVICES[$i]}"
    done

    while true; do
        read -p "Select service (1-${#SERVICES[@]}): " service_selection
        if [[ "$service_selection" =~ ^[0-9]+$ ]] && [ "$service_selection" -ge 1 ] && [ "$service_selection" -le ${#SERVICES[@]} ]; then
            SERVICE="${SERVICES[$((service_selection-1))]}"
            break
        fi
        echo -e "${RED}Invalid selection${NC}"
    done

    # Force new deployment
    echo -e "${YELLOW}Forcing service redeployment...${NC}"
    aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment > /dev/null

    echo -e "${GREEN}Service redeployment initiated for $SERVICE in cluster $CLUSTER${NC}"
    echo -e "${BLUE}You can monitor the deployment in the AWS Console or with:${NC}"
    echo "aws ecs describe-services --cluster $CLUSTER --services $SERVICE"

elif [ "$HOST_TYPE" = "EKS" ]; then
    echo -e "${YELLOW}EKS deployment detected${NC}"
    echo -e "${BLUE}Manual restart required using kubectl:${NC}"
    echo
    echo -e "${GREEN}Example command:${NC}"
    echo "kubectl rollout restart deployment/$APP_NAME"
    echo
    echo -e "${BLUE}Or if using a different deployment name:${NC}"
    echo "kubectl get deployments"
    echo "kubectl rollout restart deployment/<deployment-name>"

else
    echo -e "${RED}Unknown host type: $HOST_TYPE${NC}"
    exit 1
fi

echo
echo -e "${GREEN}Redeployment process completed!${NC}"