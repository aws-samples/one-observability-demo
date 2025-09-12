#!/usr/bin/env python3
"""
Unified Pet Image Generation Script
Generates images for bunnies, kittens, puppies, and petfood using Amazon Bedrock Titan Image Generator v2.
Reuses sophisticated prompt engineering logic from existing Lambda function.
"""

import argparse
import base64
import json
import logging
import os
import random
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Configuration
BEDROCK_MODEL_ID = "amazon.titan-image-generator-v2:0"
BEDROCK_REGION = "us-east-1"  # Titan Image Generator is available in limited regions
OUTPUT_DIR = Path("generated_images")
STATIC_DIR = Path("static/images")
MAX_RETRIES = 3
BASE_DELAY = 1.0


class BedrockModelValidator:
    """Validates Bedrock model availability and access."""

    def __init__(self, region: str = BEDROCK_REGION):
        self.region = region
        self.bedrock_client = None

    def validate_credentials(self) -> bool:
        """Validate AWS credentials are available."""
        try:
            session = boto3.Session()
            credentials = session.get_credentials()
            if not credentials:
                logger.error("❌ No AWS credentials found")
                logger.error(
                    "Please configure credentials using 'aws configure' or environment variables",
                )
                return False
            logger.info("✅ AWS credentials found")
            return True
        except Exception as e:
            logger.error(f"❌ Error checking credentials: {e}")
            return False

    def check_model_access(self) -> bool:
        """Check if Titan Image Generator v2 is accessible."""
        try:
            if not self.bedrock_client:
                self.bedrock_client = boto3.client("bedrock", region_name=self.region)

            # List available foundation models
            response = self.bedrock_client.list_foundation_models()

            # Check if our model is available
            available_models = [
                model["modelId"] for model in response.get("modelSummaries", [])
            ]

            if BEDROCK_MODEL_ID in available_models:
                logger.info(
                    f"✅ Model {BEDROCK_MODEL_ID} is available in {self.region}",
                )
                return True
            else:
                logger.error(
                    f"❌ Model {BEDROCK_MODEL_ID} is not available in {self.region}",
                )
                logger.error("Available Bedrock models:")
                for model in response.get("modelSummaries", []):
                    if "titan-image" in model["modelId"]:
                        logger.error(f"  - {model['modelId']}")
                return False

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "AccessDeniedException":
                logger.error(f"❌ Access denied to Bedrock in {self.region}")
                logger.error("Please ensure:")
                logger.error("1. You have Bedrock permissions in your AWS account")
                logger.error("2. Model access is enabled in the Bedrock console")
                logger.error(
                    f"3. You're in a supported region (current: {self.region})",
                )
            else:
                logger.error(f"❌ Error checking model access: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error checking model access: {e}")
            return False

    def test_model_invocation(self) -> bool:
        """Test actual model invocation with a simple request."""
        try:
            bedrock_runtime = boto3.client("bedrock-runtime", region_name=self.region)

            # Simple test request
            test_request = {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {
                    "text": "A simple test image, white background",
                    "negativeText": "blurry, low quality",
                },
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "height": 512,
                    "width": 512,
                    "cfgScale": 8.0,
                    "seed": 12345,
                },
            }

            logger.info("🧪 Testing model invocation...")
            response = bedrock_runtime.invoke_model(
                modelId=BEDROCK_MODEL_ID,
                body=json.dumps(test_request),
                contentType="application/json",
                accept="application/json",
            )

            response_body = json.loads(response["body"].read())
            if "images" in response_body and len(response_body["images"]) > 0:
                logger.info("✅ Model invocation test successful")
                return True
            else:
                logger.error("❌ Model invocation test failed - no images returned")
                return False

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "AccessDeniedException":
                logger.error(
                    "❌ Model access denied - please enable model access in Bedrock console",
                )
                logger.error(
                    f"🔗 Enable model access: https://{self.region}.console.aws.amazon.com/bedrock/home?region={self.region}#/modelaccess",
                )
            elif error_code == "ValidationException":
                logger.error(
                    "❌ Model validation failed - check model ID and parameters",
                )
            else:
                logger.error(f"❌ Model invocation failed: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error testing model invocation: {e}")
            return False


