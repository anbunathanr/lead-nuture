// Test setup file
require('dotenv').config({ path: '.env.test' });

// Global test configuration
global.console = {
  ...console,
  // Suppress console.log during tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'lead_nurturing_test';
process.env.LOG_LEVEL = 'error';

// Global test timeout
jest.setTimeout(10000);

// Simple test to prevent Jest from complaining about empty test suite
describe('Test Setup', () => {
  test('should configure test environment', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DB_NAME).toBe('lead_nurturing_test');
  });
});