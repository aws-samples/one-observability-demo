"""
Strands Agent Lambda function for automated pet food image generation.
Processes EventBridge events to generate images using Amazon Bedrock.
"""

import base64
import json
import logging
import os
import random
import time
from typing import Any
from typing import Dict
from strands import Agent, tool

import boto3
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client("s3")
bedrock_client = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")

# Environment variables
FOOD_TABLE_NAME = os.environ.get("FOOD_TABLE_NAME")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID",
    "amazon.titan-image-generator-v2:0",
)

# Retry configuration
MAX_RETRIES = 5
BASE_DELAY = 1.0  # Base delay in seconds
MAX_DELAY = 60.0  # Maximum delay in seconds
JITTER_RANGE = 0.1  # Random jitter to avoid thundering herd


IMAGE_GEN_PROMPT = """You are an autonomous AI agent responsible for generating images
for a pet food service. Your primary goal is to ensure that pet food item has a
corresponding image file stored in our S3 bucket. You must handle two distinct
scenarios: create new image if existing, ignore the event (image generation) if
image already exists.

You will be triggered by an AWS EventBridge event `FoodItemCreated`.
The event payload contains a food object with details like `food_id`, `description`
`food_name`, `pet_type` (which type of pet this is for) with potentially `ingredients`,
which you will use to form a prompt. The EventBridge event will also have metadata of
which you will get booleans `requires_validation`, `is_seed_data` and `is_manual_creation`.

You MUST use the "amazon.titan-image-generator-v2:0" Amazon Bedrock model.

Here are a few rules:

1. If `is_seed_data` is true and `requires_validation` is false, you MUST use the
`description` field as the prompt to Bedrock.
2. If `is_seed_data` is false and `requires_validation` is true, then you may
use the description in combination with other fields autonomously to create the PROMPT

Here's the full flow of what you will do with tools you can use:

1. Check the rules above by parsing the event (tool: extract_event_fields)
2. Generate the prompt, prompt MUST be 512 characters or less
3. Generate the Image with Bedrock (tool: generate_image_with_bedrock)
4. Store the image on S3 (tool: store_image_in_s3)
5. Update the food item on dynamodb with the image_key returned by store_image_in_s3
(tool: update_food_record)
"""


def exponential_backoff_delay(attempt: int) -> float:
    """Calculate exponential backoff delay with jitter."""
    delay = min(BASE_DELAY * (2**attempt), MAX_DELAY)
    jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE) * delay
    return max(0, delay + jitter)


def is_retryable_error(error: Exception) -> bool:
    """Determine if an error is retryable."""
    if isinstance(error, ClientError):
        error_code = error.response.get("Error", {}).get("Code", "")

        # Retryable errors
        retryable_codes = {
            "ThrottlingException",
            "ServiceQuotaExceededException",
            "TooManyRequestsException",
            "InternalServerError",
            "ServiceUnavailableException",
            "RequestTimeoutException",
        }

        return error_code in retryable_codes

    # Network-related errors are generally retryable
    return "timeout" in str(error).lower() or "connection" in str(error).lower()


@tool
def generate_image_with_bedrock(prompt: str, food_id: str) -> Dict[str, Any]:
    """Generate image using Amazon Bedrock with retry logic."""

    # Add random initial delay to spread out concurrent requests
    initial_delay = random.uniform(0.1, 2.0)
    logger.info(
        f"Adding initial delay of {initial_delay:.2f}s to avoid " "concurrency issues",
    )
    time.sleep(initial_delay)

    for attempt in range(MAX_RETRIES + 1):
        try:
            logger.info(
                f"Bedrock generation attempt {attempt + 1}/{MAX_RETRIES + 1} "
                f"for food {food_id}",
            )

            # Prepare Bedrock request for Titan Image Generator v2
            request_body = {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {
                    "text": prompt,
                    "negativeText": "blurry, low quality, distorted, ugly",
                },
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "height": 512,
                    "width": 512,
                    "cfgScale": 8.0,
                    "seed": random.randint(0, 1000000),  # Random seed for variety
                },
            }

            # Call Bedrock
            response = bedrock_client.invoke_model(
                modelId=BEDROCK_MODEL_ID,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json",
            )

            response_body = json.loads(response["body"].read())

            if "images" in response_body and len(response_body["images"]) > 0:
                image_data = response_body["images"][0]
                logger.info(
                    f"✅ Successfully generated image for food {food_id} on "
                    f"attempt {attempt + 1}",
                )
                return {
                    "image_data": image_data,
                    "success": True,
                    "attempts": attempt + 1,
                }
            else:
                logger.error("No images returned from Bedrock")
                return {
                    "image_data": None,
                    "success": False,
                    "error": "No images returned from Bedrock",
                    "attempts": attempt + 1,
                }

        except Exception as e:
            error_msg = str(e)
            logger.warning(
                f"❌ Bedrock attempt {attempt + 1} failed for food {food_id}: "
                f"{error_msg}",
            )

            # Check if this is the last attempt
            if attempt == MAX_RETRIES:
                logger.error(
                    f"🚫 All {MAX_RETRIES + 1} attempts failed for food " f"{food_id}",
                )
                return {
                    "image_data": None,
                    "success": False,
                    "error": f"Failed after {MAX_RETRIES + 1} attempts: {error_msg}",
                    "attempts": attempt + 1,
                    "retryable": is_retryable_error(e),
                }

            # Check if error is retryable
            if not is_retryable_error(e):
                logger.error(f"🚫 Non-retryable error for food {food_id}: {error_msg}")
                return {
                    "image_data": None,
                    "success": False,
                    "error": f"Non-retryable error: {error_msg}",
                    "attempts": attempt + 1,
                    "retryable": False,
                }

            # Calculate delay for next attempt
            delay = exponential_backoff_delay(attempt)
            logger.info(
                f"⏳ Retrying in {delay:.2f}s (attempt {attempt + 2}/"
                f"{MAX_RETRIES + 1})",
            )
            time.sleep(delay)

    # This should never be reached, but just in case
    return {
        "image_data": None,
        "success": False,
        "error": "Unexpected retry loop exit",
        "attempts": MAX_RETRIES + 1,
    }


