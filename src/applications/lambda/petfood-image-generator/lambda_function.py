"""
Strands Agent Lambda function for automated pet food image generation.
Processes EventBridge events to generate images using Amazon Bedrock.
"""

import json
import logging
import os
import time
import base64
from typing import Dict, Any, Optional

import boto3

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')
dynamodb = boto3.resource('dynamodb')

# Environment variables
FOOD_TABLE_NAME = os.environ.get(
    'FOOD_TABLE_NAME', 'DevStorageStack-DynamoDbddbPetFoodsF80A2CEA-1905A6TU62OM0')
S3_BUCKET_NAME = os.environ.get(
    'S3_BUCKET_NAME', 'devstoragestack-workshopassetspetadoptionbucket239-iegigku38mmq')
BEDROCK_MODEL_ID = os.environ.get(
    'BEDROCK_MODEL_ID', 'amazon.titan-image-generator-v2:0')


def get_existing_prompt(food_name: str) -> str:
    """Get existing prompt for seed data based on food name."""
    # Image configurations from the seed data script
    IMAGES = {
        "beef-turkey-kibbles.jpg": {
            "pet_type": "Puppy",
            "product_name": "Beef and Turkey Kibbles",
            "prompt": "Premium dry dog kibble for puppies in white ceramic bowl. Small brown bone-shaped pieces with visible meat. Clean wooden surface background.",
            "style": "product photography, professional lighting"
        },
        "raw-chicken-bites.jpg": {
            "pet_type": "Puppy",
            "product_name": "Raw Chicken Bites",
            "prompt": "Tender chicken pieces in ceramic bowl with natural broth. Fresh wet dog food with visible meat chunks.",
            "style": "food photography, warm lighting"
        },
        "puppy-training-treats.jpg": {
            "pet_type": "Puppy",
            "product_name": "Puppy Training Treats",
            "prompt": "Small golden-brown training treats scattered on clean white surface. Soft, bite-sized treats for puppies.",
            "style": "product photography, bright lighting"
        },
        "salmon-tuna-delight.jpg": {
            "pet_type": "Kitten",
            "product_name": "Salmon and Tuna Delight",
            "prompt": "Gourmet wet cat food with salmon and tuna chunks in elegant white bowl. Pink fish flakes in light sauce.",
            "style": "gourmet food photography, elegant presentation"
        },
        "kitten-growth-formula.jpg": {
            "pet_type": "Kitten",
            "product_name": "Kitten Growth Formula",
            "prompt": "Premium dry kitten food in modern ceramic bowl. Small triangular golden-brown kibble pieces.",
            "style": "product photography, clean lighting"
        },
        "catnip-kitten-treats.jpg": {
            "pet_type": "Kitten",
            "product_name": "Catnip Kitten Treats",
            "prompt": "Fish-shaped kitten treats with light green catnip tint arranged on white surface. Crunchy treats.",
            "style": "product photography, playful presentation"
        },
        "carrot-herb-crunchies.jpg": {
            "pet_type": "Bunny",
            "product_name": "Carrot and Herb Crunchies",
            "prompt": "Orange rabbit treats with carrot pieces and green herb flecks in wooden bowl. Natural wholesome pellets.",
            "style": "natural product photography, rustic presentation"
        },
        "timothy-hay-pellets.jpg": {
            "pet_type": "Bunny",
            "product_name": "Timothy Hay Pellets",
            "prompt": "Green-brown cylindrical hay pellets in wooden bowl. Compressed timothy hay for rabbits.",
            "style": "natural product photography, organic presentation"
        },
        "fresh-veggie-mix.jpg": {
            "pet_type": "Bunny",
            "product_name": "Fresh Veggie Mix",
            "prompt": "Colorful fresh vegetables in ceramic bowl. Diced carrots, leafy greens, and bell pepper pieces.",
            "style": "fresh food photography, vibrant colors"
        }
    }

    # Look for matching food name in the seed data
    for image_config in IMAGES.values():
        if image_config["product_name"].lower() == food_name.lower():
            full_prompt = f"{image_config['prompt']} {image_config['style']}, professional quality."
            logger.info(f"Found existing prompt for seed data: {food_name}")
            return full_prompt

    # If no match found, return empty string to trigger dynamic generation
    logger.info(
        f"No existing prompt found for: {food_name}, will generate dynamically")
    return ""