class EnhancedPromptBuilder:
    """Advanced prompt builder with contextual intelligence - adapted from Lambda function."""

    def __init__(self, item_data: Dict[str, Any], category: str):
        self.item_data = item_data
        self.category = category.lower()
        self.name = item_data.get("name", item_data.get("pettype", ""))
        self.color = item_data.get("petcolor", item_data.get("color", ""))
        self.price = float(item_data.get("price", 0))

        # Enhanced contextual mappings
        self.pet_contexts = {
            "bunny": {
                "bowl_style": "natural wooden bowl",
                "characteristics": "fluffy, adorable bunny with soft fur",
                "presentation": "organic, rustic presentation with natural lighting",
                "colors": "earthy, natural tones",
                "setting": "clean studio background with soft shadows",
            },
            "kitten": {
                "bowl_style": "elegant small ceramic bowl",
                "characteristics": "cute kitten with bright, curious eyes",
                "presentation": "refined, gentle presentation with warm lighting",
                "colors": "soft, sophisticated colors",
                "setting": "professional studio lighting, clean white background",
            },
            "puppy": {
                "bowl_style": "small ceramic puppy bowl",
                "characteristics": "playful puppy with happy, energetic expression",
                "presentation": "playful, nurturing presentation with bright lighting",
                "colors": "warm, inviting colors",
                "setting": "bright, clean studio setup with professional lighting",
            },
        }

        # Food-specific contexts (reused from Lambda)
        self.food_contexts = {
            "dry": "premium dry pet food with visible kibble pieces",
            "wet": "gourmet wet food with rich, glossy appearance",
            "treat": "delicious pet treats scattered artfully",
            "default": "high-quality pet food with appetizing presentation",
        }

    def build_pet_prompt(self) -> str:
        """Build prompt for pet images (bunnies, kittens, puppies)."""
        context = self.pet_contexts.get(self.category, self.pet_contexts["puppy"])

        # Color-specific descriptions
        color_descriptions = {
            "white": "pristine white fur, clean and fluffy",
            "black": "sleek black coat with natural shine",
            "brown": "warm brown fur with rich tones",
            "grey": "soft grey fur with subtle variations",
            "gray": "soft grey fur with subtle variations",
        }

        color_desc = color_descriptions.get(
            self.color.lower(), f"{self.color} colored fur",
        )

        prompt_parts = [
            f"{context['characteristics']} with {color_desc}",
            f"sitting next to a {context['bowl_style']}",
            f"{context['presentation']}",
            f"professional pet photography, {context['setting']}",
            "high resolution, adorable and appealing",
        ]

        return ", ".join(prompt_parts)

    def build_food_prompt(self) -> str:
        """Build prompt for petfood images using Lambda logic."""
        food_data = self.item_data

        # Extract food characteristics
        food_name = food_data.get("name", "Premium Pet Food")
        food_type = food_data.get("food_type", "dry").lower()
        pet_type = food_data.get("pet_type", "dog").lower()
        description = food_data.get("description", "")

        # Determine premium level
        is_premium = (
            "premium" in food_name.lower()
            or "gourmet" in description.lower()
            or self.price > 25.0
        )

        # Food type context
        food_context = self.food_contexts.get(food_type, self.food_contexts["default"])

        # Bowl selection based on pet type
        bowl_styles = {
            "dog": "ceramic dog bowl",
            "cat": "elegant cat food bowl",
            "kitten": "small kitten bowl",
            "puppy": "puppy feeding bowl",
        }
        bowl_style = bowl_styles.get(pet_type, "ceramic pet bowl")

        # Build prompt components
        if is_premium:
            styling = "luxury product photography, professional studio lighting, premium presentation"
        else:
            styling = (
                "clean product photography, natural lighting, appealing presentation"
            )

        prompt_parts = [
            f"{food_context} in {bowl_style}",
            "appetizing and fresh appearance",
            styling,
            "clean white background, high resolution, commercial quality",
        ]

        return ", ".join(prompt_parts)

    def build(self) -> str:
        """Build appropriate prompt based on category."""
        if self.category in ["bunny", "kitten", "puppy"]:
            return self.build_pet_prompt()
        elif self.category == "petfood":
            return self.build_food_prompt()
        else:
            return f"Professional {self.category} photography, clean white background, high resolution"


