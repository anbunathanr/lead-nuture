/**
 * crm.js — Frappe CRM integration module
 * Fetches, maps, scores, and syncs CRM leads with the local LeadFlow AI system.
 */

const http  = require('http');
const https = require('https');

/**
 * Minimal fetch-like wrapper using Node's http/https modules.
 * Avoids the automatic `Expect: 100-continue` header that Node 21's
 * built-in fetch adds for POST requests, which Frappe rejects with 417.
 */
function crmFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const bodyBuf  = body ? Buffer.from(body, 'utf8') : null;

    const reqHeaders = { ...headers };
    if (bodyBuf) reqHeaders['Content-Length'] = bodyBuf.length;
    // Do NOT set Expect header at all — Frappe rejects it with 417

    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          // set-cookie comes as array from Node http — join for compatibility
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
            json:       async () => JSON.parse(text),
            text:       async () => text,
          });
        });
      }
    );
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Session Management ────────────────────────────────────

let _cachedSid = null;
let _sessionInvalidated = false;

/**
 * Logs into Frappe CRM and caches the session ID.
 * Falls back to CRM_SID env var if login credentials not set.
 *
 * When the session has been explicitly invalidated via clearCrmSession() and
 * no credentials are available to obtain a fresh session, returns null instead
 * of the stale CRM_SID — ensuring the retry uses a different (null) cookie
 * rather than the same expired session ID.
 *
 * @returns {string|null} session ID or null if login failed
 */