def generate_prompt(food_data: Dict[str, Any]) -> str:
    """Generate a descriptive prompt for image generation."""
    try:
        food_name = food_data.get('food_name', '')
        pet_type = food_data.get('pet_type', '')
        food_type = food_data.get('food_type', '')
        description = food_data.get('description', '')
        ingredients = food_data.get('ingredients', [])

        # Generate base prompt
        prompt_parts = []

        # Add food name and type
        if food_name:
            prompt_parts.append(f"A bowl of {food_name.lower()}")

        # Add pet type context
        if pet_type:
            prompt_parts.append(f"designed for {pet_type.lower()}s")

        # Add food type
        if food_type:
            prompt_parts.append(f"({food_type.lower()} food)")

        # Add key ingredients
        if ingredients and isinstance(ingredients, list):
            # Limit to first 3 ingredients
            key_ingredients = ingredients[:3]
            ingredients_text = ", ".join(key_ingredients)
            prompt_parts.append(f"containing {ingredients_text}")

        # Combine parts
        base_prompt = " ".join(prompt_parts)

        # Add visual styling
        visual_elements = [
            "professional product photography",
            "clean white background",
            "natural lighting",
            "high quality",
            "appetizing presentation"
        ]

        full_prompt = f"{base_prompt}, {', '.join(visual_elements)}"

        # Validate length (Bedrock limit is 512 characters)
        if len(full_prompt) > 512:
            full_prompt = _intelligent_truncate(full_prompt, 512)

        logger.info(f"Generated prompt: {full_prompt}")
        return full_prompt

    except Exception as e:
        logger.error(f"Error generating prompt: {str(e)}")
        return f"A bowl of pet food, professional product photography, clean white background"


def _intelligent_truncate(prompt: str, max_length: int) -> str:
    """Intelligently truncate prompt while preserving key elements."""
    if len(prompt) <= max_length:
        return prompt

    # Split into parts
    parts = prompt.split(", ")

    # Keep essential parts (food name, pet type)
    essential_parts = []
    optional_parts = []

    for part in parts:
        if any(keyword in part.lower() for keyword in ["bowl", "designed for", "containing"]):
            essential_parts.append(part)
        else:
            optional_parts.append(part)

    # Rebuild prompt starting with essential parts
    result = ", ".join(essential_parts)

    # Add optional parts if space allows
    for part in optional_parts:
        test_result = f"{result}, {part}"
        if len(test_result) <= max_length:
            result = test_result
        else:
            break

    return result


def generate_image_with_bedrock(prompt: str, food_id: str) -> Dict[str, Any]:
    """Generate image using Amazon Bedrock."""
    try:
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
                "seed": 42
            }
        }

        # Call Bedrock
        response = bedrock_client.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps(request_body),
            contentType="application/json",
            accept="application/json"
        )

        response_body = json.loads(response['body'].read())

        if 'images' in response_body and len(response_body['images']) > 0:
            image_data = response_body['images'][0]
            logger.info(f"Successfully generated image for food {food_id}")
            return {
                "image_data": image_data,
                "success": True
            }
        else:
            logger.error("No images returned from Bedrock")
            return {
                "image_data": None,
                "success": False,
                "error": "No images returned from Bedrock"
            }

    except Exception as e:
        logger.error(f"Error generating image with Bedrock: {str(e)}")
        return {
            "image_data": None,
            "success": False,
            "error": str(e)
        }


def store_image_in_s3(image_data: str, food_id: str, food_name: str) -> Dict[str, Any]:
    """Store generated image in S3."""
    try:
        # Generate image path with petfood/ prefix
        safe_name = food_name.lower().replace(" ", "-").replace("&", "and")
        image_key = f"petfood/{safe_name}.jpg"

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
                "timestamp": str(int(time.time()))
            }
        )

        logger.info(
            f"Successfully stored image for food {food_id} at {image_key}")

        return {
            "image_key": image_key,  # Store S3 key instead of full URL
            "success": True
        }

    except Exception as e:
        logger.error(f"Error storing image in S3: {str(e)}")
        return {
            "image_url": "",
            "image_path": "",
            "success": False,
            "error": str(e)
        }


