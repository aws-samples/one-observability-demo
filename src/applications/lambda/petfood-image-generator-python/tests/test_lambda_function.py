"""
Unit tests for the Strands Agent Lambda function.
"""

import json
from unittest.mock import Mock
from unittest.mock import patch

import pytest


class TestLambdaHandler:
    """Test cases for the main lambda handler."""

    @patch("lambda_function.process_food_event")
    def test_lambda_handler_food_created(self, mock_process):
        """Test lambda handler with FoodItemCreated event."""
        # Import here to avoid path issues
        from lambda_function import lambda_handler

        mock_process.return_value = {
            "success": True,
            "message": "Image generated",
            "food_id": "test-id",
        }

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

        result = lambda_handler(event, context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["success"] is True
        assert body["food_id"] == "test-id"

    def test_lambda_handler_unknown_event_type(self):
        """Test lambda handler with unknown event type."""
        from lambda_function import lambda_handler

        event = {
            "source": "petfood.service",
            "detail-type": "UnknownEvent",
            "detail": {"event_type": "UnknownEvent"},
        }

        context = Mock()

        result = lambda_handler(event, context)

        assert result["statusCode"] == 400
        body = json.loads(result["body"])
        assert body["success"] is False
        assert "Unknown event type" in body["message"]

    def test_lambda_handler_error(self):
        """Test lambda handler error handling."""
        from lambda_function import lambda_handler

        event = {
            "source": "petfood.service",
            "detail-type": "FoodItemCreated",
            "detail": {},  # Missing required fields
        }

        context = Mock()

        result = lambda_handler(event, context)

        assert result["statusCode"] == 500
        body = json.loads(result["body"])
        assert body["success"] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
