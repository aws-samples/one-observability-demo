# Pet Food Stock Processor Lambda

A Node.js Lambda function that processes `StockPurchased` events from EventBridge and decreases food inventory quantities in DynamoDB.

## Overview

This Lambda function is triggered by EventBridge events when customers purchase pet food items. It automatically decreases the stock quantities in the DynamoDB foods table to maintain accurate inventory levels.

## Dependencies

- **aws-xray-sdk-core**: AWS X-Ray tracing integration
- **@aws-sdk/client-dynamodb**: AWS SDK v3 DynamoDB client
- **@aws-sdk/lib-dynamodb**: AWS SDK v3 DynamoDB document client

## Environment Variables

- `FOODS_TABLE_NAME`: Name of the DynamoDB table containing food items

## Event Structure

The function expects EventBridge events with the following structure:

```json
{
  "detail": {
    "event_type": "StockPurchased",
    "order_id": "order-123",
    "user_id": "user-456",
    "items": [
      {
        "food_id": "F123",
        "food_name": "Premium Dog Food",
        "quantity": 2
      }
    ],
    "span_context": "..."
  }
}
```

## Scripts

- `npm test`: Run Jest tests
- `npm run test:real`: Run the real event test (requires Jest environment)
- `npm run lint`: Run ESLint
- `npm run lint:fix`: Run ESLint with auto-fix

## Features

- **Event Processing**: Handles both direct EventBridge events and SQS-wrapped events
- **Stock Management**: Decreases inventory quantities with validation
- **Error Handling**: Comprehensive error handling with context logging
- **Observability**: AWS X-Ray tracing and structured logging
- **Monitoring**: Custom alerts for out-of-stock and low-stock conditions
- **Race Condition Protection**: Uses conditional updates to prevent race conditions

## Deployment

This Lambda function is deployed via CDK as part of the One Observability Demo workshop infrastructure.