#!/bin/bash

# script should be deleted after infra v2

# Quick throwaway deployment - new tag + minimal task def update
set -euxo pipefail

AWS_REGION="us-west-2"
ECS_CLUSTER_NAME="Services-PetListAdoptions1706E0DF-obMtiY9kiBGO"
NEW_TAG="throwaway-$(date +%H%M%S)"

echo "🚀 Quick deployment with new tag: $NEW_TAG"

# Find service
ACTUAL_SERVICE_NAME=$(aws ecs list-services --cluster $ECS_CLUSTER_NAME --region $AWS_REGION --query 'serviceArns[?contains(@, `petfood`)]' --output text | head -1 | cut -d'/' -f3)

if [ -z "$ACTUAL_SERVICE_NAME" ]; then
    echo "❌ Could not find payforadoption service"
    exit 1
fi

echo "✅ Found service: $ACTUAL_SERVICE_NAME"

# Get current task definition and extract current image
CURRENT_TASK_DEF=$(aws ecs describe-services --cluster $ECS_CLUSTER_NAME --services $ACTUAL_SERVICE_NAME --region $AWS_REGION --query 'services[0].taskDefinition' --output text)
CURRENT_IMAGE=$(aws ecs describe-task-definition --task-definition $CURRENT_TASK_DEF --region $AWS_REGION --query 'taskDefinition.containerDefinitions[1].image' --output text)

echo "✅ Current image: $CURRENT_IMAGE"

# Create new image tag
ECR_REPO=$(echo $CURRENT_IMAGE | cut -d':' -f1)
NEW_IMAGE="$ECR_REPO:$NEW_TAG"

echo "📦 Building new image: $NEW_IMAGE"
docker buildx build --platform linux/amd64 -t temp-build .
docker tag temp-build $NEW_IMAGE

# Login and push
echo "🔐 Pushing to ECR..."
ECR_HOST=$(echo $CURRENT_IMAGE | cut -d'/' -f1)
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_HOST
docker push $NEW_IMAGE

echo "✅ Image pushed: $NEW_IMAGE"

# Get current task def and create new one with updated image
echo "📝 Creating new task definition..."
TASK_DEF_JSON=$(aws ecs describe-task-definition --task-definition $CURRENT_TASK_DEF --region $AWS_REGION --query 'taskDefinition')

# Update image in task definition and write to temp file
TEMP_FILE=$(mktemp)
echo $TASK_DEF_JSON | jq --arg new_image "$NEW_IMAGE" '
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy) |
  .containerDefinitions[1].image = $new_image
' > $TEMP_FILE

# Register new task definition
NEW_TASK_DEF_ARN=$(aws ecs register-task-definition --region $AWS_REGION --cli-input-json file://$TEMP_FILE --query 'taskDefinition.taskDefinitionArn' --output text)

# Cleanup temp file
rm $TEMP_FILE

echo "✅ New task definition: $NEW_TASK_DEF_ARN"

# Update service
echo "🔄 Updating service..."
aws ecs update-service \
    --cluster $ECS_CLUSTER_NAME \
    --service $ACTUAL_SERVICE_NAME \
    --task-definition $NEW_TASK_DEF_ARN \
    --region $AWS_REGION > /dev/null

echo "🎉 Done! Service updating with new image."

# Cleanup
docker rmi temp-build $NEW_IMAGE 2>/dev/null || true
