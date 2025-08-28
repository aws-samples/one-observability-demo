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
from strands_agents import Agent, AgentConfig
from strands_agents.tools import Tool

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')
dynamodb = boto3.resource('dynamodb')

# Environment variables
FOOD_TABLE_NAME = os.environ.get('FOOD_TABLE_NAME', 'petfood-foods')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'petfood-images')
BEDROCK_MODEL_ID = os.environ.get(
    'BEDROCK_MODEL_ID', 'amazon.titan-image-generator-v2:0')


# class PromptGeneratorTool(Tool):
#     """Tool for generating descriptive prompts from food attributes."""

#     name = "prompt_generator"
#     description = "Generates descriptive prompts for image generation based on food attributes"

#     def execute(self, food_data: Dict[str, Any]) -> Dict[str, Any]:
#         """Generate a descriptive prompt based on food attributes."""
#         try:
#             # Extract food attributes
#             food_name = food_data.get("foodName", "")
#             pet_type = food_data.get("petType", "")
#             food_type = food_data.get("foodType", "")
#             description = food_data.get("description", "")
#             ingredients = food_data.get("ingredients", [])

#             # Generate base prompt
#             prompt_parts = []

#             # Add food name and type
#             if food_name:
#                 prompt_parts.append(f"A bowl of {food_name.lower()}")

#             # Add pet type context
#             if pet_type:
#                 prompt_parts.append(f"designed for {pet_type.lower()}s")

#             # Add food type
#             if food_type:
#                 prompt_parts.append(f"({food_type.lower()} food)")

#             # Add key ingredients
#             if ingredients:
#                 # Limit to first 3 ingredients
#                 key_ingredients = ingredients[:3]
#                 ingredients_text = ", ".join(key_ingredients)
#                 prompt_parts.append(f"containing {ingredients_text}")

#             # Combine parts
#             base_prompt = " ".join(prompt_parts)

#             # Add visual styling
#             visual_elements = [
#                 "professional product photography",
#                 "clean white background",
#                 "natural lighting",
#                 "high quality",
#                 "appetizing presentation"
#             ]

#             full_prompt = f"{base_prompt}, {', '.join(visual_elements)}"

#             logger.info(
#                 f"Generated prompt for {food_name}: {len(full_prompt)} characters")

#             return {
#                 "prompt": full_prompt,
#                 "length": len(full_prompt),
#                 "food_id": food_data.get("foodId"),
#                 "success": True
#             }

#         except Exception as e:
#             logger.error(f"Error generating prompt: {str(e)}")
#             return {
#                 "prompt": "",
#                 "length": 0,
#                 "food_id": food_data.get("foodId"),
#                 "success": False,
#                 "error": str(e)
#             }


class PromptValidatorTool(Tool):
    """Tool for validating prompt length and content quality."""

    name = "prompt_validator"
    description = "Validates prompt length and content quality for Bedrock compatibility"

    def execute(self, prompt_data: Dict[str, Any]) -> bool:
        """Validate prompt length and content."""
        # try:
        prompt = prompt_data.get("prompt", "")
        max_length = 512  # Bedrock limit

        return len(prompt) <= max_length

    #         if not is_valid:
    #             # Truncate while preserving key elements
    #             truncated_prompt = self._intelligent_truncate(
    #                 prompt, max_length)

    #             return {
    #                 "prompt": truncated_prompt,
    #                 "is_valid": True,
    #                 "was_truncated": True,
    #                 "original_length": len(prompt),
    #                 "final_length": len(truncated_prompt),
    #                 "success": True
    #             }
    #         else:
    #             return {
    #                 "prompt": prompt,
    #                 "is_valid": True,
    #                 "was_truncated": False,
    #                 "original_length": len(prompt),
    #                 "final_length": len(prompt),
    #                 "success": True
    #             }

    #     except Exception as e:
    #         logger.error(f"Error validating prompt: {str(e)}")
    #         return {
    #             "prompt": "",
    #             "is_valid": False,
    #             "success": False,
    #             "error": str(e)
    #         }

    # def _intelligent_truncate(self, prompt: str, max_length: int) -> str:
    #     """Intelligently truncate prompt while preserving key elements."""
    #     if len(prompt) <= max_length:
    #         return prompt

    #     # Split into parts
    #     parts = prompt.split(", ")

    #     # Keep essential parts (food name, pet type)
    #     essential_parts = []
    #     optional_parts = []

    #     for part in parts:
    #         if any(keyword in part.lower() for keyword in ["bowl", "designed for", "containing"]):
    #             essential_parts.append(part)
    #         else:
    #             optional_parts.append(part)

    #     # Rebuild prompt starting with essential parts
    #     result = ", ".join(essential_parts)

    #     # Add optional parts if space allows
    #     for part in optional_parts:
    #         test_result = f"{result}, {part}"
    #         if len(test_result) <= max_length:
    #             result = test_result
    #         else:
    #             break

    #     return result


