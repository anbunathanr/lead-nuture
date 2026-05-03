/**
 * server.js — Local development server
 * For production, use the AWS Lambda handler (lambda/handler.js)
 */

require('dotenv').config();
const express = require('express');
const path    = require('path');
const { checkCrmHealth, getCrmLeadsWithStats } = require('./crm');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CRM API ───────────────────────────────────────────────

app.get('/api/crm/leads', async (req, res) => {
  try {
    const data = await getCrmLeadsWithStats();
    res.json(data);
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

// ── Start ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅  Dashboard  →  http://localhost:${PORT}`);
  console.log(`    CRM API    →  http://localhost:${PORT}/api/crm/leads\n`);
});
