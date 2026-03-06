# Pet Food Image Generator Lambda

This Lambda function autonomously generates pet food images using Amazon Bedrock when processing EventBridge events from the petfood service.

## Architecture

The function processes EventBridge events from the petfood service to:

1. **Extract and validate** event data (food details, metadata)
2. **Check existing images** in S3 to avoid duplicates
3. **Generate descriptive prompts** based on food attributes
4. **Validate prompt length** for Bedrock compatibility
5. **Generate images** using Amazon Bedrock Titan Image Generator
6. **Store images** in S3 with proper metadata
7. **Update DynamoDB** records with image URLs

## Event Structure

The function processes `FoodItemCreated` and `FoodItemUpdated` events:

```json
{
  "detail": {
    "event_type": "FoodItemCreated",
    "food_id": "F32f05d95",
    "food_name": "Testing events",
    "pet_type": "puppy",
    "food_type": "dry",
    "description": "High-quality dry food for puppies",
    "ingredients": ["chicken", "rice", "vegetables", "vitamins"],
    "status": null,
    "metadata": {
      "image_required": "true"
    }
  }
}
```

## Core Functions

The function includes several core processing functions:

- **generate_prompt()**: Creates descriptive prompts from food attributes
- **generate_image_with_bedrock()**: Generates images using Bedrock
- **store_image_in_s3()**: Manages S3 image storage
- **update_food_record()**: Updates DynamoDB records

## Deployment

### Prerequisites

- AWS CLI configured
- SAM CLI installed
- Python 3.13
- Proper AWS permissions for Bedrock, S3, DynamoDB

### Deploy

```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy to dev environment
./deploy.sh dev

# Deploy to production
./deploy.sh prod
```

### Test Locally

```bash
# Test Strands integration
python test_strands.py

# Test with SAM local (requires Docker)
sam local invoke PetFoodImageGeneratorFunction -e test_event.json
```

## Configuration

Environment variables:

- `FOOD_TABLE_NAME`: DynamoDB table for food items
- `S3_BUCKET_NAME`: S3 bucket for image storage
- `BEDROCK_MODEL_ID`: Bedrock model for image generation
- `LAMBDA_LOG_LEVEL`: Lambda logging level

## Monitoring

The function includes:

- **CloudWatch Alarms** for errors and duration
- **X-Ray Tracing** for distributed tracing
- **Application Signals** for observability
- **Dead Letter Queue** for failed events

## Dependencies

- `boto3`: AWS SDK (included in Lambda runtime)
- `Pillow`: Image processing library

## Troubleshooting

1. **Import errors**: Ensure `requirements.txt` includes all dependencies
2. **Bedrock permissions**: Verify IAM permissions for model access
3. **S3 access**: Check bucket permissions and names
4. **DynamoDB**: Verify table name and permissions

The function now uses a simplified approach without external agent frameworks for better reliability and faster cold starts.