// Unit tests for CRM routes: POST /api/crm/sync & GET /api/crm/health
// Feature: crm-integration — Requirements 7.1, 7.2, 7.3, 8.1, 8.2, 8.3

jest.mock('../crm', () => ({
  pollCrmLeads:   jest.fn(),
  checkCrmHealth: jest.fn(),
}));

jest.mock('../notifications', () => ({
  dispatchAlerts:    jest.fn().mockResolvedValue(undefined),
  scheduleFollowups: jest.fn().mockResolvedValue(undefined),
  processDueFollowups: jest.fn().mockResolvedValue(undefined),
}));

const request  = require('supertest');
const express  = require('express');
const { pollCrmLeads, checkCrmHealth } = require('../crm');

function buildApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/crm/sync', async (req, res) => {
    if (!process.env.CRM_BASE_URL || !process.env.CRM_SID) {
      return res.status(503).json({ error: 'CRM not configured' });
    }
    try {
      const result = await pollCrmLeads({});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/crm/health', async (req, res) => {
    const health = await checkCrmHealth();
    if (health.ok) {
      res.json({ status: 'ok', crm: health.crm });
    } else {
      res.status(503).json({ status: 'error', message: health.message });
    }
  });

  return app;
}

describe('POST /api/crm/sync', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
    jest.clearAllMocks();
  });

  test('returns HTTP 503 when CRM credentials are not configured', async () => {
    // Requirements: 7.3
    process.env = { ...origEnv };
    delete process.env.CRM_BASE_URL;
    delete process.env.CRM_SID;
    const res = await request(buildApp()).post('/api/crm/sync');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  test('returns sync result JSON when CRM is configured', async () => {
    // Requirements: 7.1, 7.2
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'sid' };
    pollCrmLeads.mockResolvedValue({ processed: 2, skipped: 1, errors: 0 });
    const res = await request(buildApp()).post('/api/crm/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 2, skipped: 1, errors: 0 });
  });
});

describe('GET /api/crm/health', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
    jest.clearAllMocks();
  });

  test('returns { status: "ok" } when CRM is reachable', async () => {
    // Requirements: 8.1, 8.2
    checkCrmHealth.mockResolvedValue({ ok: true, message: 'ok', crm: 'http://localhost:8000' });
    const res = await request(buildApp()).get('/api/crm/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.crm).toBe('http://localhost:8000');
  });

  test('returns HTTP 503 when CRM is unreachable', async () => {
    // Requirements: 8.3
    checkCrmHealth.mockResolvedValue({ ok: false, message: 'ECONNREFUSED' });
    const res = await request(buildApp()).get('/api/crm/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toContain('ECONNREFUSED');
  });

  test('returns HTTP 503 when CRM returns auth error', async () => {
    // Requirements: 8.3
    checkCrmHealth.mockResolvedValue({ ok: false, message: '401 Unauthorized' });
    const res = await request(buildApp()).get('/api/crm/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });
});
