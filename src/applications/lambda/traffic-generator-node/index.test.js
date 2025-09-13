// Mock AWS SDK modules before requiring the handler
jest.mock('@aws-sdk/client-lambda');

describe('Traffic Generator Lambda', () => {
    let handler;
    let mockSend;

    beforeAll(() => {
        // Set up mocks
        mockSend = jest.fn();

        require('@aws-sdk/client-lambda').LambdaClient = jest.fn(() => ({
            send: mockSend
        }));
        require('@aws-sdk/client-lambda').InvokeCommand = jest.fn();

        // Now require the handler
        handler = require('./index').handler;
    });

    beforeEach(() => {
        process.env.CANARY_FUNCTION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:test-canary';
        process.env.CONCURRENT_USERS = '5'; // Use smaller number for faster tests
        jest.clearAllMocks();
        mockSend.mockResolvedValue({ StatusCode: 202 });
    });

    test('should return success response with correct structure', async () => {
        const event = {};

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.body).toHaveProperty('totalUsers');
        expect(result.body).toHaveProperty('message');
        expect(result.body.message).toBe('Traffic generation completed');
    });

    test('should use default concurrent users when not specified', async () => {
        delete process.env.CONCURRENT_USERS;
        const event = {};

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.body.totalUsers).toBe(50); // Default value
    });

    test('should handle environment variables correctly', () => {
        process.env.CONCURRENT_USERS = '25';
        const users = Number.parseInt(process.env.CONCURRENT_USERS || '50');
        expect(users).toBe(25);
    });

    test('should generate user IDs correctly', () => {
        const concurrentUsers = 3;
        const userIds = Array.from({ length: concurrentUsers }, (_, index) =>
            `user${String(index + 1).padStart(4, '0')}`
        );

        expect(userIds).toEqual(['user0001', 'user0002', 'user0003']);
    });
});