def update_food_record(food_id: str, image_key: str) -> Dict[str, Any]:
    """Update food record in DynamoDB with S3 image key."""
    try:
        table = dynamodb.Table(FOOD_TABLE_NAME)

        # Update the food record with S3 key instead of full URL
        response = table.update_item(
            Key={"id": food_id},
            UpdateExpression="SET image = :image_key, updated_at = :timestamp",
            ExpressionAttributeValues={
                ":image_key": image_key,  # Store S3 key like "petfood/raw-chicken-bites.jpg"
                ":timestamp": int(time.time())
            },
            ReturnValues="UPDATED_NEW"
        )

        logger.info(
            f"Successfully updated food {food_id} with image key: {image_key}")

        return {
            "success": True,
            "updated": True
        }

    except Exception as e:
        logger.error(f"Error updating food record: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


def extract_event_fields(event: Dict[str, Any]) -> Dict[str, Any]:
    """Safely extract and validate event fields from EventBridge event."""
    try:
        # Extract the detail section
        detail = event.get('detail', {})

        # Validate required fields
        if not detail:
            raise ValueError("Missing 'detail' section in event")

        event_type = detail.get('event_type', '')
        if not event_type:
            raise ValueError("Missing 'event_type' in event detail")

        food_id = detail.get('food_id', '')
        if not food_id:
            raise ValueError("Missing 'food_id' in event detail")

        # Extract optional fields with defaults
        extracted = {
            'event_type': event_type,
            'food_id': food_id,
            'food_name': detail.get('food_name'),
            'pet_type': detail.get('pet_type'),
            'food_type': detail.get('food_type'),
            'description': detail.get('description'),
            'ingredients': detail.get('ingredients', []),
            'status': detail.get('status', ''),
            'metadata': detail.get('metadata', {}),
            'span_context': detail.get('span_context', {})
        }

        # Log extracted fields for debugging
        logger.info(
            f"Extracted event fields: {json.dumps(extracted, default=str)}")

        return extracted

    except Exception as e:
        logger.error(f"Error extracting event fields: {str(e)}")
        raise


def process_food_event(event_detail: Dict[str, Any]) -> Dict[str, Any]:
    """Process food creation/update events."""

    food_id = event_detail.get('food_id', '')
    food_name = event_detail.get('food_name') or 'Unknown Food'
    event_type = event_detail.get('event_type', '')
    metadata = event_detail.get('metadata', {})

    logger.info(
        f"Processing {event_type} event for {food_name} (ID: {food_id})")

    # Validate required fields
    if not food_id:
        raise ValueError("Missing required field: food_id")

    # Check if image generation is required
    image_required = metadata.get('image_required', 'false').lower() == 'true'
    is_manual_creation = metadata.get(
        'is_manual_creation', 'false').lower() == 'true'
    logger.info(f"Image required for {food_id}: {image_required}")

    if not image_required:
        logger.info(f"Image generation not required for {food_id}")
        return {
            'food_id': food_id,
            'success': True,
            'message': f'Image generation not required for {food_name}',
            'skipped': True
        }

    try:
        # Step 1: Generate prompt
        if is_manual_creation:
            prompt = generate_prompt(event_detail)
        else:
            # For seed data, try to get existing prompt first
            prompt = get_existing_prompt(food_name)
            if not prompt:
                # Fallback to dynamic generation if no existing prompt found
                prompt = generate_prompt(event_detail)

        # Step 2: Generate image with Bedrock
        image_result = generate_image_with_bedrock(prompt, food_id)

        if not image_result['success']:
            return {
                'food_id': food_id,
                'success': False,
                'error': image_result.get('error', 'Image generation failed'),
                'message': f'Failed to generate image for {food_name}'
            }

        # Step 3: Store image in S3
        storage_result = store_image_in_s3(
            image_result['image_data'],
            food_id,
            food_name
        )

        if not storage_result['success']:
            return {
                'food_id': food_id,
                'success': False,
                'error': storage_result.get('error', 'Image storage failed'),
                'message': f'Failed to store image for {food_name}'
            }

        # Step 4: Update DynamoDB record with S3 key
        update_result = update_food_record(
            food_id, storage_result['image_key'])

        if not update_result['success']:
            return {
                'food_id': food_id,
                'success': False,
                'error': update_result.get('error', 'Database update failed'),
                'message': f'Failed to update database for {food_name}'
            }

        logger.info(f"Successfully processed food event for {food_id}")

        return {
            'food_id': food_id,
            'success': True,
            'image_key': storage_result['image_key'],
            'message': f'Successfully processed food event for {food_name}'
        }

    except Exception as e:
        logger.error(f"Failed to process food event: {str(e)}")
        return {
            'food_id': food_id,
            'success': False,
            'error': str(e),
            'message': f'Failed to process food event for {food_name}'
        }


def lambda_handler(event, context):
    """Main Lambda handler for processing EventBridge events."""

    try:
        # Log event details
        logger.info(f"Processing event: {json.dumps(event, default=str)}")

        # Extract and validate event details
        event_detail = extract_event_fields(event)
        event_type = event_detail['event_type']

        logger.info(f"Processing event type: {event_type}")

        # Process the event based on type
        if event_type in ['FoodItemCreated', 'FoodItemUpdated']:
            result = process_food_event(event_detail)
        else:
            logger.warning(f"Unknown event type: {event_type}")
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'message': f'Unknown event type: {event_type}',
                    'success': False
                })
            }

        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }

    except Exception as e:
        logger.error(f"Error processing event: {str(e)}")

        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': f'Error processing event: {str(e)}',
                'success': False
            })
        }
