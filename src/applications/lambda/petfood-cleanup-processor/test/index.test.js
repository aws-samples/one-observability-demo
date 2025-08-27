// Mock AWS SDK clients BEFORE importing the handler
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({
        send: mockS3Send
    })),
    DeleteObjectCommand: jest.fn(),
    HeadObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockReturnValue({
            send: mockDynamoSend
        })
    },
    DeleteCommand: jest.fn()
}));

const { handler } = require('../index');
const { S3Client, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

describe('Petfood Cleanup Processor Lambda', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockS3Send.mockReset();
        mockDynamoSend.mockReset();
        
        // Set environment variables
        process.env.S3_BUCKET_NAME = 'test-bucket';
        process.env.DYNAMODB_TABLE_NAME = 'test-table';
        process.env.AWS_REGION = 'us-east-1';
    });

    const createTestEvent = (overrides = {}) => ({
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ItemDiscontinued',
        source: 'petfood.service',
        account: '123456789012',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        detail: {
            event_type: 'ItemDiscontinued',
            food_id: 'test-food-123',
            food_name: null,
            pet_type: null,
            food_type: null,
            description: null,
            ingredients: null,
            status: 'discontinued',
            metadata: {
                cleanup_type: 'soft_delete',
                image_path: 'premium-puppy-chow.jpg',
                reason: 'cleanup_operation'
            },
            span_context: {
                trace_id: 'c5fb47bbf77e841964c5d52abfcd2c27',
                span_id: 'fa08a19935988e28',
                trace_flags: '01'
            },
            ...overrides
        }
    });

    const createLambdaContext = () => ({
        requestId: 'test-request-id',
        functionName: 'test-function',
        functionVersion: '1',
        getRemainingTimeInMillis: () => 30000
    });

    describe('Successful cleanup processing', () => {
        test('should process ItemDiscontinued event successfully with image deletion', async () => {
            // Setup mocks for successful execution
            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockResolvedValueOnce({}); // DeleteObject - successful deletion
            
            mockDynamoSend.mockResolvedValueOnce({
                Attributes: { id: 'test-food-123', status: 'discontinued' }
            });

            const event = createTestEvent();
            const context = createLambdaContext();

            const result = await handler(event, context);

            expect(result.statusCode).toBe(200);
            
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Cleanup processing completed successfully');
            expect(responseBody.foodId).toBe('test-food-123');
            expect(responseBody.cleanupSummary.s3ImageDeleted).toBe(true);
            expect(responseBody.cleanupSummary.databaseRecordDeleted).toBe(true);

            // Verify S3 calls
            expect(mockS3Send).toHaveBeenCalledTimes(2);
            expect(mockS3Send).toHaveBeenNthCalledWith(1, expect.any(HeadObjectCommand));
            expect(mockS3Send).toHaveBeenNthCalledWith(2, expect.any(DeleteObjectCommand));

            // Verify DynamoDB call
            expect(mockDynamoSend).toHaveBeenCalledTimes(1);
            expect(mockDynamoSend).toHaveBeenCalledWith(expect.any(DeleteCommand));
        });

        test('should process event successfully when image does not exist', async () => {
            // Setup mocks - image doesn't exist
            const notFoundError = new Error('Not Found');
            notFoundError.name = 'NotFound';
            notFoundError.$metadata = { httpStatusCode: 404 };
            
            mockS3Send.mockRejectedValueOnce(notFoundError); // HeadObject - image doesn't exist
            
            mockDynamoSend.mockResolvedValueOnce({
                Attributes: { id: 'test-food-123', status: 'discontinued' }
            });

            const event = createTestEvent();
            const context = createLambdaContext();

            const result = await handler(event, context);

            expect(result.statusCode).toBe(200);
            
            const responseBody = JSON.parse(result.body);
            expect(responseBody.cleanupSummary.s3ImageDeleted).toBe(false);
            expect(responseBody.cleanupSummary.databaseRecordDeleted).toBe(true);

            // Verify only HeadObject was called, not DeleteObject
            expect(mockS3Send).toHaveBeenCalledTimes(1);
            expect(mockS3Send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
        });

        test('should process event successfully without image path', async () => {
            // Setup event without image path
            const eventWithoutImage = createTestEvent();
            delete eventWithoutImage.detail.metadata.image_path;
            
            mockDynamoSend.mockResolvedValueOnce({
                Attributes: { id: 'test-food-123', status: 'discontinued' }
            });

            const context = createLambdaContext();

            const result = await handler(eventWithoutImage, context);

            expect(result.statusCode).toBe(200);
            
            const responseBody = JSON.parse(result.body);
            expect(responseBody.cleanupSummary.s3ImageDeleted).toBe(false);
            expect(responseBody.cleanupSummary.databaseRecordDeleted).toBe(true);

            // Verify no S3 calls were made
            expect(mockS3Send).not.toHaveBeenCalled();
        });

        test('should handle alternative event format with eventDetail', async () => {
            // Test the alternative event format we discovered in the logs
            const alternativeEvent = {
                source: 'petfood.service',
                'detail-type': 'ItemDiscontinued',
                eventDetail: {
                    event_type: 'ItemDiscontinued',
                    food_id: 'F689d8cdb',
                    food_name: null,
                    pet_type: null,
                    food_type: null,
                    description: null,
                    ingredients: null,
                    status: 'discontinued',
                    metadata: {
                        cleanup_type: 'soft_delete',
                        image_path: 'premium-puppy-chow.jpg',
                        reason: 'cleanup_operation'
                    },
                    span_context: {
                        trace_id: 'c5fb47bbf77e841964c5d52abfcd2c27',
                        span_id: 'fa08a19935988e28',
                        trace_flags: '01'
                    }
                }
            };

            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockResolvedValueOnce({}); // DeleteObject - successful deletion
            
            mockDynamoSend.mockResolvedValueOnce({
                Attributes: { id: 'F689d8cdb', status: 'discontinued' }
            });

            const context = createLambdaContext();

            const result = await handler(alternativeEvent, context);

            expect(result.statusCode).toBe(200);
            
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Cleanup processing completed successfully');
            expect(responseBody.foodId).toBe('F689d8cdb');
            expect(responseBody.cleanupSummary.s3ImageDeleted).toBe(true);
            expect(responseBody.cleanupSummary.databaseRecordDeleted).toBe(true);
        });
    });

    describe('Error handling', () => {
        test('should handle invalid event structure', async () => {
            const invalidEvent = {
                detail: {} // Missing required fields
            };
            const context = createLambdaContext();

            await expect(handler(invalidEvent, context)).rejects.toThrow(
                'Invalid event structure: missing required fields'
            );
        });

        test('should handle S3 deletion failure', async () => {
            // Setup mocks - image exists but deletion fails all retry attempts
            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockRejectedValue(new Error('S3 deletion failed')); // DeleteObject fails all retries

            const event = createTestEvent();
            const context = createLambdaContext();

            await expect(handler(event, context)).rejects.toThrow('S3 deletion failed');

            // Should have called S3 4 times (1 HeadObject + 3 DeleteObject retry attempts)
            expect(mockS3Send).toHaveBeenCalledTimes(4);
        });

        test('should handle DynamoDB delete failure', async () => {
            // Setup mocks - S3 succeeds but DynamoDB fails all retry attempts
            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockResolvedValueOnce({}); // DeleteObject - successful
            
            mockDynamoSend.mockRejectedValue(new Error('DynamoDB delete failed'));

            const event = createTestEvent();
            const context = createLambdaContext();

            await expect(handler(event, context)).rejects.toThrow('DynamoDB delete failed');
        });
    });

    describe('Retry logic', () => {
        test('should retry failed operations with exponential backoff', async () => {
            // Setup mocks - fail twice, then succeed
            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockRejectedValueOnce(new Error('Temporary failure'))
                .mockRejectedValueOnce(new Error('Temporary failure'))
                .mockResolvedValueOnce({}); // DeleteObject - finally succeeds
            
            mockDynamoSend.mockResolvedValueOnce({
                Attributes: { id: 'test-food-123', status: 'discontinued' }
            });

            const event = createTestEvent();
            const context = createLambdaContext();

            const result = await handler(event, context);

            expect(result.statusCode).toBe(200);
            
            // Should have called S3 4 times (1 HeadObject + 3 DeleteObject attempts)
            expect(mockS3Send).toHaveBeenCalledTimes(4);
        });

        test('should fail after max retries exceeded', async () => {
            // Setup mocks - always fail
            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject - image exists
                .mockRejectedValue(new Error('Persistent failure')); // DeleteObject always fails

            const event = createTestEvent();
            const context = createLambdaContext();

            await expect(handler(event, context)).rejects.toThrow('Persistent failure');

            // Should have called S3 4 times (1 HeadObject + 3 DeleteObject attempts)
            expect(mockS3Send).toHaveBeenCalledTimes(4);
        });
    });

    describe('Configuration', () => {
        test('should use environment variables for configuration', async () => {
            // Set custom environment variables
            process.env.S3_BUCKET_NAME = 'custom-bucket';
            process.env.DYNAMODB_TABLE_NAME = 'custom-table';
            process.env.MAX_RETRIES = '5';

            mockS3Send
                .mockResolvedValueOnce({}) // HeadObject
                .mockResolvedValueOnce({}); // DeleteObject
            mockDynamoSend.mockResolvedValue({
                Attributes: { id: 'test-food-123', status: 'discontinued' }
            });

            const event = createTestEvent();
            const context = createLambdaContext();

            await handler(event, context);

            // Verify calls were made (the actual command construction is handled by AWS SDK)
            expect(mockS3Send).toHaveBeenCalledTimes(2);
            expect(mockDynamoSend).toHaveBeenCalledTimes(1);
            
            // Verify the commands were constructed with the right constructors
            expect(HeadObjectCommand).toHaveBeenCalled();
            expect(DeleteObjectCommand).toHaveBeenCalled();
            expect(DeleteCommand).toHaveBeenCalled();
        });
    });
});