async function getCrmSid() {
  // Return cached sid if available
  if (_cachedSid) return _cachedSid;

  const CRM_BASE_URL = process.env.CRM_BASE_URL;
  const CRM_USER     = process.env.CRM_USER;
  const CRM_PASSWORD = process.env.CRM_PASSWORD;

  // If session was explicitly invalidated and no credentials are available to
  // obtain a fresh session, return null (don't fall back to the stale CRM_SID).
  if (_sessionInvalidated && (!CRM_USER || !CRM_PASSWORD)) {
    _sessionInvalidated = false;
    return null;
  }
  _sessionInvalidated = false;

  // Fall back to static SID if no credentials provided
  if (!CRM_USER || !CRM_PASSWORD) {
    _cachedSid = process.env.CRM_SID || null;
    return _cachedSid;
  }

  try {
    const res = await crmFetch(`${CRM_BASE_URL}/api/method/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ usr: CRM_USER, pwd: CRM_PASSWORD }),
    });

    if (!res.ok) {
      console.error(`[CRM] Login failed: ${res.status} ${res.statusText}`);
      return null;
    }

    // Extract sid from Set-Cookie header
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/sid=([^;]+)/);
    if (match) {
      _cachedSid = match[1];
      console.log('[CRM] Login successful — session established');
      return _cachedSid;
    }

    console.error('[CRM] Login succeeded but no sid cookie in response');
    return null;
  } catch (err) {
    console.error(`[CRM] Login error: ${err.message}`);
    return null;
  }
}

/** Clears the cached session (forces re-login on next request) */
function clearCrmSession() {
  _cachedSid = null;
  _sessionInvalidated = true;
}

/** Returns headers for a CRM API request */
async function crmHeaders() {
  const sid = await getCrmSid();
  return {
    Cookie: `sid=${sid}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}


/**
 * Maps a Frappe CRM lead record to the internal lead schema.
 * Returns null if required fields (lead_name or email_id) are missing.
 *
 * @param {Object} crmRecord - Raw CRM lead record from Frappe API
 * @returns {Object|null} Internal lead object, or null if required fields missing
 */
function mapCrmLead(crmRecord) {
  // Support both 'email' (CRM app detail endpoint) and 'email_id' (legacy)
  const email = crmRecord?.email || crmRecord?.email_id || null;

  if (!crmRecord || !crmRecord.lead_name || !email) {
    console.warn('[CRM] Skipping record — missing lead_name or email', crmRecord?.name);
    return null;
  }

  return {
    crm_id:   crmRecord.name,
    name:     crmRecord.lead_name,
    email,
    phone:    crmRecord.mobile_no    || null,
    company:  crmRecord.organization || null,
    industry: crmRecord.source       || null,
    notes:    crmRecord.notes        || null,
    role:     'CRM Import',
    product:  crmRecord.organization || null,
  };
}

// ── Lead Scoring ──────────────────────────────────────────

/**
 * Computes a score and HOT/WARM/COLD classification for a CRM lead.
 * Pure function — no side effects.
 *
 * Scoring rules:
 *   status === "Interested" → +4
 *   status === "Replied"    → +3
 *   status === "New"        → +1
 *   source non-empty        → +1
 *   organization non-empty  → +1
 *
 * Thresholds: ≥7 → HOT, ≥3 → WARM, else COLD
 *
 * @param {Object} crmRecord - Raw CRM lead record
 * @returns {{ score: number, lead_status: string }}
 */
function scoreCrmLead(crmRecord) {
  let score = 0;

  if (crmRecord.status === 'Interested') score += 4;
  else if (crmRecord.status === 'Replied') score += 3;
  else if (crmRecord.status === 'New')     score += 1;

  if (crmRecord.source       && String(crmRecord.source).trim())       score += 1;
  if (crmRecord.organization && String(crmRecord.organization).trim()) score += 1;

  let lead_status;
  if (score >= 7)      lead_status = 'HOT';
  else if (score >= 3) lead_status = 'WARM';
  else                 lead_status = 'COLD';

  return { score, lead_status };
}

// ── CRM Health Check ──────────────────────────────────────

/**
 * Checks connectivity and authentication with the Frappe CRM API.
 *
 * @returns {{ ok: boolean, message: string, crm?: string }}
 */
async function checkCrmHealth() {
  const CRM_BASE_URL = process.env.CRM_BASE_URL;
  const hasConfig = CRM_BASE_URL && (
    (process.env.CRM_USER && process.env.CRM_PASSWORD) || process.env.CRM_SID
  );

  if (!hasConfig) {
    return { ok: false, message: 'CRM not configured' };
  }

  try {
    const headers = await crmHeaders();
    const res = await crmFetch(`${CRM_BASE_URL}/api/resource/CRM Lead?limit=1`, { headers });

    if (res.ok) {
      return { ok: true, message: 'ok', crm: CRM_BASE_URL };
    }
    // If 403/permission error, clear session and retry once
    if (res.status === 403 || res.status === 401) {
      clearCrmSession();
      const retryHeaders = await crmHeaders();
      const retry = await crmFetch(`${CRM_BASE_URL}/api/resource/CRM Lead?limit=1`, { headers: retryHeaders });
      if (retry.ok) return { ok: true, message: 'ok', crm: CRM_BASE_URL };
    }
    return { ok: false, message: `${res.status} ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── CRM Write-back ────────────────────────────────────────

/**
 * Writes the computed lead status back to the CRM record.
 * Never throws — errors are logged and treated as non-fatal.
 * Retries once with a fresh session on 401/403 (session expired).
 *
 * @param {string} crmId  - Frappe CRM Lead document name (e.g. "CRM-LEAD-2025-00004")
 * @param {string} status - HOT | WARM | COLD
 */
async function writeCrmStatus(crmId, status) {
  const CRM_BASE_URL = process.env.CRM_BASE_URL;

  // Map internal HOT/WARM/COLD to valid Frappe CRM status values
  const statusMap = { HOT: 'Interested', WARM: 'Replied', COLD: 'New' };
  const crmStatus = statusMap[status] || 'New';

  try {
    const headers = await crmHeaders();
    const res = await crmFetch(
      `${CRM_BASE_URL}/api/resource/CRM Lead/${encodeURIComponent(crmId)}`,
      { method: 'PUT', headers, body: JSON.stringify({ status: crmStatus }) }
    );
    if (res.ok) {
      console.log(`[CRM] Write-back OK — ${crmId} → ${status} (${crmStatus})`);
    } else if (res.status === 403 || res.status === 401) {
      clearCrmSession();
      const retryHeaders = await crmHeaders();
      const retry = await crmFetch(
        `${CRM_BASE_URL}/api/resource/CRM Lead/${encodeURIComponent(crmId)}`,
        { method: 'PUT', headers: retryHeaders, body: JSON.stringify({ status: crmStatus }) }
      );
      if (retry.ok) {
        console.log(`[CRM] Write-back OK (after session refresh) — ${crmId} → ${status} (${crmStatus})`);
      } else {
        console.error(`[CRM] Write-back failed after retry — ${crmId}: ${retry.status} ${retry.statusText}`);
      }
    } else {
      console.error(`[CRM] Write-back failed — ${crmId}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[CRM] Write-back error — ${crmId}: ${err.message}`);
  }
}

// ── Lead Polling ──────────────────────────────────────────

const CRM_FIELDS = ['name', 'status', 'organization', 'source'];

/**
 * Fetches a single CRM Lead document by name (returns all fields including email).
 */
async function fetchCrmLeadDoc(crmBaseUrl, name, headers) {
  const res = await crmFetch(
    `${crmBaseUrl}/api/resource/CRM%20Lead/${encodeURIComponent(name)}`,
    { headers }
  );
  if (!res.ok) {
    console.warn(`[CRM] Could not fetch doc ${name}: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.data || null;
}

/**
 * Fetches new CRM leads, scores them, stores them in PostgreSQL,
 * dispatches notifications, and writes status back to the CRM.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {{ processed: number, skipped: number, errors: number }}
 */
async function pollCrmLeads(pool) {
  const CRM_BASE_URL = process.env.CRM_BASE_URL;
  const hasConfig = CRM_BASE_URL && (
    (process.env.CRM_USER && process.env.CRM_PASSWORD) || process.env.CRM_SID
  );

  if (!hasConfig) {
    console.warn('[CRM] Polling skipped — CRM not configured');
    return { processed: 0, skipped: 0, errors: 0 };
  }

  const { dispatchAlerts } = require('./notifications');

  const params = new URLSearchParams({
    fields:  JSON.stringify(CRM_FIELDS),
    filters: JSON.stringify([['status', '=', 'New']]),
  });

  let records;
  try {
    let headers = await crmHeaders();
    let res = await crmFetch(`${CRM_BASE_URL}/api/resource/CRM Lead?${params}`, { headers });

    // Retry once on auth failure
    if (!res.ok && (res.status === 403 || res.status === 401)) {
      clearCrmSession();
      headers = await crmHeaders();
      res = await crmFetch(`${CRM_BASE_URL}/api/resource/CRM Lead?${params}`, { headers });
    }

    if (!res.ok) {
      console.error(`[CRM] Fetch failed: ${res.status} ${res.statusText}`);
      return { processed: 0, skipped: 0, errors: 1 };
    }

    const data = await res.json();
    const nameList = data.data || [];

    // Fetch full document for each lead to get email and mobile_no
    // (list API restricts email/notes fields; detail endpoint returns all fields)
    console.log(`[CRM] Fetching full details for ${nameList.length} leads...`);
    records = [];
    for (const item of nameList) {
      const doc = await fetchCrmLeadDoc(CRM_BASE_URL, item.name, headers);
      if (doc) records.push(doc);
    }
  } catch (err) {
    console.error(`[CRM] Network error during fetch: ${err.message}`);
    return { processed: 0, skipped: 0, errors: 1 };
  }

  let processed = 0, skipped = 0, errors = 0;

  for (const record of records) {
    try {
      // Map fields
      const lead = mapCrmLead(record);
      if (!lead) { skipped++; continue; }

      // Score
      const { score, lead_status } = scoreCrmLead(record);

      // Deduplication — skip if email already in DB
      const existing = await pool.query(
        'SELECT id FROM leads WHERE email = $1',
        [lead.email]
      );
      if (existing.rows.length > 0) { skipped++; continue; }

      // Insert into leads table
      const result = await pool.query(
        `INSERT INTO leads
           (name, email, phone, role, company, product, industry, notes, login_count, lead_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          lead.name, lead.email, lead.phone,
          lead.role, lead.company, lead.product,
          lead.industry, lead.notes,
          score, lead_status,
        ]
      );

      const storedLead = result.rows[0];
      const products   = lead.company || '';

      // Dispatch alerts and schedule follow-ups (non-blocking errors)
      await dispatchAlerts(storedLead, products, pool).catch(console.error);

      // Write status back to CRM
      await writeCrmStatus(lead.crm_id, lead_status);

      processed++;
    } catch (err) {
      console.error(`[CRM] Error processing record ${record?.name}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[CRM] Poll complete — processed:${processed} skipped:${skipped} errors:${errors}`);
  return { processed, skipped, errors };
}

module.exports = { mapCrmLead, scoreCrmLead, checkCrmHealth, pollCrmLeads, writeCrmStatus };
