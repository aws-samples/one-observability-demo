"""
Unit tests for the Strands Agent Lambda function.
"""

import json
import pytest
from unittest.mock import Mock, patch, MagicMock
import boto3
from moto import mock_dynamodb, mock_s3

# Import the lambda function
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lambda_function import (
    lambda_handler,
    PromptGeneratorTool,
    PromptValidatorTool,
    BedrockImageGeneratorTool,
    S3ImageManagerTool,
    DatabaseUpdaterTool,
    process_food_event
)


class TestPromptGeneratorTool:
    """Test cases for PromptGeneratorTool."""
    
    def test_generate_prompt_success(self):
        """Test successful prompt generation."""
        tool = PromptGeneratorTool()
        
        food_data = {
            "foodId": "test-id",
            "foodName": "Beef and Turkey Kibbles",
            "petType": "Puppy",
            "foodType": "Dry",
            "description": "Nutritious blend for growing puppies",
            "ingredients": ["beef", "turkey", "rice", "vegetables"]
        }
        
        result = tool.execute(food_data)
        
        assert result["success"] is True
        assert "beef and turkey kibbles" in result["prompt"].lower()
        assert "puppy" in result["prompt"].lower()
        assert "dry food" in result["prompt"].lower()
        assert result["length"] > 0
        assert result["food_id"] == "test-id"
    
    def test_generate_prompt_minimal_data(self):
        """Test prompt generation with minimal food data."""
        tool = PromptGeneratorTool()
        
        food_data = {
            "foodId": "test-id",
            "foodName": "Basic Food"
        }
        
        result = tool.execute(food_data)
        
        assert result["success"] is True
        assert "basic food" in result["prompt"].lower()
        assert result["food_id"] == "test-id"
    
    def test_generate_prompt_error_handling(self):
        """Test error handling in prompt generation."""
        tool = PromptGeneratorTool()
        
        # Test with invalid data
        result = tool.execute(None)
        
        assert result["success"] is False
        assert "error" in result


class TestPromptValidatorTool:
    """Test cases for PromptValidatorTool."""
    
    def test_validate_short_prompt(self):
        """Test validation of short prompt."""
        tool = PromptValidatorTool()
        
        prompt_data = {
            "prompt": "A bowl of dog food, professional photography"
        }
        
        result = tool.execute(prompt_data)
        
        assert result["success"] is True
        assert result["is_valid"] is True
        assert result["was_truncated"] is False
        assert result["final_length"] == len(prompt_data["prompt"])
    
    def test_validate_long_prompt(self):
        """Test validation and truncation of long prompt."""
        tool = PromptValidatorTool()
        
        # Create a prompt longer than 512 characters
        long_prompt = "A bowl of dog food, " + "very detailed description, " * 30
        prompt_data = {"prompt": long_prompt}
        
        result = tool.execute(prompt_data)
        
        assert result["success"] is True
        assert result["is_valid"] is True
        assert result["was_truncated"] is True
        assert result["final_length"] <= 512
        assert result["original_length"] > 512
    
    def test_intelligent_truncation(self):
        """Test intelligent truncation preserves key elements."""
        tool = PromptValidatorTool()
        
        # Test the private method
        long_prompt = "A bowl of beef kibbles designed for puppies, containing beef, turkey, rice, " + \
                     "professional product photography, clean white background, " * 10
        
        truncated = tool._intelligent_truncate(long_prompt, 200)
        
        assert len(truncated) <= 200
        assert "bowl" in truncated or "designed for" in truncated


class TestS3ImageManagerTool:
    """Test cases for S3ImageManagerTool."""
    
    @mock_s3
    def test_check_image_exists_true(self):
        """Test checking for existing image."""
        # Setup mock S3
        s3_client = boto3.client('s3', region_name='us-east-1')
        bucket_name = 'test-bucket'
        s3_client.create_bucket(Bucket=bucket_name)
        s3_client.put_object(Bucket=bucket_name, Key='test-image.jpg', Body=b'test')
        
        tool = S3ImageManagerTool()
        
        with patch('lambda_function.S3_BUCKET_NAME', bucket_name):
            with patch('lambda_function.s3_client', s3_client):
                result = tool.execute({
                    "operation": "check_exists",
                    "image_path": "test-image.jpg"
                })
        
        assert result["success"] is True
        assert result["exists"] is True
    
    @mock_s3
    def test_check_image_exists_false(self):
        """Test checking for non-existing image."""
        # Setup mock S3
        s3_client = boto3.client('s3', region_name='us-east-1')
        bucket_name = 'test-bucket'
        s3_client.create_bucket(Bucket=bucket_name)
        
        tool = S3ImageManagerTool()
        
        with patch('lambda_function.S3_BUCKET_NAME', bucket_name):
            with patch('lambda_function.s3_client', s3_client):
                result = tool.execute({
                    "operation": "check_exists",
                    "image_path": "non-existing.jpg"
                })
        
        assert result["success"] is True
        assert result["exists"] is False
    
    @mock_s3
    def test_store_image(self):
        """Test storing image in S3."""
        import base64
        
        # Setup mock S3
        s3_client = boto3.client('s3', region_name='us-east-1')
        bucket_name = 'test-bucket'
        s3_client.create_bucket(Bucket=bucket_name)
        
        tool = S3ImageManagerTool()
        
        # Create test image data
        test_image = b'fake image data'
        image_data = base64.b64encode(test_image).decode('utf-8')
        
        with patch('lambda_function.S3_BUCKET_NAME', bucket_name):
            with patch('lambda_function.s3_client', s3_client):
                result = tool.execute({
                    "operation": "store_image",
                    "image_data": image_data,
                    "food_id": "test-id",
                    "food_name": "Test Food"
                })
        
        assert result["success"] is True
        assert "image_url" in result
        assert "test-food.jpg" in result["image_path"]


