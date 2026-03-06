"""
Unit tests for the Strands Agent Lambda function.
"""

import sys
import os
from unittest.mock import Mock, patch
import pytest

# Add the parent directory to the Python path so we can import lambda_function
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Mock environment variables to avoid AWS region issues
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("FOOD_TABLE_NAME", "test-food-table")
os.environ.setdefault("S3_BUCKET_NAME", "test-bucket")
os.environ.setdefault("BEDROCK_MODEL_ID", "amazon.titan-image-generator-v2:0")


class TestLambdaHandler:
    """Test cases for the main lambda handler."""

    @patch("boto3.resource")
    @patch("boto3.client")
    def test_lambda_handler_food_created(
        self,
        mock_boto_client,
        mock_boto_resource,
    ):
        """Test lambda handler with FoodItemCreated event."""
        # Import after mocking
        from lambda_function import handler

        event = {
            "source": "petfood.service",
            "detail-type": "FoodItemCreated",
            "detail": {
                "event_type": "FoodItemCreated",
                "food_id": "test-id",
                "food_name": "Test Food",
                "pet_type": "Dog",
                "food_type": "Dry",
                "description": "Test description",
                "ingredients": ["beef", "rice"],
            },
        }

        context = Mock()

        result = handler(event, context)

        # The current implementation returns a dict with statusCode 500
        assert result["statusCode"] == 500
        assert result["body"] == "Function not implemented"

    @patch("boto3.resource")
    @patch("boto3.client")
    def test_lambda_handler_unknown_event_type(
        self,
        mock_boto_client,
        mock_boto_resource,
    ):
        """Test lambda handler with unknown event type."""
        from lambda_function import handler

        event = {
            "source": "petfood.service",
            "detail-type": "UnknownEvent",
            "detail": {
                "event_type": "UnknownEvent",
                "food_id": "test-id",  # Required field
            },
        }

        context = Mock()

        result = handler(event, context)

        # The current implementation returns a dict with statusCode 500
        assert result["statusCode"] == 500
        assert result["body"] == "Function not implemented"

    @patch("boto3.resource")
    @patch("boto3.client")
    def test_lambda_handler_error(self, mock_boto_client, mock_boto_resource):
        """Test lambda handler error handling."""
        from lambda_function import handler

        event = {
            "source": "petfood.service",
            "detail-type": "FoodItemCreated",
            "detail": {},  # Missing required fields
        }

        context = Mock()

        result = handler(event, context)

        # The current implementation returns a dict with statusCode 500
        assert result["statusCode"] == 500
        assert result["body"] == "Function not implemented"

    def test_extract_event_fields(self):
        """Test extract_event_fields function."""
        from lambda_function import extract_event_fields

        event = {
            "detail": {
                "event_type": "FoodItemCreated",
                "food_id": "test-id",
                "food_name": "Premium Dog Food",
                "pet_type": "dog",
                "food_type": "dry",
                "description": "High-quality dry food for adult dogs",
                "ingredients": ["chicken", "rice", "vegetables"],
            },
        }

        result = extract_event_fields(event)
        assert isinstance(result, dict)
        assert result["event_type"] == "FoodItemCreated"
        assert result["food_id"] == "test-id"
        assert result["food_name"] == "Premium Dog Food"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
