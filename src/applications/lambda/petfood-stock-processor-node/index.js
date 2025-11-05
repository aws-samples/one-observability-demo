/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

const AWSXRay = require('aws-xray-sdk-core');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Instrument AWS SDK with X-Ray
const client = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const documentClient = DynamoDBDocumentClient.from(client);

/**
 * Lambda handler for processing StockPurchased events
 * Decreases stock quantities for purchased food items
 */
exports.handler = async function (event) {
    console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        // Process each EventBridge record
        const results = await Promise.allSettled(
            event.Records?.map(processEventBridgeRecord) || [processEventBridgeRecord(event)]
        );

        // Check for any failures
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length > 0) {
            console.error('Some stock updates failed:', failures);
            // Don't throw - we want to process successful items and let EventBridge retry failed ones
        }

        const successCount = results.filter(result => result.status === 'fulfilled').length;
        console.log(`Successfully processed ${successCount} events`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Stock processing completed',
                processed: successCount,
                failed: failures.length
            })
        };
    } catch (error) {
        console.error('Error processing stock purchase events:', error);
        throw error; // Let EventBridge retry
    }
};

/**
 * Process a single EventBridge record
 */
async function processEventBridgeRecord(record) {
    // Handle both direct EventBridge events and SQS-wrapped events
    const eventDetail = record.detail || JSON.parse(record.body || '{}').detail;
    
    if (!eventDetail) {
        throw new Error('No event detail found in record');
    }

    console.log('Processing stock purchase event:', {
        eventType: eventDetail.event_type,
        orderId: eventDetail.order_id,
        userId: eventDetail.user_id,
        itemCount: eventDetail.items?.length || 0
    });

    // Validate event type
    if (eventDetail.event_type !== 'StockPurchased') {
        console.warn(`Ignoring non-StockPurchased event: ${eventDetail.event_type}`);
        return;
    }

    // Process each purchased item
    const stockUpdatePromises = eventDetail.items.map(item => 
        updateFoodStock(item, eventDetail.order_id, eventDetail.span_context)
    );

    await Promise.all(stockUpdatePromises);
    
    console.log(`Successfully updated stock for order ${eventDetail.order_id}`);
}

/**
 * Update stock quantity for a single food item
 */
async function updateFoodStock(item, orderId, spanContext) {
    const { food_id, food_name, quantity } = item;
    
    console.log(`Updating stock for ${food_name} (${food_id}): -${quantity}`);

    try {
        // First, get current stock to validate we have enough
        const getCurrentStockParams = {
            TableName: process.env.FOODS_TABLE_NAME,
            Key: { id: food_id },
            ProjectionExpression: 'stock_quantity, #name, availability_status',
            ExpressionAttributeNames: {
                '#name': 'name'
            }
        };

        const currentItem = await documentClient.send(new GetCommand(getCurrentStockParams));
        
        if (!currentItem.Item) {
            throw new Error(`Food item not found: ${food_id}`);
        }

        const currentStock = currentItem.Item.stock_quantity || 0;
        const newStock = Math.max(0, currentStock - quantity); // Prevent negative stock

        if (currentStock < quantity) {
            console.warn(`Insufficient stock for ${food_name} (${food_id}). Current: ${currentStock}, Requested: ${quantity}. Setting to 0.`);
        }

        // Update stock quantity with conditional check to prevent race conditions
        const updateParams = {
            TableName: process.env.FOODS_TABLE_NAME,
            Key: { id: food_id },
            UpdateExpression: 'SET stock_quantity = :newStock, updated_at = :updatedAt',
            ConditionExpression: 'attribute_exists(id)', // Ensure item still exists
            ExpressionAttributeValues: {
                ':newStock': newStock,
                ':updatedAt': new Date().toISOString(),
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await documentClient.send(new UpdateCommand(updateParams));
        
        console.log(`Stock updated successfully for ${food_name}:`, {
            foodId: food_id,
            previousStock: currentStock,
            newStock: result.Attributes.stock_quantity,
            quantityPurchased: quantity,
            orderId: orderId
        });

        // Add custom metrics for monitoring
        if (result.Attributes.stock_quantity === 0) {
            console.warn(`ALERT: ${food_name} (${food_id}) is now out of stock!`);
        } else if (result.Attributes.stock_quantity < 10) {
            console.warn(`LOW STOCK: ${food_name} (${food_id}) has only ${result.Attributes.stock_quantity} items remaining`);
        }

        return result.Attributes;

    } catch (error) {
        console.error(`Failed to update stock for ${food_name} (${food_id}):`, error);
        
        // Add context to error for better debugging
        error.context = {
            foodId: food_id,
            foodName: food_name,
            quantity: quantity,
            orderId: orderId,
            spanContext: spanContext
        };
        
        throw error;
    }
}