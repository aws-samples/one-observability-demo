// Mock AWS SDK modules before requiring the handler
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('aws-xray-sdk-core');

describe('Pet Status Updater Lambda', () => {
    let handler;

    beforeAll(() => {
        // Set up mocks
        const mockSend = jest.fn().mockResolvedValue({});
        const mockDocumentClient = { send: mockSend };

        require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient = {
            from: jest.fn(() => mockDocumentClient)
        };
        require('@aws-sdk/lib-dynamodb').UpdateCommand = jest.fn();
        require('@aws-sdk/client-dynamodb').DynamoDBClient = jest.fn();
        require('aws-xray-sdk-core').captureAWSv3Client = jest.fn(client => client);

        // Now require the handler
        handler = require('./index').handler;
    });

    beforeEach(() => {
        process.env.TABLE_NAME = 'test-table';
        jest.clearAllMocks();
    });

    test('should return success response', async () => {
        const event = {
            body: JSON.stringify({
                pettype: 'dog',
                petid: '123',
                petavailability: 'available'
            })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('success');
    });

    test('should handle missing petavailability', async () => {
        const event = {
            body: JSON.stringify({
                pettype: 'cat',
                petid: '456'
            })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('success');
    });

    test('should parse JSON payload correctly', () => {
        const testPayload = {
            pettype: 'rabbit',
            petid: '789',
            petavailability: 'yes'
        };

        const parsed = JSON.parse(JSON.stringify(testPayload));
        expect(parsed.pettype).toBe('rabbit');
        expect(parsed.petid).toBe('789');
        expect(parsed.petavailability).toBe('yes');
    });
});