class PetImageGenerator:
    """Main image generation class."""

    def __init__(self, region: str = BEDROCK_REGION):
        self.region = region
        self.bedrock_runtime = None
        self.seed_data = {}

    def initialize(self) -> bool:
        """Initialize the generator and validate setup."""
        # Validate credentials and model access
        validator = BedrockModelValidator(self.region)

        if not validator.validate_credentials():
            return False

        if not validator.check_model_access():
            return False

        if not validator.test_model_invocation():
            return False

        # Initialize Bedrock client
        self.bedrock_runtime = boto3.client("bedrock-runtime", region_name=self.region)

        # Load seed data
        self._load_seed_data()

        logger.info("🚀 Image generator initialized successfully")
        return True

    def _load_seed_data(self) -> None:
        """Load seed data from JSON files."""
        script_dir = Path(__file__).parent

        # Load pet seed data
        pet_seed_file = script_dir / "seed.json"
        if pet_seed_file.exists():
            with open(pet_seed_file) as f:
                pet_data = json.load(f)

            # Organize by category
            for item in pet_data:
                category = item.get("pettype", "").lower()
                if category not in self.seed_data:
                    self.seed_data[category] = []
                self.seed_data[category].append(item)

        # Load petfood seed data
        food_seed_file = script_dir / "petfood-seed.json"
        if food_seed_file.exists():
            with open(food_seed_file) as f:
                food_data = json.load(f)
                self.seed_data["petfood"] = food_data

        logger.info(
            f"📊 Loaded seed data: {dict((k, len(v)) for k, v in self.seed_data.items())}",
        )

    def _generate_single_image(
        self, prompt: str, filename: str, max_retries: int = MAX_RETRIES,
    ) -> bool:
        """Generate a single image with retry logic."""

        for attempt in range(max_retries):
            try:
                # Add jitter to avoid rate limiting
                if attempt > 0:
                    delay = BASE_DELAY * (2**attempt) + random.uniform(0, 1)
                    logger.info(f"⏳ Retrying {filename} in {delay:.1f}s...")
                    time.sleep(delay)

                request_body = {
                    "taskType": "TEXT_IMAGE",
                    "textToImageParams": {
                        "text": prompt,
                        "negativeText": "blurry, low quality, distorted, ugly, deformed",
                    },
                    "imageGenerationConfig": {
                        "numberOfImages": 1,
                        "height": 512,
                        "width": 512,
                        "cfgScale": 8.0,
                        "seed": random.randint(0, 1000000),
                    },
                }

                logger.info(f"🎨 Generating {filename}... (attempt {attempt + 1})")

                response = self.bedrock_runtime.invoke_model(
                    modelId=BEDROCK_MODEL_ID,
                    body=json.dumps(request_body),
                    contentType="application/json",
                    accept="application/json",
                )

                response_body = json.loads(response["body"].read())

                if "images" in response_body and len(response_body["images"]) > 0:
                    # Decode and save image
                    image_data = response_body["images"][0]
                    image_bytes = base64.b64decode(image_data)

                    # Ensure output directory exists
                    OUTPUT_DIR.mkdir(exist_ok=True)
                    image_path = OUTPUT_DIR / filename

                    with open(image_path, "wb") as f:
                        f.write(image_bytes)

                    logger.info(f"✅ Generated {filename} ({len(image_bytes):,} bytes)")
                    return True
                else:
                    logger.warning(f"⚠️  No image data returned for {filename}")

            except Exception as e:
                logger.warning(f"❌ Attempt {attempt + 1} failed for {filename}: {e}")

                if attempt == max_retries - 1:
                    logger.error(f"🚫 All attempts failed for {filename}")
                    return False

        return False

    def generate_category(self, category: str) -> bool:
        """Generate images for a specific category."""
        if category not in self.seed_data:
            logger.error(f"❌ No seed data found for category: {category}")
            return False

        items = self.seed_data[category]
        logger.info(f"🎯 Generating {len(items)} images for {category}")

        success_count = 0

        for item in items:
            # Determine filename based on category
            if category == "petfood":
                # Petfood uses f1.jpg, f2.jpg, etc.
                food_id = item.get("id", "F000")
                image_num = food_id.replace("F", "").zfill(3)
                filename = f"f{int(image_num)}.jpg"
            else:
                # Pets use existing image field
                image_code = item.get("image", f"{category[0]}1")
                filename = f"{image_code}.jpg"

            # Generate prompt
            prompt_builder = EnhancedPromptBuilder(item, category)
            prompt = prompt_builder.build()

            logger.info(f"📝 Prompt for {filename}: {prompt[:100]}...")

            # Generate image
            if self._generate_single_image(prompt, filename):
                success_count += 1
            else:
                logger.error(f"❌ Failed to generate {filename}")

        logger.info(f"📈 Generated {success_count}/{len(items)} images for {category}")
        return success_count == len(items)

    def create_zip_file(self, category: str) -> bool:
        """Create zip file for a category."""
        if category not in self.seed_data:
            logger.error(f"❌ No seed data for category: {category}")
            return False

        # Determine expected files
        items = self.seed_data[category]
        expected_files = []

        for item in items:
            if category == "petfood":
                food_id = item.get("id", "F000")
                image_num = food_id.replace("F", "").zfill(3)
                filename = f"f{int(image_num)}.jpg"
            else:
                image_code = item.get("image", f"{category[0]}1")
                filename = f"{image_code}.jpg"
            expected_files.append(filename)

        # Check if all files exist
        missing_files = []
        for filename in expected_files:
            if not (OUTPUT_DIR / filename).exists():
                missing_files.append(filename)

        if missing_files:
            logger.error(f"❌ Missing files for {category}: {missing_files}")
            return False

        # Create zip file
        STATIC_DIR.mkdir(parents=True, exist_ok=True)
        zip_name = f"{category}.zip" if category != "petfood" else "petfood.zip"
        zip_path = STATIC_DIR / zip_name

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for filename in expected_files:
                file_path = OUTPUT_DIR / filename
                zipf.write(file_path, filename)

        logger.info(f"📦 Created {zip_path} with {len(expected_files)} images")
        return True

    def validate_counts(self) -> Dict[str, Dict[str, int]]:
        """Validate generated image counts against seed data."""
        results = {}

        for category, items in self.seed_data.items():
            expected_count = len(items)

            # Count generated files
            generated_files = []
            for item in items:
                if category == "petfood":
                    food_id = item.get("id", "F000")
                    image_num = food_id.replace("F", "").zfill(3)
                    filename = f"f{int(image_num)}.jpg"
                else:
                    image_code = item.get("image", f"{category[0]}1")
                    filename = f"{image_code}.jpg"

                if (OUTPUT_DIR / filename).exists():
                    generated_files.append(filename)

            results[category] = {
                "expected": expected_count,
                "generated": len(generated_files),
                "missing": expected_count - len(generated_files),
            }

        return results