class TestDatabaseUpdaterTool:
    """Test cases for DatabaseUpdaterTool."""
    
    @mock_dynamodb
    def test_update_food_record(self):
        """Test updating food record with image URL."""
        # Setup mock DynamoDB
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        table_name = 'test-foods'
        
        table = dynamodb.create_table(
            TableName=table_name,
            KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        # Insert test food
        table.put_item(Item={'id': 'test-id', 'name': 'Test Food'})
        
        tool = DatabaseUpdaterTool()
        
        with patch('lambda_function.FOOD_TABLE_NAME', table_name):
            with patch('lambda_function.dynamodb', dynamodb):
                result = tool.execute({
                    "food_id": "test-id",
                    "image_url": "https://example.com/image.jpg"
                })
        
        assert result["success"] is True
        assert result["updated"] is True
        assert result["food_id"] == "test-id"


class TestLambdaHandler:
    """Test cases for the main lambda handler."""
    
    @patch('lambda_function.Agent')
    @patch('lambda_function.setup_tracing')
    def test_lambda_handler_food_created(self, mock_setup_tracing, mock_agent_class):
        """Test lambda handler with FoodItemCreated event."""
        # Setup mock agent
        mock_agent = Mock()
        mock_agent.execute.return_value = {"success": True, "message": "Image generated"}
        mock_agent_class.return_value = mock_agent
        
        event = {
            "source": "petfood.service",
            "detail-type": "FoodItemCreated",
            "detail": {
                "eventType": "FoodItemCreated",
                "foodId": "test-id",
                "foodName": "Test Food",
                "petType": "Dog",
                "foodType": "Dry",
                "description": "Test description",
                "ingredients": ["beef", "rice"]
            }
        }
        
        context = Mock()
        
        result = lambda_handler(event, context)
        
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["success"] is True
        assert body["food_id"] == "test-id"
        
        # Verify agent was called
        mock_agent.execute.assert_called_once()
    
    def test_lambda_handler_unknown_event_type(self):
        """Test lambda handler with unknown event type."""
        event = {
            "source": "petfood.service",
            "detail-type": "UnknownEvent",
            "detail": {
                "eventType": "UnknownEvent"
            }
        }
        
        context = Mock()
        
        with patch('lambda_function.setup_tracing'):
            result = lambda_handler(event, context)
        
        assert result["statusCode"] == 400
        body = json.loads(result["body"])
        assert body["success"] is False
        assert "Unknown event type" in body["message"]
    
    @patch('lambda_function.Agent')
    @patch('lambda_function.setup_tracing')
    def test_lambda_handler_error(self, mock_setup_tracing, mock_agent_class):
        """Test lambda handler error handling."""
        # Setup mock agent to raise exception
        mock_agent_class.side_effect = Exception("Test error")
        
        event = {
            "source": "petfood.service",
            "detail-type": "FoodItemCreated",
            "detail": {
                "eventType": "FoodItemCreated",
                "foodId": "test-id"
            }
        }
        
        context = Mock()
        
        result = lambda_handler(event, context)
        
        assert result["statusCode"] == 500
        body = json.loads(result["body"])
        assert body["success"] is False
        assert "Test error" in body["message"]


class TestProcessFoodEvent:
    """Test cases for process_food_event function."""
    
    @patch('lambda_function.Agent')
    def test_process_food_event_success(self, mock_agent_class):
        """Test successful food event processing."""
        # Setup mock agent
        mock_agent = Mock()
        mock_agent.execute.return_value = {"success": True, "image_url": "https://example.com/image.jpg"}
        mock_agent_class.return_value = mock_agent
        
        event_detail = {
            "foodId": "test-id",
            "foodName": "Test Food",
            "petType": "Dog",
            "foodType": "Dry",
            "description": "Test description",
            "ingredients": ["beef", "rice"]
        }
        
        result = process_food_event(mock_agent, event_detail)
        
        assert result["success"] is True
        assert result["food_id"] == "test-id"
        assert "Test Food" in result["message"]
        
        # Verify agent was called with correct task
        mock_agent.execute.assert_called_once()
        call_args = mock_agent.execute.call_args
        assert "test-id" in call_args[0][0]  # Task contains food ID
        assert call_args[1]["context"] == event_detail  # Context passed correctly
    
    @patch('lambda_function.Agent')
    def test_process_food_event_error(self, mock_agent_class):
        """Test food event processing error handling."""
        # Setup mock agent to raise exception
        mock_agent = Mock()
        mock_agent.execute.side_effect = Exception("Agent error")
        mock_agent_class.return_value = mock_agent
        
        event_detail = {
            "foodId": "test-id",
            "foodName": "Test Food"
        }
        
        result = process_food_event(mock_agent, event_detail)
        
        assert result["success"] is False
        assert result["food_id"] == "test-id"
        assert "Agent error" in result["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])