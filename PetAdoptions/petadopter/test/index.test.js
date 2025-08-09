const { handler } = require('../index');

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
    SecretsManager: jest.fn(() => ({
        getSecretValue: jest.fn(() => ({
            promise: jest.fn(() => Promise.resolve({
                SecretString: JSON.stringify({
                    host: 'localhost',
                    port: 5432,
                    dbname: 'testdb',
                    username: 'testuser',
                    password: 'testpass'
                })
            }))
        }))
    }))
}));

// No X-Ray mocking needed - using CloudWatch Application Signals auto-instrumentation

// Mock pg
jest.mock('pg', () => ({
    Client: jest.fn(() => ({
        connect: jest.fn(() => Promise.resolve()),
        query: jest.fn(() => Promise.resolve({ rowCount: 1, rows: [] })),
        end: jest.fn(() => Promise.resolve())
    }))
}));

// Mock https
jest.mock('https', () => ({
    request: jest.fn((_url, _options, callback) => {
        const mockResponse = {
            statusCode: 200,
            on: jest.fn((event, handler) => {
                if (event === 'data') {
                    handler('{"success": true}');
                } else if (event === 'end') {
                    handler();
                }
            })
        };

        // Call the callback immediately to simulate successful response
        setTimeout(() => callback(mockResponse), 0);

        return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
        };
    })
}));

describe('PetAdopter Lambda Function', () => {
    beforeEach(() => {
        process.env.RDS_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret';
        process.env.UPDATE_ADOPTION_URL = 'https://api.example.com/update-pet-status';
        process.env.AWS_REGION = 'us-west-2';

        // Clear the module cache to ensure fresh environment variables
        jest.resetModules();
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Clean up environment variables
        delete process.env.RDS_SECRET_ARN;
        delete process.env.UPDATE_ADOPTION_URL;
        delete process.env.AWS_REGION;
    });

    test('should process valid adoption message successfully', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: JSON.stringify({
                        transactionId: '123e4567-e89b-12d3-a456-426614174000',
                        petId: 'pet123',
                        petType: 'dog',
                        userId: 'user456',
                        adoptionDate: '2025-08-08T10:30:00Z',
                        timestamp: '2025-08-08T10:30:00Z'
                    })
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.statusCode).toBe(200);
        expect(result.processedCount).toBe(1);
        expect(result.results[0].status).toBe('success');
    });

    test('should reject invalid JSON message', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: 'invalid json'
                }
            ]
        };

        await expect(handler(event, {})).rejects.toThrow('Invalid JSON');
    });

    test('should reject message with invalid schema', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: JSON.stringify({
                        transactionId: 'invalid-uuid',
                        petId: 'pet123',
                        // Missing required fields
                    })
                }
            ]
        };

        await expect(handler(event, {})).rejects.toThrow('Schema validation failed');
    });

    test('should process multiple messages', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id-1',
                    receiptHandle: 'test-receipt-handle-1',
                    body: JSON.stringify({
                        transactionId: '123e4567-e89b-12d3-a456-426614174001',
                        petId: 'pet123',
                        petType: 'dog',
                        userId: 'user456',
                        adoptionDate: '2025-08-08T10:30:00Z',
                        timestamp: '2025-08-08T10:30:00Z'
                    })
                },
                {
                    messageId: 'test-message-id-2',
                    receiptHandle: 'test-receipt-handle-2',
                    body: JSON.stringify({
                        transactionId: '123e4567-e89b-12d3-a456-426614174002',
                        petId: 'pet456',
                        petType: 'cat',
                        userId: 'user789',
                        adoptionDate: '2025-08-08T11:30:00Z',
                        timestamp: '2025-08-08T11:30:00Z'
                    })
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.statusCode).toBe(200);
        expect(result.processedCount).toBe(2);
        expect(result.results).toHaveLength(2);
    });

    test('should validate message structure correctly', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: JSON.stringify({
                        transactionId: '123e4567-e89b-12d3-a456-426614174000',
                        petId: 'pet123',
                        petType: 'dog',
                        userId: 'user456',
                        adoptionDate: '2025-08-08T10:30:00Z',
                        timestamp: '2025-08-08T10:30:00Z'
                    })
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.statusCode).toBe(200);
        expect(result.processedCount).toBe(1);
        expect(result.results[0].transactionId).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect(result.results[0].messageId).toBe('test-message-id');
        expect(result.results[0].status).toBe('success');
    });

    test('should handle empty records array', async () => {
        const event = {
            Records: []
        };

        const result = await handler(event, {});

        expect(result.statusCode).toBe(200);
        expect(result.processedCount).toBe(0);
        expect(result.results).toHaveLength(0);
    });
});