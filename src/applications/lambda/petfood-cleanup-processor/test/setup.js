// Jest setup file for global test configuration

// Set default environment variables for tests
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.DYNAMODB_TABLE_NAME = 'test-table';
process.env.EVENT_SOURCE_NAME = 'test.cleanup.service';
process.env.MAX_RETRIES = '3';
process.env.RETRY_DELAY_MS = '100'; // Faster retries for tests

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

// Global test timeout
jest.setTimeout(10000);