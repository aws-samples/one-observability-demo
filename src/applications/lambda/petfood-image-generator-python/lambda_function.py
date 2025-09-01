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


def generate_prompt(food_data: Dict[str, Any]) -> str:
    """Generate a sophisticated, contextually rich prompt for image generation."""
    try:
        # Extract all available data fields
        food_name = food_data.get("food_name", "")
        pet_type = food_data.get("pet_type", "")
        food_type = food_data.get("food_type", "")
        description = food_data.get("description", "")
        ingredients = food_data.get("ingredients", [])
        nutritional_info = food_data.get("nutritional_info", {})
        feeding_guidelines = food_data.get("feeding_guidelines", "")
        price = food_data.get("price", 0)

        # Enhanced prompt generation with contextual intelligence
        prompt_builder = EnhancedPromptBuilder(
            food_name,
            pet_type,
            food_type,
            description,
            ingredients,
            nutritional_info,
            feeding_guidelines,
            price,
        )

        full_prompt = prompt_builder.build()

        # Validate length (Bedrock limit is 512 characters)
        if len(full_prompt) > 512:
            full_prompt = _intelligent_truncate(full_prompt, 512)

        logger.info(f"Generated enhanced prompt: {full_prompt}")
        return full_prompt

    except Exception as e:
        logger.error(f"Error generating prompt: {str(e)}")
        return (
            "A bowl of pet food, professional product photography, "
            "clean white background"
        )


