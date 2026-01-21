const request = require('supertest');
const app = require('../index');

describe('Project Setup Tests', () => {
  test('Express app should be defined', () => {
    expect(app).toBeDefined();
  });

  test('Health endpoint should return 200', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
  });

  test('Root endpoint should return API info', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);

    expect(response.body).toHaveProperty('message', 'Lead Nurturing Automation API');
    expect(response.body).toHaveProperty('version', '1.0.0');
    expect(response.body).toHaveProperty('status', 'running');
  });

  test('404 handler should work', async () => {
    const response = await request(app)
      .get('/nonexistent')
      .expect(404);

    expect(response.body).toHaveProperty('error', 'Not found');
  });
});

describe('Environment Configuration', () => {
  test('Environment variables should be loaded', () => {
    expect(process.env.NODE_ENV).toBeDefined();
    expect(process.env.DB_HOST).toBeDefined();
    expect(process.env.DB_NAME).toBeDefined();
  });
});

describe('Logger Configuration', () => {
  test('Logger should be available', () => {
    const logger = require('../utils/logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});

describe('Database Configuration', () => {
  test('Database config should be available', () => {
    const { connectDatabase, getPool, query, transaction } = require('../config/database');
    expect(connectDatabase).toBeDefined();
    expect(getPool).toBeDefined();
    expect(query).toBeDefined();
    expect(transaction).toBeDefined();
  });
});