def main():
    parser = argparse.ArgumentParser(
        description="Generate pet and petfood images using Amazon Bedrock",
    )
    parser.add_argument(
        "--type",
        help="Comma-separated list of categories to generate (bunnies,kittens,puppies,petfood)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate counts, don't generate",
    )
    parser.add_argument(
        "--create-zips", action="store_true", help="Create zip files after generation",
    )
    parser.add_argument(
        "--region",
        default=BEDROCK_REGION,
        help=f"AWS region (default: {BEDROCK_REGION})",
    )

    args = parser.parse_args()

    # Initialize generator
    generator = PetImageGenerator(args.region)

    if not generator.initialize():
        logger.error("❌ Failed to initialize image generator")
        sys.exit(1)

    # Determine categories to process
    all_categories = ["bunny", "kitten", "puppy", "petfood"]
    if args.type:
        categories = [cat.strip() for cat in args.type.split(",")]
        # Validate categories
        invalid_categories = [cat for cat in categories if cat not in all_categories]
        if invalid_categories:
            logger.error(f"❌ Invalid categories: {invalid_categories}")
            logger.error(f"Valid categories: {all_categories}")
            sys.exit(1)
    else:
        categories = all_categories

    # Validation mode
    if args.validate_only:
        logger.info("🔍 Validating image counts...")
        results = generator.validate_counts()

        print("\n📊 Validation Results:")
        print("-" * 50)
        for category, counts in results.items():
            status = "✅" if counts["missing"] == 0 else "❌"
            print(
                f"{status} {category.capitalize()}: {counts['generated']}/{counts['expected']} images",
            )

        return

    # Generate images
    logger.info(f"🎯 Processing categories: {', '.join(categories)}")

    success_categories = []
    failed_categories = []

    for category in categories:
        logger.info(f"\n🎨 Processing {category}...")
        if generator.generate_category(category):
            success_categories.append(category)
            logger.info(f"✅ {category.capitalize()} generation completed")
        else:
            failed_categories.append(category)
            logger.error(f"❌ {category.capitalize()} generation failed")

    # Create zip files if requested
    if args.create_zips:
        logger.info("\n📦 Creating zip files...")
        for category in success_categories:
            if generator.create_zip_file(category):
                logger.info(f"✅ Created {category}.zip")
            else:
                logger.error(f"❌ Failed to create {category}.zip")

    # Final validation
    logger.info("\n🔍 Final validation...")
    results = generator.validate_counts()

    print("\n📊 Final Results:")
    print("=" * 60)
    for category, counts in results.items():
        status = "✅" if counts["missing"] == 0 else "❌"
        print(
            f"{status} {category.capitalize()}: {counts['generated']}/{counts['expected']} images",
        )

    if failed_categories:
        logger.error(f"\n❌ Failed categories: {', '.join(failed_categories)}")
        sys.exit(1)
    else:
        logger.info(f"\n🎉 All categories completed successfully!")


if __name__ == "__main__":
    main()
