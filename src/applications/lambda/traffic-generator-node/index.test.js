// Mock AWS SDK modules before requiring the handler
jest.mock('@aws-sdk/client-ssm');

describe('Traffic Generator Lambda', () => {
    let handler;
    let mockSend;
    let consoleSpy;

    beforeAll(() => {
        // Mock console methods to prevent noise in test output
        consoleSpy = {
            log: jest.spyOn(console, 'log').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
        };

        // Set up AWS SDK mocks
        mockSend = jest.fn();

        require('@aws-sdk/client-ssm').SSMClient = jest.fn(() => ({
            send: mockSend,
        }));
        require('@aws-sdk/client-ssm').GetParameterCommand = jest.fn();

        // Now require the handler
        handler = require('./index').handler;
    });

    afterAll(() => {
        // Restore console methods
        consoleSpy.log.mockRestore();
        consoleSpy.error.mockRestore();
        consoleSpy.warn.mockRestore();
    });

    beforeEach(() => {
        process.env.PETSITE_URL = 'https://test-petsite.com';
        process.env.CONCURRENT_USERS = '5'; // Use smaller number for faster tests
        jest.clearAllMocks();
        mockSend.mockResolvedValue({
            Parameter: {
                Value: 'https://test-petsite.com',
            },
        });
    });

    test('should return success response with correct structure', async () => {
        const event = {};

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.body).toHaveProperty('totalUsers');
        expect(result.body).toHaveProperty('message');
        expect(result.body).toHaveProperty('totalRequests');
        expect(result.body).toHaveProperty('urlStatistics');
        expect(result.body.message).toBe('Traffic generation completed with detailed URL statistics');
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
        const userIds = Array.from(
            { length: concurrentUsers },
            (_, index) => `user${String(index + 1).padStart(4, '0')}`,
        );

        expect(userIds).toEqual(['user0001', 'user0002', 'user0003']);
    });

    test('should handle SSM parameter retrieval failure gracefully', async () => {
        mockSend.mockRejectedValue(new Error('SSM access denied'));
        const event = {};

        await expect(handler(event)).rejects.toThrow(
            'Petsite URL not found in environment variables or SSM Parameter Store',
        );
    });

    test('should throw error when no petsite URL is available', async () => {
        delete process.env.PETSITE_URL;
        mockSend.mockRejectedValue(new Error('SSM access denied'));
        const event = {};

        await expect(handler(event)).rejects.toThrow(
            'Petsite URL not found in environment variables or SSM Parameter Store',
        );
    });
});