class BedrockImageGeneratorTool(Tool):
    """Tool for generating images using Amazon Bedrock."""

    name = "bedrock_image_generator"
    description = "Generates images using Amazon Bedrock with validated prompts"

    def execute(self, prompt_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate image using Bedrock."""
        try:
            prompt = prompt_data.get("prompt", "")
            food_id = prompt_data.get("food_id", "")

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
                    "food_id": food_id,
                    "success": True,
                    "model_id": BEDROCK_MODEL_ID
                }
            else:
                logger.error("No images returned from Bedrock")
                return {
                    "image_data": None,
                    "food_id": food_id,
                    "success": False,
                    "error": "No images returned from Bedrock"
                }

        except Exception as e:
            logger.error(f"Error generating image with Bedrock: {str(e)}")
            return {
                "image_data": None,
                "food_id": prompt_data.get("food_id", ""),
                "success": False,
                "error": str(e)
            }


class S3ImageManagerTool(Tool):
    """Tool for managing images in S3."""

    name = "s3_image_manager"
    description = "Manages image storage and cleanup operations in S3"

    def execute(self, operation_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute S3 operations."""
        operation = operation_data.get("operation", "")

        if operation == "check_exists":
            return self._check_image_exists(operation_data)
        elif operation == "store_image":
            return self._store_image(operation_data)
        elif operation == "delete_image":
            return self._delete_image(operation_data)
        else:
            return {
                "success": False,
                "error": f"Unknown operation: {operation}"
            }

    def _check_image_exists(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Check if image exists in S3."""
        try:
            image_path = data.get("image_path", "")

            s3_client.head_object(Bucket=S3_BUCKET_NAME, Key=image_path)

            return {
                "exists": True,
                "image_path": image_path,
                "success": True
            }

        except s3_client.exceptions.NoSuchKey:
            return {
                "exists": False,
                "image_path": data.get("image_path", ""),
                "success": True
            }
        except Exception as e:
            logger.error(f"Error checking S3 image: {str(e)}")
            return {
                "exists": False,
                "success": False,
                "error": str(e)
            }

    def _store_image(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Store image in S3."""
        try:
            image_data = data.get("image_data", "")
            food_id = data.get("food_id", "")
            food_name = data.get("food_name", "")

            # Generate image path
            safe_name = food_name.lower().replace(" ", "-").replace("&", "and")
            image_path = f"{safe_name}.jpg"

            # Decode base64 image data
            image_bytes = base64.b64decode(image_data)

            # Upload to S3
            s3_client.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=image_path,
                Body=image_bytes,
                ContentType="image/jpeg",
                Metadata={
                    "food_id": food_id,
                    "generated_by": "strands-agent",
                    "timestamp": str(int(time.time()))
                }
            )

            # Generate public URL
            image_url = f"https://{S3_BUCKET_NAME}.s3.amazonaws.com/{image_path}"

            logger.info(
                f"Successfully stored image for food {food_id} at {image_path}")

            return {
                "image_url": image_url,
                "image_path": image_path,
                "food_id": food_id,
                "success": True
            }

        except Exception as e:
            logger.error(f"Error storing image in S3: {str(e)}")
            return {
                "image_url": "",
                "image_path": "",
                "food_id": data.get("food_id", ""),
                "success": False,
                "error": str(e)
            }

    def _delete_image(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Delete image from S3."""
        try:
            image_path = data.get("image_path", "")

            s3_client.delete_object(Bucket=S3_BUCKET_NAME, Key=image_path)

            logger.info(f"Successfully deleted image at {image_path}")

            return {
                "image_path": image_path,
                "deleted": True,
                "success": True
            }

        except Exception as e:
            logger.error(f"Error deleting image from S3: {str(e)}")
            return {
                "image_path": data.get("image_path", ""),
                "deleted": False,
                "success": False,
                "error": str(e)
            }


class DatabaseUpdaterTool(Tool):
    """Tool for updating food records in DynamoDB."""

    name = "database_updater"
    description = "Updates food records with generated image URLs"

    def execute(self, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update food record with image URL."""
        try:
            food_id = update_data.get("food_id", "")
            image_url = update_data.get("image_url", "")

            table = dynamodb.Table(FOOD_TABLE_NAME)

            # Set/update the image URL
            response = table.update_item(
                Key={"id": food_id},
                UpdateExpression="SET image = :image_url, updated_at = :timestamp",
                ExpressionAttributeValues={
                    ":image_url": image_url,
                    ":timestamp": int(time.time())
                },
                ReturnValues="UPDATED_NEW"
            )
            logger.info(f"Successfully updated food {food_id} with image URL")

            return {
                "food_id": food_id,
                "image_url": image_url,
                "updated": True,
                "success": True
            }

        except Exception as e:
            logger.error(f"Error updating food record: {str(e)}")
            return {
                "food_id": update_data.get("food_id", ""),
                "image_url": update_data.get("image_url", ""),
                "updated": False,
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


def lambda_handler(event, context):
    """Main Lambda handler for processing EventBridge events."""

    try:
        # Log event details
        logger.info(f"Processing event: {json.dumps(event, default=str)}")

        # Extract and validate event details
        event_detail = extract_event_fields(event)
        event_type = event_detail['event_type']

        logger.info(f"Processing event type: {event_type}")

        # Initialize Strands Agent with tools
        agent_config = AgentConfig(
            name="PetFoodImageGenerator",
            description="Autonomous agent for generating pet food images based on food attributes",
            tools=[
                # PromptGeneratorTool(),
                PromptValidatorTool(),
                BedrockImageGeneratorTool(),
                S3ImageManagerTool(),
                DatabaseUpdaterTool()
            ],
            max_iterations=10
        )

        agent = Agent(config=agent_config)

        # Process the event based on type
        if event_type in ['FoodItemCreated', 'FoodItemUpdated']:
            result = process_food_event(agent, event_detail)
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


def process_food_event(agent: Agent, event_detail: Dict[str, Any]) -> Dict[str, Any]:
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
    logger.info(f"Image required for {food_id}: {image_required}")

    # Safely handle ingredients field
    ingredients = event_detail.get('ingredients', [])
    if ingredients and isinstance(ingredients, list):
        ingredients_text = ', '.join(ingredients)
    else:
        ingredients_text = 'Not specified'

    # Create task for the agent for creation/update events
    task = f"""
    Process a food item event and generate an image if needed:
    
    Food Details:
    - ID: {food_id}
    - Name: {food_name}
    - Pet Type: {event_detail.get('pet_type') or 'Not specified'}
    - Food Type: {event_detail.get('food_type') or 'Not specified'}
    - Description: {event_detail.get('description') or 'Not specified'}
    - Ingredients: {ingredients_text}
    - Image Required: {image_required}
    
    Tasks to complete:
    1. Check if an image already exists for this food item
    2. If no image exists and image_required is true, generate a new descriptive prompt
    3. The style of the image MUST be food photography, warm lighting, appetizing presentation
    4. Validate the prompt length + style (must be under 512 characters)
    5. If the validation fails, you should truncate the prompt while preserving key elements
    6. Generate an image using Amazon Bedrock
    7. Store the image in S3
    8. Update the food record with the new image URL
    
    Use the available tools to complete these tasks autonomously.
    """

    try:
        # Execute the task using the Strands Agent
        result = agent.execute(task, context=event_detail)

        logger.info(f"Agent successfully processed food event for {food_id}")

        return {
            'food_id': food_id,
            'success': True,
            'result': result,
            'message': f'Successfully processed food event for {food_name}'
        }

    except Exception as e:
        logger.error(f"Agent failed to process food event: {str(e)}")

        return {
            'food_id': food_id,
            'success': False,
            'error': str(e),
            'message': f'Failed to process food event for {food_name}'
        }
