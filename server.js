require('dotenv').config();
const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const path     = require('path');
const { dispatchAlerts, processDueFollowups } = require('./notifications');
const { pollCrmLeads, checkCrmHealth } = require('./crm');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'lead_nurturing',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
});

// ── Lead Scoring ──────────────────────────────────────────
function calcEngagement({ plan_type, urgency, budget, products_count }) {
  let score = 0;
  if (plan_type === 'paid')    score += 4;
  if (plan_type === 'free')    score += 1;
  if (urgency === 'immediate') score += 3;
  if (urgency === 'month')     score += 2;
  if (budget === 'yes')        score += 2;
  if (budget === 'maybe')      score += 1;
  score += Math.min(parseInt(products_count) || 0, 1);
  return score;
}

function scoreLead(score) {
  if (score >= 7) return 'HOT';
  if (score >= 3) return 'WARM';
  return 'COLD';
}

// ── n8n Webhook ───────────────────────────────────────────
async function triggerN8n(lead) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(lead),
  });
}

// ── Routes ────────────────────────────────────────────────

app.post('/api/leads', async (req, res) => {
  const {
    name, email, phone, role, company,
    products_interested, plan_type, urgency, budget, industry, notes, goal
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const productsArr = Array.isArray(products_interested)
    ? products_interested
    : (products_interested ? String(products_interested).split(',') : []);
  const productStr = productsArr.join(', ');

  const score       = calcEngagement({ plan_type, urgency, budget, products_count: productsArr.length });
  const lead_status = scoreLead(score);

  try {
    const result = await pool.query(
      `INSERT INTO leads
         (name, email, phone, role, company, product, industry, goal, notes, login_count, lead_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (email) DO UPDATE SET
         name=$1, phone=$3, role=$4, company=$5, product=$6,
         industry=$7, goal=$8, notes=$9, login_count=$10,
         lead_status=$11, updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [name, email, phone||null, role||null, company||null,
       productStr||null, industry||null, goal||null,
       notes||null, score, lead_status]
    );

    const lead = result.rows[0];
    console.log(`\n[${lead.lead_status}] score:${score} | ${lead.name} <${lead.email}>`);

    // Fire alerts + schedule follow-ups (non-blocking)
    dispatchAlerts(lead, productStr, pool).catch(console.error);
    triggerN8n(lead).catch(() => {});

    res.json({ success: true, lead });
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/leads', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE lead_status = 'HOT')    AS hot,
        COUNT(*) FILTER (WHERE lead_status = 'WARM')   AS warm,
        COUNT(*) FILTER (WHERE lead_status = 'COLD')   AS cold
      FROM leads
    `);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Follow-ups status endpoint
app.get('/api/followups', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT f.*, l.name, l.email, l.lead_status
      FROM followups f JOIN leads l ON l.id = f.lead_id
      ORDER BY f.scheduled_at ASC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/leads/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['HOT','WARM','COLD'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const r = await pool.query(
      'UPDATE leads SET lead_status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json({ success: true, lead: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CRM Routes ────────────────────────────────────────────

app.post('/api/crm/sync', async (req, res) => {
  if (!process.env.CRM_BASE_URL || !process.env.CRM_SID) {
    return res.status(503).json({ error: 'CRM not configured' });
  }
  try {
    const result = await pollCrmLeads(pool);
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

// ── Follow-up Cron (every 5 minutes) ─────────────────────
setInterval(() => {
  processDueFollowups(pool).catch(console.error);
  pollCrmLeads(pool).catch(console.error);
}, 5 * 60 * 1000);

// Run once on startup too
processDueFollowups(pool).catch(console.error);
pollCrmLeads(pool).catch(console.error);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const emailReady = !!(
    process.env.SMTP_HOST &&
    (process.env.SMTP_USER || process.env.GMAIL_USER) &&
    (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD)
  );

  console.log(`\n✅  Lead Nurturing System  →  http://localhost:${PORT}`);
  console.log(`    Form        →  http://localhost:${PORT}`);
  console.log(`    Dashboard   →  http://localhost:${PORT}/dashboard.html`);
  console.log(`    Follow-ups  →  http://localhost:${PORT}/api/followups`);
  console.log('\n📣  Alert channels:');
  console.log(`    Slack       : ${process.env.SLACK_WEBHOOK_URL    ? '✅' : '⚠️  not set'}`);
  console.log(`    Telegram    : ${process.env.TELEGRAM_BOT_TOKEN   ? '✅' : '⚠️  not set'}`);
  console.log(`    Email(SMTP) : ${emailReady                        ? '✅' : '⚠️  not set'}`);
  console.log(`    WhatsApp    : ${process.env.TWILIO_ACCOUNT_SID   ? '✅' : '⚠️  not set'}`);
  console.log(`    SMS         : ${process.env.TWILIO_SMS_FROM      ? '✅' : '⚠️  not set'}`);
  console.log('\n⏰  Follow-up cron: running every 5 minutes\n');
});
