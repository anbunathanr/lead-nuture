/**
 * crm.js — Frappe CRM integration
 * Used by the Lambda handler to fetch lead stats for the dashboard.
 */

const http  = require('http');
const https = require('https');

/**
 * Minimal fetch wrapper using Node's http/https.
 * Avoids the automatic Expect: 100-continue header that Frappe rejects with 417.
 */
function crmFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const bodyBuf = body ? Buffer.from(body, 'utf8') : null;

    const reqHeaders = { ...headers };
    if (bodyBuf) reqHeaders['Content-Length'] = bodyBuf.length;

    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const rawHeaders = res.headers;
          resolve({
            ok:         res.statusCode >= 200 && res.statusCode < 300,
            status:     res.statusCode,
            statusText: res.statusMessage,
            headers:    {
              get: (k) => {
                const val = rawHeaders[k.toLowerCase()];
                if (!val) return null;
                return Array.isArray(val) ? val.join(', ') : val;
              },
            },
            json:  async () => JSON.parse(text),
            text:  async () => text,
          });
        });
      }
    );
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Session ───────────────────────────────────────────────

let _cachedSid = null;

async function getCrmSid() {
  if (_cachedSid) return _cachedSid;

  const base = process.env.CRM_BASE_URL;
  const user = process.env.CRM_USER;
  const pass = process.env.CRM_PASSWORD;

  if (!user || !pass) {
    _cachedSid = process.env.CRM_SID || null;
    return _cachedSid;
  }

  const res = await crmFetch(`${base}/api/method/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usr: user, pwd: pass }),
  });

  if (!res.ok) throw new Error(`CRM login failed: ${res.status}`);

  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/sid=([^;,]+)/);
  if (!match) throw new Error('CRM login succeeded but no sid in Set-Cookie');

  _cachedSid = match[1];
  return _cachedSid;
}

function clearSession() {
  _cachedSid = null;
}

async function crmHeaders() {
  const sid = await getCrmSid();
  return { Cookie: `sid=${sid}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

// ── Health Check ──────────────────────────────────────────

async function checkCrmHealth() {
  const base = process.env.CRM_BASE_URL;
  if (!base) return { ok: false, message: 'CRM_BASE_URL not set' };

  try {
    const headers = await crmHeaders();
    const res = await crmFetch(`${base}/api/resource/CRM Lead?limit=1`, { headers });
    if (res.ok) return { ok: true, crm: base };
    if (res.status === 401 || res.status === 403) {
      clearSession();
      const retryHeaders = await crmHeaders();
      const retry = await crmFetch(`${base}/api/resource/CRM Lead?limit=1`, { headers: retryHeaders });
      if (retry.ok) return { ok: true, crm: base };
    }
    return { ok: false, message: `${res.status} ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── Lead Stats for Dashboard ──────────────────────────────

async function getCrmLeadsWithStats() {
  const base = process.env.CRM_BASE_URL;

  const params = new URLSearchParams({
    fields: JSON.stringify(['name','lead_name','first_name','email','mobile_no','status','organization','creation']),
    limit: '500',
    order_by: 'creation desc',
  });

  let headers = await crmHeaders();
  let res = await crmFetch(`${base}/api/resource/CRM Lead?${params}`, { headers });

  if (!res.ok && (res.status === 401 || res.status === 403)) {
    clearSession();
    headers = await crmHeaders();
    res = await crmFetch(`${base}/api/resource/CRM Lead?${params}`, { headers });
  }

  if (!res.ok) throw new Error(`CRM fetch failed: ${res.status}`);

  const data  = await res.json();
  const leads = data.data || [];

  return {
    leads,
    stats: {
      total:     leads.length,
      contacted: leads.filter(l => l.status === 'Contacted').length,
      pending:   leads.filter(l => l.status === 'New').length,
      no_email:  leads.filter(l => !l.email || !l.email.includes('@')).length,
    },
  };
}

module.exports = { checkCrmHealth, getCrmLeadsWithStats };
