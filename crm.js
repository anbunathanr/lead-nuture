/**
 * crm.js — Frappe CRM integration module
 * Fetches, maps, scores, and syncs CRM leads with the local LeadFlow AI system.
 */

// ── Field Mapping ─────────────────────────────────────────

/**
 * Maps a Frappe CRM lead record to the internal lead schema.
 * Returns null if required fields (lead_name or email_id) are missing.
 *
 * @param {Object} crmRecord - Raw CRM lead record from Frappe API
 * @returns {Object|null} Internal lead object, or null if required fields missing
 */
function mapCrmLead(crmRecord) {
  if (!crmRecord || !crmRecord.lead_name || !crmRecord.email_id) {
    console.warn('[CRM] Skipping record — missing lead_name or email_id', crmRecord?.name);
    return null;
  }

  return {
    crm_id:   crmRecord.name,                  // CRM doc ID for write-back
    name:     crmRecord.lead_name,
    email:    crmRecord.email_id,
    phone:    crmRecord.mobile_no   || null,
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
  const CRM_SID      = process.env.CRM_SID;

  if (!CRM_BASE_URL || !CRM_SID) {
    return { ok: false, message: 'CRM not configured' };
  }

  try {
    const res = await fetch(
      `${CRM_BASE_URL}/api/resource/CRM Lead?limit=1`,
      { headers: { Cookie: `sid=${CRM_SID}`, Expect: '' } }
    );

    if (res.ok) {
      return { ok: true, message: 'ok', crm: CRM_BASE_URL };
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
 *
 * @param {string} crmId  - Frappe CRM Lead document name (e.g. "CRM-LEAD-2025-00004")
 * @param {string} status - HOT | WARM | COLD
 */
async function writeCrmStatus(crmId, status) {
  const CRM_BASE_URL = process.env.CRM_BASE_URL;
  const CRM_SID      = process.env.CRM_SID;

  try {
    const res = await fetch(
      `${CRM_BASE_URL}/api/resource/CRM Lead/${encodeURIComponent(crmId)}`,
      {
        method:  'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `sid=${CRM_SID}`,
        },
        body: JSON.stringify({ status }),
      }
    );

    if (res.ok) {
      console.log(`[CRM] Write-back OK — ${crmId} → ${status}`);
    } else {
      console.error(`[CRM] Write-back failed — ${crmId}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[CRM] Write-back error — ${crmId}: ${err.message}`);
  }
}

// ── Lead Polling ──────────────────────────────────────────

const CRM_FIELDS = [
  'name', 'lead_name', 'email_id', 'mobile_no',
  'status', 'organization', 'source', 'notes',
];

/**
 * Fetches new CRM leads, scores them, stores them in PostgreSQL,
 * dispatches notifications, and writes status back to the CRM.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {{ processed: number, skipped: number, errors: number }}
 */
async function pollCrmLeads(pool) {
  const CRM_BASE_URL = process.env.CRM_BASE_URL;
  const CRM_SID      = process.env.CRM_SID;

  if (!CRM_BASE_URL || !CRM_SID) {
    console.warn('[CRM] Polling skipped — CRM_BASE_URL or CRM_SID not set');
    return { processed: 0, skipped: 0, errors: 0 };
  }

  const { dispatchAlerts, scheduleFollowups } = require('./notifications');

  const params = new URLSearchParams({
    fields:  JSON.stringify(CRM_FIELDS),
    filters: JSON.stringify([['status', '=', 'New']]),
  });

  let records;
  try {
    const res = await fetch(
      `${CRM_BASE_URL}/api/resource/CRM Lead?${params}`,
      { headers: { Cookie: `sid=${CRM_SID}`, Expect: '' } }
    );

    if (!res.ok) {
      console.error(`[CRM] Fetch failed: ${res.status} ${res.statusText}`);
      return { processed: 0, skipped: 0, errors: 1 };
    }

    const data = await res.json();
    records = data.data || [];
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
      await scheduleFollowups(pool, storedLead, products).catch(console.error);

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