class EnhancedPromptBuilder:
    """Advanced prompt builder with contextual intelligence."""

    def __init__(
        self,
        food_name: str,
        pet_type: str,
        food_type: str,
        description: str,
        ingredients: list,
        nutritional_info: dict,
        feeding_guidelines: str,
        price: float,
    ):
        self.food_name = food_name
        self.pet_type = pet_type.lower() if pet_type else ""
        self.food_type = food_type.lower() if food_type else ""
        self.description = description.lower() if description else ""
        self.ingredients = [ing.lower() for ing in ingredients] if ingredients else []
        self.nutritional_info = nutritional_info or {}
        self.feeding_guidelines = (
            feeding_guidelines.lower() if feeding_guidelines else ""
        )
        self.price = float(price) if price else 0.0

        # Contextual mappings for intelligent prompt generation
        self.pet_contexts = {
            "puppy": {
                "bowl_style": "small ceramic puppy bowl",
                "food_characteristics": "small, bite-sized pieces",
                "presentation": "playful, nurturing presentation",
                "colors": "warm, inviting colors",
            },
            "kitten": {
                "bowl_style": "elegant small ceramic bowl",
                "food_characteristics": "fine, delicate pieces",
                "presentation": "refined, gentle presentation",
                "colors": "soft, sophisticated colors",
            },
            "bunny": {
                "bowl_style": "natural wooden bowl",
                "food_characteristics": "natural, wholesome pellets and pieces",
                "presentation": "organic, rustic presentation",
                "colors": "earthy, natural tones",
            },
        }

        self.food_type_contexts = {
            "dry": {
                "texture": "crispy, crunchy kibble",
                "appearance": "individual pieces clearly visible",
                "lighting": "bright, clean lighting to show texture",
            },
            "wet": {
                "texture": "moist, tender chunks in sauce",
                "appearance": "rich, glossy appearance with visible meat",
                "lighting": "warm lighting to enhance richness",
            },
            "treats": {
                "texture": "appealing, bite-sized treats",
                "appearance": "scattered artfully around bowl",
                "lighting": "bright, inviting lighting",
            },
            "raw": {
                "texture": "fresh, natural meat pieces",
                "appearance": "premium, restaurant-quality presentation",
                "lighting": "natural lighting to show freshness",
            },
        }

        self.ingredient_visuals = {
            # Proteins
            "chicken": "golden-brown meat pieces",
            "beef": "rich, dark meat chunks",
            "salmon": "pink, flaky fish pieces",
            "tuna": "light pink fish flakes",
            "turkey": "light brown, tender meat",
            "lamb": "reddish-brown meat pieces",
            "duck": "rich, dark meat with natural oils",
            # Vegetables
            "carrot": "bright orange carrot pieces",
            "sweet potato": "orange sweet potato chunks",
            "peas": "vibrant green pea pieces",
            "spinach": "dark green leafy flecks",
            "broccoli": "small green broccoli pieces",
            "pumpkin": "orange pumpkin chunks",
            # Grains
            "rice": "white rice grains",
            "oats": "golden oat flakes",
            "barley": "light brown barley grains",
            "quinoa": "small, round quinoa seeds",
            # Special ingredients
            "blueberry": "dark blue berry pieces",
            "cranberry": "red berry pieces",
            "apple": "light fruit pieces",
            "herbs": "green herb flecks",
            "catnip": "light green catnip tint",
        }

        self.premium_indicators = [
            "premium",
            "gourmet",
            "organic",
            "natural",
            "grain-free",
            "free-range",
            "wild-caught",
            "artisan",
            "holistic",
        ]

    def build(self) -> str:
        """Build a sophisticated, contextually aware prompt."""
        components = []

        # 1. Determine presentation context
        pet_context = self._get_pet_context()
        food_context = self._get_food_type_context()

        # 2. Build main subject with intelligent bowl selection
        bowl_description = pet_context.get("bowl_style", "ceramic bowl")
        components.append(f"Premium pet food in {bowl_description}")

        # 3. Add food characteristics based on type and ingredients
        food_characteristics = self._build_food_characteristics(
            pet_context,
            food_context,
        )
        if food_characteristics:
            components.append(food_characteristics)

        # 4. Add ingredient-based visual elements
        ingredient_visuals = self._extract_ingredient_visuals()
        if ingredient_visuals:
            components.append(ingredient_visuals)

        # 5. Determine premium level and adjust styling
        is_premium = self._detect_premium_product()
        styling = self._get_styling_context(is_premium, pet_context, food_context)

        # 6. Combine all components
        base_prompt = ". ".join(components)
        full_prompt = f"{base_prompt}. {styling}"

        return full_prompt

    def _get_pet_context(self) -> dict:
        """Get contextual information based on pet type."""
        # Direct mapping for exact matches
        if self.pet_type in self.pet_contexts:
            return self.pet_contexts[self.pet_type]

        # Fuzzy matching for partial matches
        for pet_key in self.pet_contexts:
            if pet_key in self.pet_type or self.pet_type in pet_key:
                return self.pet_contexts[pet_key]

        # Special cases
        if "rabbit" in self.pet_type:
            return self.pet_contexts["bunny"]

        return self.pet_contexts.get("dog", {})  # Default fallback

    def _get_food_type_context(self) -> dict:
        """Get contextual information based on food type."""
        for food_key in self.food_type_contexts:
            if food_key in self.food_type:
                return self.food_type_contexts[food_key]
        return self.food_type_contexts.get("dry", {})  # Default fallback

    def _build_food_characteristics(self, pet_context: dict, food_context: dict) -> str:
        """Build food characteristics description."""
        characteristics = []

        # Add food type specific texture
        texture = food_context.get("texture", "")
        if texture:
            characteristics.append(texture)

        # Add pet-specific characteristics
        pet_chars = pet_context.get("food_characteristics", "")
        if pet_chars and pet_chars not in texture:
            characteristics.append(pet_chars)

        # Add size/shape hints from name or description
        size_hints = self._extract_size_hints()
        if size_hints:
            characteristics.append(size_hints)

        return ", ".join(characteristics) if characteristics else ""

    def _extract_size_hints(self) -> str:
        """Extract size and shape hints from name and description."""
        text = f"{self.food_name} {self.description}".lower()

        size_keywords = {
            "small": "small-sized pieces",
            "mini": "mini kibble pieces",
            "bite": "bite-sized pieces",
            "chunk": "chunky pieces",
            "shred": "shredded texture",
            "flake": "flaky texture",
            "pellet": "pellet-shaped pieces",
            "kibble": "kibble pieces",
            "morsel": "tender morsels",
        }

        for keyword, description in size_keywords.items():
            if keyword in text:
                return description

        return ""

    def _extract_ingredient_visuals(self) -> str:
        """Extract visual descriptions based on ingredients."""
        visuals: list[str] = []

        # Process up to 3 most visually interesting ingredients
        processed_count = 0
        for ingredient in self.ingredients:
            if processed_count >= 3:
                break

            for key, visual in self.ingredient_visuals.items():
                if key in ingredient and visual not in " ".join(visuals):
                    visuals.append(visual)
                    processed_count += 1
                    break

        if visuals:
            return f"featuring {', '.join(visuals)}"
        return ""

    def _detect_premium_product(self) -> bool:
        """Detect if this is a premium product based on various indicators."""
        text = f"{self.food_name} {self.description}".lower()

        # Check for premium keywords
        has_premium_keywords = any(
            keyword in text for keyword in self.premium_indicators
        )

        # Check price point with more nuanced thresholds
        price_threshold = {
            "puppy": 25.0,
            "kitten": 20.0,
            "bunny": 20.0,
            "rabbit": 20.0,
            "dog": 30.0,
            "cat": 25.0,
        }
        threshold = price_threshold.get(self.pet_type, 25.0)
        is_high_price = self.price > threshold if self.price else False

        # Check for premium ingredients
        premium_ingredients = [
            "salmon",
            "tuna",
            "lamb",
            "duck",
            "venison",
            "bison",
            "truffle",
        ]
        has_premium_ingredients = any(
            ing in " ".join(self.ingredients) for ing in premium_ingredients
        )

        # Check for budget indicators that override premium detection
        budget_keywords = ["affordable", "budget", "value", "economy", "basic"]
        has_budget_keywords = any(keyword in text for keyword in budget_keywords)

        # Premium if has premium indicators AND not explicitly budget
        return (
            has_premium_keywords or is_high_price or has_premium_ingredients
        ) and not has_budget_keywords

    def _get_styling_context(
        self,
        is_premium: bool,
        pet_context: dict,
        food_context: dict,
    ) -> str:
        """Generate appropriate styling based on context."""
        styling_elements = []

        # Base photography style
        if is_premium:
            styling_elements.extend(
                [
                    "luxury product photography",
                    "professional studio lighting",
                    "premium presentation",
                ],
            )
        else:
            styling_elements.extend(
                [
                    "clean product photography",
                    "natural lighting",
                    "appealing presentation",
                ],
            )

        # Add pet-specific presentation
        presentation = pet_context.get("presentation", "")
        if presentation:
            styling_elements.append(presentation)

        # Add food-type specific lighting
        lighting = food_context.get("lighting", "")
        if lighting and lighting not in " ".join(styling_elements):
            styling_elements.append(lighting)

        # Add background and quality
        styling_elements.extend(
            [
                "clean white background",
                "high resolution",
                "appetizing and professional",
            ],
        )

        return ", ".join(styling_elements)


