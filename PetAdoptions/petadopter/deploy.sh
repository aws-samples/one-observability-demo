#!/bin/bash

# Pet Adopter Lambda Deployment Script using AWS SAM

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
STACK_NAME="pet-adopter-stack"
REGION="us-west-2"

echo -e "${GREEN}🚀 Pet Adopter Lambda Deployment${NC}"
echo "=================================="

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ SAM CLI not found. Please install AWS SAM CLI first.${NC}"
    echo "Installation guide: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}📋 AWS Account ID: ${ACCOUNT_ID}${NC}"


# Confirm deployment
echo -e "${YELLOW}❓ Do you want to proceed with deployment? (y/N)${NC}"
read -r CONFIRM
if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Deployment cancelled.${NC}"
    exit 0
fi

# Install dependencies
echo -e "${GREEN}📦 Installing dependencies...${NC}"
npm install

# Run tests
echo -e "${GREEN}🧪 Running tests...${NC}"
npm test

# Build the SAM application
echo -e "${GREEN}🔨 Building SAM application...${NC}"
sam build

# Deploy the application
echo -e "${GREEN}🚀 Deploying to AWS...${NC}"
sam deploy \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --capabilities CAPABILITY_IAM \
    # --parameter-overrides \
    #     "SQSQueueArn=${SQS_QUEUE_ARN}" \
    #     "RDSSecretArn=${RDS_SECRET_ARN}" \
    #     "UpdateAdoptionURL=${UPDATE_ADOPTION_URL}" \
    #     "VpcId=${VPC_ID}" \
    #     "SubnetIds=${SUBNET_IDS}" \
    #     "SecurityGroupId=${SECURITY_GROUP_ID}" \
    --resolve-s3 \
    --confirm-changeset

# Get outputs
echo -e "${GREEN}📋 Deployment completed! Getting stack outputs...${NC}"
aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs' \
    --output table

echo -e "${GREEN}✅ Pet Adopter Lambda function deployed successfully!${NC}"
echo -e "${GREEN}🔍 Check CloudWatch Application Signals for observability data.${NC}"

# Test the deployment
echo -e "${YELLOW}🧪 Would you like to send a test message to verify the deployment? (y/N)${NC}"
read -r TEST_CONFIRM
if [[ $TEST_CONFIRM =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}📤 Sending test message to SQS queue...${NC}"
    
    TEST_MESSAGE='{
        "transactionId": "'$(uuidgen | tr '[:upper:]' '[:lower:]')'",
        "petId": "test-pet-123",
        "petType": "dog",
        "userId": "test-user-456",
        "adoptiondate": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }'
    
    aws sqs send-message \
        --queue-url "${SQS_QUEUE_ARN#*:sqs:*:*:}" \
        --message-body "${TEST_MESSAGE}" \
        --region "${REGION}"
    
    echo -e "${GREEN}✅ Test message sent! Check CloudWatch Logs for processing results.${NC}"
    echo -e "${GREEN}📊 Monitor the function at: https://console.aws.amazon.com/lambda/home?region=${REGION}#/functions/pet-adopter${NC}"
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"