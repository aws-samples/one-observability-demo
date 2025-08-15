/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { handler } from '../index.js';

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
    SecretsManager: jest.fn(() => ({
        getSecretValue: jest.fn(() => ({
            promise: jest.fn(() =>
                Promise.resolve({
                    SecretString: JSON.stringify({
                        host: 'localhost',
                        port: 5432,
                        dbname: 'testdb',
                        username: 'testuser',
                        password: 'testpass' //pragma: allowlist secret
                    })
                })
            )
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

describe('PetHistory Lambda Function', () => {
    beforeEach(() => {
        process.env.RDS_SECRET_ARN =
            'arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret';
        process.env.AWS_REGION = 'us-west-2';

        // Clear the module cache to ensure fresh environment variables
        jest.resetModules();
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Clean up environment variables
        delete process.env.RDS_SECRET_ARN;
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

        expect(result.batchItemFailures).toEqual([]);
        expect(result.processedCount).toBe(1);
        expect(result.results[0].status).toBe('success');
        expect(result.results[0].messageId).toBe('test-message-id');
    });

    test('should handle invalid JSON message with batch failure', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: 'invalid json'
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'test-message-id' }]);
        expect(result.processedCount).toBe(0);
        expect(result.results).toHaveLength(0);
    });

    test('should handle message with invalid schema with batch failure', async () => {
        const event = {
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle: 'test-receipt-handle',
                    body: JSON.stringify({
                        transactionId: 'invalid-uuid',
                        petId: 'pet123'
                        // Missing required fields
                    })
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'test-message-id' }]);
        expect(result.processedCount).toBe(0);
        expect(result.results).toHaveLength(0);
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

        expect(result.batchItemFailures).toEqual([]);
        expect(result.processedCount).toBe(2);
        expect(result.results).toHaveLength(2);
        expect(result.results[0].status).toBe('success');
        expect(result.results[1].status).toBe('success');
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

        expect(result.batchItemFailures).toEqual([]);
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

        expect(result.batchItemFailures).toEqual([]);
        expect(result.processedCount).toBe(0);
        expect(result.results).toHaveLength(0);
    });

    test('should handle mixed success and failure messages', async () => {
        const event = {
            Records: [
                {
                    messageId: 'success-message',
                    receiptHandle: 'test-receipt-handle-1',
                    body: JSON.stringify({
                        transactionId: '123e4567-e89b-12d3-a456-426614174000',
                        petId: 'pet123',
                        petType: 'dog',
                        userId: 'user456',
                        adoptionDate: '2025-08-08T10:30:00Z',
                        timestamp: '2025-08-08T10:30:00Z'
                    })
                },
                {
                    messageId: 'failure-message',
                    receiptHandle: 'test-receipt-handle-2',
                    body: 'invalid json'
                },
                {
                    messageId: 'another-success-message',
                    receiptHandle: 'test-receipt-handle-3',
                    body: JSON.stringify({
                        transactionId: '456e7890-e89b-12d3-a456-426614174001',
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

        expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'failure-message' }]);
        expect(result.processedCount).toBe(2);
        expect(result.results).toHaveLength(2);
        expect(result.results[0].messageId).toBe('success-message');
        expect(result.results[0].status).toBe('success');
        expect(result.results[1].messageId).toBe('another-success-message');
        expect(result.results[1].status).toBe('success');
    });

    test('should handle all messages failing', async () => {
        const event = {
            Records: [
                {
                    messageId: 'failure-message-1',
                    receiptHandle: 'test-receipt-handle-1',
                    body: 'invalid json 1'
                },
                {
                    messageId: 'failure-message-2',
                    receiptHandle: 'test-receipt-handle-2',
                    body: 'invalid json 2'
                }
            ]
        };

        const result = await handler(event, {});

        expect(result.batchItemFailures).toEqual([
            { itemIdentifier: 'failure-message-1' },
            { itemIdentifier: 'failure-message-2' }
        ]);
        expect(result.processedCount).toBe(0);
        expect(result.results).toHaveLength(0);
    });

    test('should return correct response format for SQS batch processing', async () => {
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

        // Verify the response has the correct structure for SQS batch processing
        expect(result).toHaveProperty('batchItemFailures');
        expect(result).toHaveProperty('processedCount');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.batchItemFailures)).toBe(true);
        expect(Array.isArray(result.results)).toBe(true);
        expect(typeof result.processedCount).toBe('number');
    });
});
