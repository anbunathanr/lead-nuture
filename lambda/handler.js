/**
 * lambda/handler.js — AWS Lambda handler
 *
 * Deployed behind API Gateway. Handles:
 *   GET /api/crm/leads   → returns lead stats for dashboard
 *   GET /api/crm/health  → CRM connectivity check
 *
 * Environment variables (set in Lambda console or via AWS Secrets Manager):
 *   CRM_BASE_URL   — e.g. http://34.196.221.16:8000
 *   CRM_USER       — Frappe login email
 *   CRM_PASSWORD   — Frappe login password
 */

const { checkCrmHealth, getCrmLeadsWithStats } = require('../crm');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  const path   = event.path || event.rawPath || '/';
  const method = (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') return response(200, {});

  try {
    if (path === '/api/crm/leads' && method === 'GET') {
      const data = await getCrmLeadsWithStats();
      return response(200, data);
    }

    if (path === '/api/crm/health' && method === 'GET') {
      const health = await checkCrmHealth();
      return health.ok
        ? response(200, { status: 'ok', crm: health.crm })
        : response(503, { status: 'error', message: health.message });
    }

    return response(404, { error: 'Not found' });
  } catch (err) {
    console.error('[Lambda] Error:', err.message);
    return response(500, { error: err.message });
  }
};