@tool
def store_image_in_s3(image_data: str, food_id: str, food_name: str) -> Dict[str, Any]:
    """Store generated image in S3."""
    try:
        # Generate image path with petfood/ prefix
        safe_name = food_name.lower().replace(" ", "-").replace("&", "and")
        image_key = f"images/petfood/{safe_name}.jpg"

        # Decode base64 image data
        image_bytes = base64.b64decode(image_data)

        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=image_key,
            Body=image_bytes,
            ContentType="image/jpeg",
            Metadata={
                "food_id": food_id,
                "generated_by": "lambda-function",
                "timestamp": str(int(time.time())),
            },
        )

        logger.info(f"Successfully stored image for food {food_id} at {image_key}")

        return {
            "image_key": image_key,  # Store S3 key instead of full URL
            "success": True,
        }

    except Exception as e:
        logger.error(f"Error storing image in S3: {str(e)}")
        return {"image_key": "", "success": False, "error": str(e)}


@tool
def update_food_record(food_id: str, image_key: str) -> Dict[str, Any]:
    """Update food record in DynamoDB with S3 image key."""
    try:
        table = dynamodb.Table(FOOD_TABLE_NAME)

        # Update the food record with S3 key instead of full URL
        table.update_item(
            Key={"id": food_id},
            UpdateExpression="SET image = :image_key, updated_at = :timestamp",
            ExpressionAttributeValues={
                ":image_key": image_key,  # Store S3 key
                ":timestamp": int(time.time()),
            },
            ReturnValues="UPDATED_NEW",
        )

        logger.info(f"Successfully updated food {food_id} with image key: {image_key}")

        return {"success": True, "updated": True}

    except Exception as e:
        logger.error(f"Error updating food record: {str(e)}")
        return {"success": False, "error": str(e)}


@tool
def extract_event_fields(event: Dict[str, Any]) -> Dict[str, Any]:
    """Safely extract and validate event fields from EventBridge event."""
    try:
        # Extract the detail section
        detail = event.get("detail", {})

        # Validate required fields
        if not detail:
            raise ValueError("Missing 'detail' section in event")

        event_type = detail.get("event_type", "")
        if not event_type:
            raise ValueError("Missing 'event_type' in event detail")

        food_id = detail.get("food_id", "")
        if not food_id:
            raise ValueError("Missing 'food_id' in event detail")

        description = detail.get("description", "")
        if not description:
            raise ValueError("Missing 'description' in event detail")

        # Extract optional fields with defaults
        extracted = {
            "event_type": event_type,
            "food_id": food_id,
            "food_name": detail.get("food_name"),
            "pet_type": detail.get("pet_type"),
            "food_type": detail.get("food_type"),
            "description": detail.get("description"),
            "ingredients": detail.get("ingredients", []),
            "status": detail.get("status", ""),
            "metadata": detail.get("metadata", {}),
            "span_context": detail.get("span_context", {}),
        }

        # Log extracted fields for debugging
        logger.info(f"Extracted event fields: {json.dumps(extracted, default=str)}")

        return extracted

    except Exception as e:
        logger.error(f"Error extracting event fields: {str(e)}")
        raise


def handler(event: Dict[str, Any], _context) -> str:
    weather_agent = Agent(
        system_prompt=WEATHER_SYSTEM_PROMPT,
        tools=[http_request],
    )

    image_gen_agent = Agent(
        system_prompt=IMAGE_GEN_PROMPT,
        tools=[
            generate_image_with_bedrock,
            store_image_in_s3,
            update_food_record,
            extract_event_fields,
        ],
    )

    response = weather_agent(event.get("prompt"))
    return str(response)