def _intelligent_truncate(prompt: str, max_length: int) -> str:
    """Intelligently truncate prompt while preserving key visual elements."""
    if len(prompt) <= max_length:
        return prompt

    # Split into sentences first, then into parts
    sentences = prompt.split(". ")

    # Priority order for preservation
    essential_keywords = [
        "premium pet food",
        "bowl",
        "featuring",
        "chunks",
        "pieces",
        "kibble",
        "meat",
        "fish",
        "chicken",
        "beef",
        "salmon",
    ]

    important_keywords = [
        "photography",
        "lighting",
        "presentation",
        "professional",
        "clean",
        "background",
        "high resolution",
    ]

    # Categorize sentences by importance
    essential_sentences = []
    important_sentences = []
    optional_sentences = []

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        if any(keyword in sentence.lower() for keyword in essential_keywords):
            essential_sentences.append(sentence)
        elif any(keyword in sentence.lower() for keyword in important_keywords):
            important_sentences.append(sentence)
        else:
            optional_sentences.append(sentence)

    # Build result prioritizing essential content
    result_parts: list[str] = []
    current_length = 0

    # Add essential sentences first
    for sentence in essential_sentences:
        test_length = (
            current_length + len(sentence) + (2 if result_parts else 0)
        )  # +2 for ". "
        if test_length <= max_length:
            result_parts.append(sentence)
            current_length = test_length
        else:
            # Try to fit a truncated version
            available_space = max_length - current_length - (2 if result_parts else 0)
            if available_space > 20:  # Only truncate if we have reasonable space
                truncated = sentence[: available_space - 3] + "..."
                result_parts.append(truncated)
            break

    # Add important sentences if space allows
    for sentence in important_sentences:
        test_length = current_length + len(sentence) + 2
        if test_length <= max_length:
            result_parts.append(sentence)
            current_length = test_length
        else:
            break

    # Add optional sentences if space allows
    for sentence in optional_sentences:
        test_length = current_length + len(sentence) + 2
        if test_length <= max_length:
            result_parts.append(sentence)
            current_length = test_length
        else:
            break

    result = ". ".join(result_parts)

    # Ensure we end properly
    if not result.endswith(".") and len(result) < max_length - 1:
        result += "."

    return result


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


