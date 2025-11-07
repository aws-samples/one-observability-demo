/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Test script to validate the Lambda function with the real EventBridge event structure
 * This can be run manually to test the function logic
 */

// Mock the AWS SDK for testing
const mockDynamoDBResponses = new Map();

// Simple mock implementation
const mockDocumentClient = {
    send: async (command) => {
        const commandName = command.constructor.name;
        console.log(`Mock DynamoDB ${commandName}:`, command.input);

        if (commandName === 'GetCommand') {
            const foodId = command.input.Key.id;
            return mockDynamoDBResponses.get(`get-${foodId}`) || { Item: undefined };
        } else if (commandName === 'UpdateCommand') {
            const foodId = command.input.Key.id;
            const newStock = command.input.ExpressionAttributeValues[':newStock'];
            return {
                Attributes: {
                    id: foodId,
                    stock_quantity: newStock,
                    name: `Test Food ${foodId}`,
                },
            };
        }

        throw new Error(`Unknown command: ${commandName}`);
    },
};

// Mock the modules
jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
}));

jest.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn(() => mockDocumentClient),
    },
    GetCommand: class GetCommand {
        constructor(input) {
            this.input = input;
        }
    },
    UpdateCommand: class UpdateCommand {
        constructor(input) {
            this.input = input;
        }
    },
}));

// No X-Ray SDK mocking needed - using Application Signals auto-instrumentation

// Set environment variables
process.env.FOODS_TABLE_NAME = 'test-foods-table';

// Now require the handler
const { handler } = require('./index');

// Real EventBridge event structure from your log
const realEvent = {
    version: '0',
    id: 'f296836c-e45d-8092-d7b8-2a5e353ffcf5',
    'detail-type': 'StockPurchased',
    source: 'petfood.service',
    account: '339743103717',
    time: '2025-11-05T13:44:58Z',
    region: 'us-east-1',
    resources: ['food/Fecd30d31', 'food/F3e40f637', 'food/F233c473c'],
    detail: {
        event_type: 'StockPurchased',
        order_id: 'ORDER-USER3820-1762350298',
        user_id: 'user3820',
        items: [
            {
                food_id: 'Fecd30d31',
                food_name: 'Beef and Turkey Kibbles',
                quantity: 1,
                unit_price: '12.99',
                total_price: '12.99',
            },
            {
                food_id: 'F3e40f637',
                food_name: 'Puppy Training Treats',
                quantity: 1,
                unit_price: '8.99',
                total_price: '8.99',
            },
            {
                food_id: 'F233c473c',
                food_name: 'Raw Chicken Bites',
                quantity: 1,
                unit_price: '10.99',
                total_price: '10.99',
            },
        ],
        total_amount: '40.6076',
        metadata: {
            requires_stock_reduction: 'true',
            user_id: 'user3820',
            order_id: 'ORDER-USER3820-1762350298',
            item_count: '3',
            processing_type: 'async',
        },
        span_context: {
            trace_id: '9848b52450f811af19bc742b40e6b6fa',
            span_id: '457333a09fb33944',
            trace_flags: '01',
        },
    },
};

async function testWithRealEvent() {
    console.log('Testing Stock Processor with real EventBridge event...\n');

    // Set up mock responses for the food items
    mockDynamoDBResponses.set('get-Fecd30d31', {
        Item: { id: 'Fecd30d31', name: 'Beef and Turkey Kibbles', stock_quantity: 15 },
    });
    mockDynamoDBResponses.set('get-F3e40f637', {
        Item: { id: 'F3e40f637', name: 'Puppy Training Treats', stock_quantity: 8 },
    });
    mockDynamoDBResponses.set('get-F233c473c', {
        Item: { id: 'F233c473c', name: 'Raw Chicken Bites', stock_quantity: 12 },
    });

    try {
        const result = await handler(realEvent);

        console.log('\n✅ Test Result:');
        console.log('Status Code:', result.statusCode);
        console.log('Response Body:', JSON.parse(result.body));

        if (result.statusCode === 200) {
            console.log('\n🎉 SUCCESS: Lambda function processed the real event correctly!');
        } else {
            console.log('\n❌ FAILURE: Unexpected status code');
        }
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    // eslint-disable-next-line unicorn/prefer-top-level-await
    testWithRealEvent().catch((error) => {
        console.error(error);
        throw error;
    });
}

module.exports = { testWithRealEvent, realEvent };