def process_food_event(event_detail: Dict[str, Any]) -> Dict[str, Any]:
    """Process food creation/update events."""

    food_id = event_detail.get("food_id", "")
    food_name = event_detail.get("food_name") or "Unknown Food"
    event_type = event_detail.get("event_type", "")
    description = event_detail.get("description", "")
    metadata = event_detail.get("metadata", {})

    logger.info(f"Processing {event_type} event for {food_name} (ID: {food_id})")

    # Validate required fields
    if not food_id:
        raise ValueError("Missing required field: food_id")
    if not description:
        raise ValueError(
            "Missing required field: description. Used to help generate prompt",
        )

    # Check if image generation is required
    creation_source = metadata.get("creation_source", "unknown")
    requires_validation = metadata.get("requires_validation", "false").lower() == "true"
    is_manual_creation = metadata.get("is_manual_creation", "false").lower() == "true"
    is_seed_data = metadata.get("is_seed_data", "false").lower() == "true"

    logger.info(
        f"Image for: {food_id}, seed: {is_seed_data}, requires validation: {requires_validation}",
    )

    try:
        # step 1 generate prompt
        prompt = generate_prompt(event_detail)

        # step 2 generate image
        image_result = generate_image_with_bedrock(prompt, food_id)

        if not image_result["success"]:
            return {
                "food_id": food_id,
                "success": False,
                "error": image_result.get("error", "Image generation failed"),
                "message": f"Failed to generate image for {food_name}",
                "bedrock_attempts": image_result.get("attempts", 1),
                "retryable": image_result.get("retryable", True),
                "creation_source": creation_source,
            }

        # Step 3: Store image in S3
        storage_result = store_image_in_s3(
            image_result["image_data"],
            food_id,
            food_name,
        )

        if not storage_result["success"]:
            return {
                "food_id": food_id,
                "success": False,
                "error": storage_result.get("error", "Image storage failed"),
                "message": f"Failed to store image for {food_name}",
                "bedrock_attempts": image_result.get("attempts", 1),
                "s3_attempts": storage_result.get("attempts", 1),
                "creation_source": creation_source,
            }

        # Step 4: Update DynamoDB record with S3 key
        update_result = update_food_record(food_id, storage_result["image_key"])

        if not update_result["success"]:
            return {
                "food_id": food_id,
                "success": False,
                "error": update_result.get("error", "Database update failed"),
                "message": f"Failed to update database for {food_name}",
                "creation_source": creation_source,
            }

        logger.info(
            f"Successfully processed food event for {food_id} (source: {creation_source})",
        )

        return {
            "food_id": food_id,
            "success": True,
            "image_key": storage_result["image_key"],
            "message": f"Successfully processed food event for {food_name}",
            "bedrock_attempts": image_result.get("attempts", 1),
            "s3_attempts": storage_result.get("attempts", 1),
            "image_size_bytes": storage_result.get("size_bytes", 0),
            "creation_source": creation_source,
            "prompt_type": "existing" if get_existing_prompt(food_name) else "dynamic",
        }

    except Exception as e:
        logger.error(f"Failed to process food event: {str(e)}")
        return {
            "food_id": food_id,
            "success": False,
            "error": str(e),
            "message": f"Failed to process food event for {food_name}",
            "creation_source": creation_source,
        }


def lambda_handler(event, context):
    """
    Main Lambda handler for processing EventBridge events.
    This Lambda specifically handles image generation for FoodItemCreated and FoodItemUpdated events.
    """

    try:
        # Log event details
        logger.info(f"Processing event: {json.dumps(event, default=str)}")

        # Extract and validate event details
        event_detail = extract_event_fields(event)
        event_type = event_detail["event_type"]

        logger.info(f"Processing event type: {event_type}")

        # Process only image-related events
        if event_type in ["FoodItemCreated", "FoodItemUpdated"]:
            result = process_food_event(event_detail)
        else:
            logger.info(
                f"Event type {event_type} not handled by image generator Lambda",
            )
            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": f"Event type {event_type} not handled by this Lambda",
                        "success": True,
                    },
                ),
            }

        return {"statusCode": 200, "body": json.dumps(result)}

    except Exception as e:
        logger.error(f"Error processing event: {str(e)}")

        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "message": f"Error processing event: {str(e)}",
                    "success": False,
                },
            ),
        }
