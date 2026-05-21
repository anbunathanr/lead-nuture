/**
 * server.js — Lead Nurturing AI Platform
 * Handles: config management, KB training, AI email reply, Fibonacci nudges, dashboard API
 */

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const cookieParser = require('cookie-parser');
const multer     = require('multer');
const bcrypt     = require('bcrypt');
const BCRYPT_ROUNDS = 10;

const { checkCrmHealth, getCrmLeadsWithStats } = require('./crm');
const { buildKnowledgeBase, addManualText } = require('./ai/knowledge-base');
const { generateEmailReply }  = require('./ai/email-reply');
const { generateNudgeEmail, getNextNudge, FIBONACCI_DAYS } = require('./ai/fibonacci-nudge');
const { handleLeadMessage, setTelegramWebhook } = require('./ai/telegram-bot');
const { pollAndReply } = require('./ai/imap-poller');

const app        = express();
const CONFIG_FILE = path.join(__dirname, 'data/tenant-config.json');
const NUDGE_FILE  = path.join(__dirname, 'data/nudge-schedule.json');

app.use(express.json());
app.use(cookieParser());

// Simple in-memory rate limiter for login
const loginAttempts = new Map(); // ip -> { count, resetAt }
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= 10; // 10 attempts per 15 minutes
}

// Serve public files (customer-facing)
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
}));

// -- Admin Auth --------------------------------------------

const ADMIN_SESSIONS = new Set();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nurturio-admin-2024';

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = require('crypto').randomBytes(32).toString('hex');
    ADMIN_SESSIONS.add(token);
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// POST /api/admin/logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies?.admin_token;
  if (token) ADMIN_SESSIONS.delete(token);
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (token && ADMIN_SESSIONS.has(token)) return next();
  if (req.path.endsWith('.html') || req.path === '/') {
    return res.redirect('/admin/login.html');
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Protect /admin/* routes (except login page)
app.use('/admin', (req, res, next) => {
  if (req.path === '/login.html' || req.path === '/login') return next();
  requireAdmin(req, res, next);
});

// Serve admin static files
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// /admin and /admin/ ? redirect to login
app.get('/admin', (req, res) => res.redirect('/admin/login.html'));
app.get('/admin/', (req, res) => res.redirect('/admin/login.html'));

// -- Customer Sessions ------------------------------------

// Customer sessions (in-memory, keyed by token)
const CUSTOMER_SESSIONS = new Map(); // token -> { email, expires }

function createCustomerSession(email) {
  const token = require('crypto').randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  CUSTOMER_SESSIONS.set(token, { email, expires });
  return token;
}

function getCustomerFromSession(req) {
  const token = req.cookies?.customer_token;
  if (!token) return null;
  const session = CUSTOMER_SESSIONS.get(token);
  if (!session || session.expires < Date.now()) {
    if (session) CUSTOMER_SESSIONS.delete(token);
    return null;
  }
  return session.email;
}

// ── Config helpers ────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadNudgeSchedule() {
  if (!fs.existsSync(NUDGE_FILE)) return {};
  return JSON.parse(fs.readFileSync(NUDGE_FILE, 'utf8'));
}

function saveNudgeSchedule(schedule) {
  fs.mkdirSync(path.dirname(NUDGE_FILE), { recursive: true });
  fs.writeFileSync(NUDGE_FILE, JSON.stringify(schedule, null, 2));
}

// ── Config API ────────────────────────────────────────────

// GET /api/config — load current config (passwords redacted)
// GET /api/kb - return current knowledge base status and sources
app.get('/api/kb', (req, res) => {
  const { loadKnowledgeBase, loadKnowledgeBaseForEmail } = require('./ai/knowledge-base');
  const email = req.query.email || null;
  const kb = email ? loadKnowledgeBaseForEmail(email) : loadKnowledgeBase();
  if (!kb) return res.json({ trained: false, chunks: 0, pages: 0, sources: [], built_at: null });
  const sourceMap = {};
  for (const chunk of kb.chunks) {
    const src = chunk.url || 'manual';
    if (!sourceMap[src]) sourceMap[src] = 0;
    sourceMap[src]++;
  }
  const sources = Object.entries(sourceMap).map(([url, count]) => ({ url, count }));
  res.json({ trained: kb.chunks.length > 0, chunks: kb.chunks.length, pages: kb.page_count || 0, built_at: kb.built_at, sources });
});

// GET /api/kb/text - return all KB chunks as plain text (used by n8n workflows)
app.get('/api/kb/text', (req, res) => {
  const { loadKnowledgeBase, loadKnowledgeBaseForEmail } = require('./ai/knowledge-base');
  const email = req.query.email || null;
  const kb = email ? loadKnowledgeBaseForEmail(email) : loadKnowledgeBase();
  if (!kb || !kb.chunks || kb.chunks.length === 0) {
    return res.json({ kbText: '', trained: false });
  }
  const seen = new Set();
  const kbText = kb.chunks
    .map(c => c.text)
    .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; })
    .join('\n\n')
    .slice(0, 6000); // cap to stay within token limits
  res.json({ kbText, trained: true, chunks: kb.chunks.length });
});

// DELETE /api/kb - clear the knowledge base
app.delete('/api/kb', (req, res) => {
  try {
    const email = req.query.email || null;

    if (email) {
      // Validate session
      const sessionEmail = getCustomerFromSession(req);
      // Also support Bearer token
      const authHeader = req.headers['authorization'] || '';
      let authorized = sessionEmail && sessionEmail.toLowerCase() === email.toLowerCase();
      if (!authorized && authHeader.startsWith('Bearer ')) {
        // Check in-memory sessions by token
        const token = authHeader.slice(7);
        const session = CUSTOMER_SESSIONS.get(token);
        if (session && session.email.toLowerCase() === email.toLowerCase() && session.expires > Date.now()) {
          authorized = true;
        }
      }
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Delete per-customer KB file
      const kbPath = path.join(CUSTOMERS_DIR, sanitizeEmail(email) + '-kb.json');
      if (fs.existsSync(kbPath)) fs.unlinkSync(kbPath);

      // Mark kb_trained = false in customer profile
      const cPath = customerFilePath(email);
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        cData.kb_trained = false;
        cData.updated_at = new Date().toISOString();
        fs.writeFileSync(cPath, JSON.stringify(cData, null, 2));
      }
    } else {
      // Clear global KB
      const KB_FILE = path.join(__dirname, 'data/knowledge-base.json');
      if (fs.existsSync(KB_FILE)) fs.unlinkSync(KB_FILE);
      const cfg = loadConfig();
      if (cfg) { cfg.kb_chunk_count = 0; cfg.kb_built_at = null; saveConfig(cfg); }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  if (!cfg) return res.json({});
  // Redact sensitive fields
  const safe = { ...cfg };
  ['crm_password','smtp_pass','imap_pass','twilio_token',].forEach(k => {
    if (safe[k]) safe[k] = '••••••••';
  });
  res.json(safe);
});

// POST /api/config — save config and train knowledge base
app.post('/api/config', async (req, res) => {
  try {
    const cfg = { ...req.body, created_at: new Date().toISOString() };

    // Do NOT auto-train KB here � use POST /api/kb/train explicitly
    saveConfig(cfg);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kb/train � explicitly train KB from URL + optional description
app.post('/api/kb/train', async (req, res) => {
  try {
    const cfg = loadConfig();
    const { company_url, company_name, description, email } = req.body;

    // Validate session if email is provided
    if (email) {
      const sessionEmail = getCustomerFromSession(req);
      if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const url  = company_url  || cfg?.company_url;
    const name = company_name || cfg?.company_name || 'Company';

    if (!url) return res.status(400).json({ error: 'company_url is required' });

    // Crawl the URL — save to per-customer file if email provided
    let kbResult;
    if (email) {
      const { buildKnowledgeBaseToFile } = require('./ai/knowledge-base');
      kbResult = await buildKnowledgeBaseToFile(url, name, email);
    } else {
      kbResult = await buildKnowledgeBase(url, name);
    }

    // If description provided, add it too
    if (description && description.trim()) {
      if (email) {
        const { addManualTextToFile } = require('./ai/knowledge-base');
        addManualTextToFile(description.trim(), name, email);
      } else {
        addManualText(description.trim(), name);
      }
    }

    // Reload KB to get final chunk count
    const { loadKnowledgeBase, loadKnowledgeBaseForEmail } = require('./ai/knowledge-base');
    const kb = email ? loadKnowledgeBaseForEmail(email) : loadKnowledgeBase();
    const totalChunks = kb ? kb.chunks.length : kbResult.chunks.length;

    // Update config with KB stats (global config only)
    if (cfg && !email) {
      cfg.kb_built_at    = new Date().toISOString();
      cfg.kb_chunk_count = totalChunks;
      saveConfig(cfg);
    }

    // Update customer profile kb_trained flag if email provided
    if (email) {
      const cPath = customerFilePath(email);
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        cData.kb_trained = true;
        cData.updated_at = new Date().toISOString();
        fs.writeFileSync(cPath, JSON.stringify(cData, null, 2));
      }
    }

    res.json({
      success:        true,
      kb_chunks:      totalChunks,
      kb_chunk_count: totalChunks,
      kb_built_at:    new Date().toISOString(),
      page_count:     kbResult.pageCount,
    });
  } catch (err) {
    console.error('[KB] Train error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kb/manual � add plain text to knowledge base
app.post('/api/kb/manual', (req, res) => {
  try {
    const cfg = loadConfig();
    const { text, email } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    // Validate session if email is provided
    if (email) {
      const sessionEmail = getCustomerFromSession(req);
      if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    let result;
    if (email) {
      const cPath = customerFilePath(email);
      let companyName = 'Company';
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        companyName = cData.company_name || companyName;
      }
      const { addManualTextToFile } = require('./ai/knowledge-base');
      result = addManualTextToFile(text, companyName, email);
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        cData.kb_trained = true;
        cData.updated_at = new Date().toISOString();
        fs.writeFileSync(cPath, JSON.stringify(cData, null, 2));
      }
    } else {
      result = addManualText(text, cfg && cfg.company_name ? cfg.company_name : 'Company');
    }
    res.json({ success: true, kb_chunks: result.chunks.length, kb_chunk_count: result.chunks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kb/upload — upload PDF/TXT/DOCX file and add to KB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/api/kb/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { originalname, mimetype, buffer } = req.file;
    const ext = path.extname(originalname).toLowerCase();

    // Determine company name — from email param or global config
    const email = req.body.email || null;

    // Validate session if email is provided
    if (email) {
      const sessionEmail = getCustomerFromSession(req);
      if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    let companyName = 'Company';
    if (email) {
      const cPath = customerFilePath(email);
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        companyName = cData.company_name || companyName;
      }
    } else {
      const cfg2 = loadConfig();
      if (cfg2 && cfg2.company_name) companyName = cfg2.company_name;
    }

    let text = '';
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = data.text || '';
    } else {
      // .txt, .docx, or any other — treat as plain text
      text = buffer.toString('utf8');
    }

    if (!text.trim()) return res.status(400).json({ error: 'Could not extract text from file' });

    // Save to per-customer KB if email provided, otherwise global
    let result;
    if (email) {
      const { addManualTextToFile } = require('./ai/knowledge-base');
      result = addManualTextToFile(text, companyName, email);
    } else {
      result = addManualText(text, companyName);
    }

    res.json({ success: true, kb_chunks: result.chunks.length, filename: originalname });
  } catch (err) {
    console.error('[KB Upload] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CRM Dashboard API ─────────────────────────────────────

app.get('/api/crm/leads', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (cfg) {
      // Use config file credentials if set
      process.env.CRM_BASE_URL  = cfg.crm_base_url  || process.env.CRM_BASE_URL;
      process.env.CRM_USER      = cfg.crm_user       || process.env.CRM_USER;
      process.env.CRM_PASSWORD  = cfg.crm_password   || process.env.CRM_PASSWORD;
    }
    const data = await getCrmLeadsWithStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/health', async (req, res) => {
  const health = await checkCrmHealth();
  health.ok
    ? res.json({ status: 'ok', crm: health.crm })
    : res.status(503).json({ status: 'error', message: health.message });
});

// ── AI Email Reply API ────────────────────────────────────

// POST /api/ai/reply — generate AI reply to a lead's email
app.post('/api/ai/reply', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!process.env.AWS_ACCESS_KEY_ID) return res.status(400).json({ error: 'AWS credentials not configured' });

    const { leadName, leadEmail, incomingEmail } = req.body;
    if (!incomingEmail) return res.status(400).json({ error: 'incomingEmail is required' });

    const reply = await generateEmailReply({
      leadName:      leadName || 'there',
      leadEmail:     leadEmail || '',
      incomingEmail,
      companyName:   cfg.company_name,
      companyUrl:    cfg.company_url,
      bookingUrl:    cfg.booking_url,
      awsAccessKey:  process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey:  process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion:     process.env.AWS_REGION || 'us-east-1',
      bedrockModelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    });

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fibonacci Nudge API ───────────────────────────────────

// POST /api/ai/chat � Bedrock chat endpoint for n8n workflows
// n8n calls this instead of Bedrock directly (avoids AWS Sig V4 issues in n8n HTTP nodes)
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { systemPrompt, userMessage, maxTokens = 400 } = req.body;
    if (!userMessage) return res.status(400).json({ error: 'userMessage is required' });

    const { bedrockChat } = require('./ai/bedrock-client');
    const text = await bedrockChat({
      accessKey:  process.env.AWS_ACCESS_KEY_ID,
      secretKey:  process.env.AWS_SECRET_ACCESS_KEY,
      region:     process.env.AWS_REGION      || 'us-east-1',
      modelId:    process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
    });

    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/nudge — generate next nudge email for a lead
app.post('/api/ai/nudge', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!process.env.AWS_ACCESS_KEY_ID) return res.status(400).json({ error: 'AWS credentials not configured' });

    const { leadId, leadName, leadEmail, productName, firstContactDate } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    // Load nudge schedule
    const schedule = loadNudgeSchedule();
    const leadSchedule = schedule[leadId] || { lastStep: 0, firstContactDate: firstContactDate || new Date().toISOString() };

    const nextNudge = getNextNudge(leadSchedule.lastStep, new Date(leadSchedule.firstContactDate));
    if (!nextNudge) return res.json({ done: true, message: 'All nudges sent for this lead' });

    // Check if it's time to send
    const now = new Date();
    if (nextNudge.scheduledDate > now) {
      return res.json({
        done:          false,
        nextStep:      nextNudge.nextStep,
        scheduledDate: nextNudge.scheduledDate,
        message:       `Next nudge scheduled for ${nextNudge.scheduledDate.toDateString()}`
      });
    }

    // Generate the nudge email
    const { subject, body } = await generateNudgeEmail({
      leadName:    leadName || 'there',
      leadEmail:   leadEmail || '',
      productName: productName || cfg.company_name,
      companyName: cfg.company_name,
      companyUrl:  cfg.company_url,
      bookingUrl:  cfg.booking_url,
      nudgeStep:   nextNudge.nextStep,
      awsAccessKey:   process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey:   process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion:      process.env.AWS_REGION || 'us-east-1',
      bedrockModelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    });

    // Update schedule
    schedule[leadId] = {
      lastStep:         nextNudge.nextStep,
      firstContactDate: leadSchedule.firstContactDate,
      lastSentAt:       now.toISOString(),
    };
    saveNudgeSchedule(schedule);

    res.json({ done: false, step: nextNudge.nextStep, subject, body, scheduledDate: nextNudge.scheduledDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/nudge-schedule — get all pending nudges due today
app.get('/api/ai/nudge-schedule', async (req, res) => {
  try {
    const schedule = loadNudgeSchedule();
    const now = new Date();
    const due = [];

    for (const [leadId, data] of Object.entries(schedule)) {
      const next = getNextNudge(data.lastStep, new Date(data.firstContactDate));
      if (next && next.scheduledDate <= now) {
        due.push({ leadId, ...data, nextStep: next.nextStep, scheduledDate: next.scheduledDate });
      }
    }

    res.json({ due, total: Object.keys(schedule).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/schedule-lead — add a lead to the nudge schedule
app.post('/api/ai/schedule-lead', (req, res) => {
  try {
    const { leadId, firstContactDate } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    const schedule = loadNudgeSchedule();
    if (!schedule[leadId]) {
      schedule[leadId] = {
        lastStep:         0,
        firstContactDate: firstContactDate || new Date().toISOString(),
      };
      saveNudgeSchedule(schedule);
    }

    res.json({ success: true, leadId, schedule: schedule[leadId] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────

// POST /api/workflow/download � generate pre-filled n8n workflow JSON for customer
app.post('/api/workflow/download', (req, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');

    const {
      crm_base_url, crm_user, crm_password,
      smtp_from, smtp_host, smtp_port, smtp_user, smtp_pass,
      slack_webhook, telegram_chat_id,
      twilio_sid, twilio_token, twilio_whatsapp_from, twilio_sms_from,
      company_name, company_url, booking_url,
      leads_per_run,
      products,
    } = req.body;

    if (!crm_base_url || !crm_user || !crm_password) {
      return res.status(400).json({ error: 'CRM URL, username and password are required' });
    }

    // Load the template workflow
    const templatePath = path.join(__dirname, 'workflows/lead-nurturing-workflow.json');
    let workflow = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

    // Strip internal IDs so customer gets a clean import
    workflow.id = undefined;
    workflow.versionId = undefined;
    workflow.meta = { templateCredsSetupCompleted: false };
    workflow.active = false;
    workflow.name = 'Nurturio � Lead Nurturing';

    // Build product catalog from customer's products
    const productCatalog = (products || []).map(p => ({
      keywords: (p.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean),
      name: p.name || '',
      pitch: p.pitch || '',
      url: p.url || company_url || '',
    }));

    // Stringify workflow to do replacements
    let wf = JSON.stringify(workflow, null, 2);

    // Replace CRM credentials
    const crmHost = crm_base_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    wf = wf.replace(/34\.196\.221\.16:8000/g, crmHost);
    wf = wf.replace(/http:\/\/34\.196\.221\.16:8000/g, crm_base_url.replace(/\/$/, ''));
    wf = wf.replace(/rupaliii739@gmail\.com/g, crm_user);
    wf = wf.replace(/Rupali1103@@/g, crm_password);

    // Replace Slack webhook
    if (slack_webhook) {
      wf = wf.replace(/https:\/\/hooks\.slack\.com\/services\/T09QSGVSS10\/B0AR6S9KCKX\/dEhmSBWnv5hJMjkhcYxw7wNj/g, slack_webhook);
    }

    // Replace Telegram chat ID
    if (telegram_chat_id) {
      wf = wf.replace(/"7336265543"/g, '"' + telegram_chat_id + '"');
    }

    // Replace Twilio Account SID in URLs
    if (twilio_sid) {
      wf = wf.replace(/TWILIO_ACCOUNT_SID_PLACEHOLDER/g, twilio_sid);
    }

    // Replace WhatsApp from number
    if (twilio_whatsapp_from) {
      wf = wf.replace(/TWILIO_WHATSAPP_FROM_PLACEHOLDER/g, twilio_whatsapp_from.startsWith('whatsapp:') ? twilio_whatsapp_from : 'whatsapp:' + twilio_whatsapp_from);
    }

    // Replace SMS from number
    if (twilio_sms_from) {
      wf = wf.replace(/\+17405308047/g, twilio_sms_from);
    }

    // Replace email from address
    if (smtp_from) {
      wf = wf.replace(/rupaliii739@gmail\.com/g, smtp_from);
    }

    // Replace booking URL and website URL in message bodies
    if (booking_url) {
      wf = wf.replace(/\{\{BOOKING_URL\}\}/g, booking_url);
      wf = wf.replace(/https:\/\/calendar\.app\.google\/HgnRmYThZYLo7Ya98/g, booking_url);
    }
    if (company_url) {
      wf = wf.replace(/\{\{COMPANY_URL\}\}/g, company_url);
      wf = wf.replace(/https:\/\/digitransolutions\.in\//g, company_url.endsWith('/') ? company_url : company_url + '/');
      wf = wf.replace(/https:\/\/digitransolutions\.in/g, company_url.replace(/\/$/, ''));
    }

    // Replace Telegram bot URL
    const telegramBotUrl = req.body.telegram_bot_url || 'https://t.me/your_bot';
    wf = wf.replace(/\{\{TELEGRAM_BOT_URL\}\}/g, telegramBotUrl);

    if (company_name) {
      wf = wf.replace(/\{\{COMPANY_NAME\}\}/g, company_name);
      wf = wf.replace(/Digitrans Solutions/g, company_name);
      wf = wf.replace(/Digitrans Solutions Team/g, company_name + ' Team');
      // Replace company name in system prompts
      wf = wf.replace(/for Digitrans Solutions/g, `for ${company_name || 'our company'}`);
      wf = wf.replace(/of Digitrans Solutions/g, `of ${company_name || 'our company'}`);
      wf = wf.replace(/"Digitrans Solutions Team"/g, `"${company_name || 'our company'} Team"`);
      wf = wf.replace(/Sign off as: Digitrans Solutions Team/g, `Sign off as: ${company_name || 'our company'} Team`);
    }

    // Replace leads per run
    if (leads_per_run) {
      wf = wf.replace(/"value": "2"\n.*?filters/, '"value": "' + leads_per_run + '"\n            },\n            {\n              "name": "filters');
    }

    // Update product catalog in the Split Into Individual Leads node if customer provided products
    if (productCatalog.length > 0) {
      const productJson = JSON.stringify(productCatalog, null, 2)
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
      // Replace the PRODUCTS array in the jsCode
      wf = wf.replace(
        /const PRODUCTS = \[[\s\S]*?\];/,
        'const PRODUCTS = ' + JSON.stringify(productCatalog) + ';'
      );
    }

    // Remove credential IDs (customer needs to set their own)
    const parsed = JSON.parse(wf);
    for (const node of parsed.nodes) {
      if (node.credentials) {
        // Reset credential IDs to placeholder names
        for (const key of Object.keys(node.credentials)) {
          node.credentials[key] = { id: '', name: 'Set up in n8n credentials' };
        }
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="nurturio-workflow.json"');
    res.send(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error('[Workflow Download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Customer Registration & Login ------------------------

const CUSTOMERS_DIR = path.join(__dirname, 'data/customers');

function sanitizeEmail(email) {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  // Support both old SHA256 hashes and new bcrypt hashes
  if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
    return bcrypt.compare(password, hash);
  }
  // Legacy SHA256 fallback
  const sha256 = require('crypto').createHash('sha256').update(password).digest('hex');
  return sha256 === hash;
}

function customerFilePath(email) {
  return path.join(CUSTOMERS_DIR, sanitizeEmail(email) + '.json');
}

function workflowFilePath(email) {
  return path.join(CUSTOMERS_DIR, sanitizeEmail(email) + '-workflow.json');
}

// Ensure customers directory exists
fs.mkdirSync(CUSTOMERS_DIR, { recursive: true });

// POST /api/customer/register
app.post('/api/customer/register', async (req, res) => {
  try {
    const {
      email, password,
      company_name, company_url, booking_url,
      crm_base_url, crm_user, crm_password,
      smtp_host, smtp_port, smtp_user, smtp_pass,
      slack_webhook, telegram_chat_id, telegram_bot_url,
      leads_per_run,
    } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!company_name)       return res.status(400).json({ error: 'Company name is required' });

    const filePath = customerFilePath(email);

    // If already registered, return error (use login instead)
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'Account already exists. Please sign in.' });
    }

    const customerData = {
      email,
      password_hash: await hashPassword(password),
      company_name:  company_name || '',
      company_url:   company_url  || '',
      booking_url:   booking_url  || '',
      crm_base_url:  crm_base_url  || '',
      crm_user:      crm_user      || '',
      crm_password:  crm_password  || '',
      smtp_host:     smtp_host     || 'smtp.gmail.com',
      smtp_port:     smtp_port     || '587',
      smtp_user:     smtp_user     || '',
      smtp_pass:     smtp_pass     || '',
      slack_webhook:      slack_webhook      || '',
      telegram_chat_id:   telegram_chat_id   || '',
      telegram_bot_url:   telegram_bot_url   || '',
      leads_per_run:      '1',
      registered_at: new Date().toISOString(),
      status: 'active',
    };

    fs.writeFileSync(filePath, JSON.stringify(customerData, null, 2));

    // Generate workflow JSON and save it
    try {
      const templatePath = path.join(__dirname, 'workflows/lead-nurturing-workflow.json');
      let workflow = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

      workflow.id        = undefined;
      workflow.versionId = undefined;
      workflow.meta      = { templateCredsSetupCompleted: false };
      workflow.active    = false;
      workflow.name      = 'Nurturio � Lead Nurturing';

      let wf = JSON.stringify(workflow, null, 2);

      const crmHost = (crm_base_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      wf = wf.replace(/34\.196\.221\.16:8000/g, crmHost);
      wf = wf.replace(/http:\/\/34\.196\.221\.16:8000/g, (crm_base_url || '').replace(/\/$/, ''));
      wf = wf.replace(/rupaliii739@gmail\.com/g, crm_user || '');
      wf = wf.replace(/Rupali1103@@/g, crm_password || '');

      if (slack_webhook) {
        wf = wf.replace(/https:\/\/hooks\.slack\.com\/services\/T09QSGVSS10\/B0AR6S9KCKX\/dEhmSBWnv5hJMjkhcYxw7wNj/g, slack_webhook);
      }
      if (telegram_chat_id) {
        wf = wf.replace(/"7336265543"/g, '"' + telegram_chat_id + '"');
      }
      if (booking_url) {
        wf = wf.replace(/\{\{BOOKING_URL\}\}/g, booking_url);
        wf = wf.replace(/https:\/\/calendar\.app\.google\/HgnRmYThZYLo7Ya98/g, booking_url);
      }
      if (company_url) {
        wf = wf.replace(/\{\{COMPANY_URL\}\}/g, company_url);
        wf = wf.replace(/https:\/\/digitransolutions\.in\//g, company_url.endsWith('/') ? company_url : company_url + '/');
        wf = wf.replace(/https:\/\/digitransolutions\.in/g, company_url.replace(/\/$/, ''));
      }
      if (telegram_bot_url) {
        wf = wf.replace(/\{\{TELEGRAM_BOT_URL\}\}/g, telegram_bot_url);
      }
      if (company_name) {
        wf = wf.replace(/\{\{COMPANY_NAME\}\}/g, company_name);
        wf = wf.replace(/Digitrans Solutions/g, company_name);
        wf = wf.replace(/Digitrans Solutions Team/g, company_name + ' Team');
        // Replace company name in system prompts
        wf = wf.replace(/for Digitrans Solutions/g, `for ${company_name || 'our company'}`);
        wf = wf.replace(/of Digitrans Solutions/g, `of ${company_name || 'our company'}`);
        wf = wf.replace(/"Digitrans Solutions Team"/g, `"${company_name || 'our company'} Team"`);
        wf = wf.replace(/Sign off as: Digitrans Solutions Team/g, `Sign off as: ${company_name || 'our company'} Team`);
      }
      if (leads_per_run) {
        wf = wf.replace(/"value": "2"\n.*?filters/, '"value": "' + leads_per_run + '"\n            },\n            {\n              "name": "filters');
      }

      const parsed = JSON.parse(wf);
      for (const node of parsed.nodes) {
        if (node.credentials) {
          for (const key of Object.keys(node.credentials)) {
            node.credentials[key] = { id: '', name: 'Set up in n8n credentials' };
          }
        }
      }

      fs.writeFileSync(workflowFilePath(email), JSON.stringify(parsed, null, 2));
    } catch (wfErr) {
      console.error('[Register] Workflow generation error:', wfErr.message);
      // Non-fatal � customer is still registered
    }

    res.json({ success: true, company_name });
  } catch (err) {
    console.error('[Register] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/profile � load a customer's profile (by email query param)
app.get('/api/customer/profile', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Validate session — user can only access their own profile
    const sessionEmail = getCustomerFromSession(req);
    if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filePath = customerFilePath(email);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const safe = { ...data };
    delete safe.password_hash;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customer/profile � update a customer's profile fields + regenerate workflow
app.put('/api/customer/profile', (req, res) => {
  try {
    const { email, ...updates } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Validate session — user can only update their own profile
    const sessionEmail = getCustomerFromSession(req);
    if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filePath = customerFilePath(email);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    delete updates.password_hash;
    delete updates.password;
    updates.leads_per_run = '1'; // always 1 lead per run
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

    // Regenerate ALL 3 workflow JSONs with latest profile data
    try {
      const workflows = [
        { template: 'lead-nurturing-workflow.json',  output: 'lead-nurturing-workflow.json'  },
        { template: 'email-reply-workflow.json',     output: 'email-reply-workflow.json'     },
        { template: 'telegram-bot-workflow.json',    output: 'telegram-bot-workflow.json'    },
      ];

      for (const wfDef of workflows) {
        const templatePath = path.join(__dirname, 'workflows', wfDef.template);
        if (!fs.existsSync(templatePath)) continue;

        let workflow = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        workflow.id        = undefined;
        workflow.versionId = undefined;
        workflow.meta      = { templateCredsSetupCompleted: false };
        workflow.active    = false;
        workflow.name      = `${updated.company_name || email} � ${workflow.name || wfDef.template.replace('.json','')}`;

        let wf = JSON.stringify(workflow, null, 2);

        // -- CRM credentials --
        const crmHost = (updated.crm_base_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
        wf = wf.replace(/34\.196\.221\.16:8000/g, crmHost);
        wf = wf.replace(/http:\/\/34\.196\.221\.16:8000/g, (updated.crm_base_url || '').replace(/\/$/, ''));
        wf = wf.replace(/rupaliii739@gmail\.com/g, updated.crm_user || '');
        wf = wf.replace(/Rupali1103@@/g, updated.crm_password || '');

        // -- Alerts --
        if (updated.slack_webhook)
          wf = wf.replace(/https:\/\/hooks\.slack\.com\/services\/T09QSGVSS10\/B0AR6S9KCKX\/dEhmSBWnv5hJMjkhcYxw7wNj/g, updated.slack_webhook);
        if (updated.telegram_chat_id)
          wf = wf.replace(/"7336265543"/g, `"${updated.telegram_chat_id}"`);

        // -- URLs --
        if (updated.booking_url)
          wf = wf.replace(/https:\/\/calendar\.app\.google\/HgnRmYThZYLo7Ya98/g, updated.booking_url);
        if (updated.company_url) {
          wf = wf.replace(/https:\/\/digitransolutions\.in\//g, updated.company_url.endsWith('/') ? updated.company_url : updated.company_url + '/');
          wf = wf.replace(/https:\/\/digitransolutions\.in/g, updated.company_url.replace(/\/$/, ''));
        }
        if (updated.telegram_bot_url)
          wf = wf.replace(/https:\/\/t\.me\/digitrans_ai_bot/g, updated.telegram_bot_url);

        // -- Company name --
        if (updated.company_name) {
          wf = wf.replace(/Digitrans Solutions Team/g, updated.company_name + ' Team');
          wf = wf.replace(/Digitrans Solutions/g, updated.company_name);
          // Replace company name in system prompts
          wf = wf.replace(/for Digitrans Solutions/g, `for ${updated.company_name || 'our company'}`);
          wf = wf.replace(/of Digitrans Solutions/g, `of ${updated.company_name || 'our company'}`);
          wf = wf.replace(/"Digitrans Solutions Team"/g, `"${updated.company_name || 'our company'} Team"`);
          wf = wf.replace(/Sign off as: Digitrans Solutions Team/g, `Sign off as: ${updated.company_name || 'our company'} Team`);
        }

        // -- Email from address --
        if (updated.smtp_user)
          wf = wf.replace(/rupaliii739@gmail\.com/g, updated.smtp_user);

        // -- Leads per run --
        if (updated.leads_per_run)
          wf = wf.replace(/"limit", "value": "2"/, `"limit", "value": "${updated.leads_per_run}"`);

        // -- KB placeholder replacement --
        const kbPath = path.join(CUSTOMERS_DIR, sanitizeEmail(email) + '-kb.json');
        if (fs.existsSync(kbPath)) {
          const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
          const kbText = (kb.chunks || []).map(c => c.text).join('\n\n').slice(0, 3000);
          wf = wf.replace(/\{\{COMPANY_KB_PLACEHOLDER\}\}/g, kbText.replace(/`/g, "'"));
        }

        const parsed = JSON.parse(wf);
        // Clear credential IDs � customer sets their own in n8n
        for (const node of parsed.nodes) {
          if (node.credentials) {
            for (const key of Object.keys(node.credentials)) {
              node.credentials[key] = { id: '', name: 'Set up in n8n credentials' };
            }
          }
        }

        // Save each workflow with email prefix
        const outPath = path.join(CUSTOMERS_DIR, sanitizeEmail(email) + '-' + wfDef.output);
        fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
      }
    } catch (wfErr) {
      console.error('[Profile] Workflow regen error:', wfErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customer/login
app.post('/api/customer/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const filePath = customerFilePath(email);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const customer = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const passwordValid = await verifyPassword(password, customer.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = createCustomerSession(email);
    res.cookie('customer_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    res.json({ success: true, company_name: customer.company_name, status: customer.status || 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customer/logout
app.post('/api/customer/logout', (req, res) => {
  const token = req.cookies?.customer_token;
  if (token) CUSTOMER_SESSIONS.delete(token);
  res.clearCookie('customer_token');
  res.json({ ok: true });
});

// -- Admin Customer Management -----------------------------

// GET /api/admin/customers � list all registered customers
app.get('/api/admin/customers', requireAdmin, (req, res) => {
  try {
    fs.mkdirSync(CUSTOMERS_DIR, { recursive: true });
    const files = fs.readdirSync(CUSTOMERS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('-workflow.json') && !f.endsWith('-kb.json') && f !== '.gitkeep');
    const customers = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CUSTOMERS_DIR, f), 'utf8'));
        // Redact sensitive fields before sending to admin UI
        const safe = { ...data };
        ['password_hash', 'crm_password', 'smtp_pass'].forEach(k => { if (safe[k]) safe[k] = '��������'; });
        return safe;
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Sort newest first
    customers.sort((a, b) => new Date(b.registered_at || 0) - new Date(a.registered_at || 0));

    res.json({ customers, total: customers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/customers/:email/workflow � download a specific workflow
// ?type=lead-nurturing | email-reply | fibonacci-nudge (default: lead-nurturing)
app.get('/api/admin/customers/:email/workflow', requireAdmin, (req, res) => {
  try {
    const email   = decodeURIComponent(req.params.email);
    const type    = req.query.type || 'lead-nurturing';
    const safeName = sanitizeEmail(email);
    const fileMap = {
      'lead-nurturing':   safeName + '-lead-nurturing-workflow.json',
      'email-reply':      safeName + '-email-reply-workflow.json',
      'fibonacci-nudge':  safeName + '-fibonacci-nudge-workflow.json',
    };
    // Fall back to old single-workflow file for backwards compat
    const wfFile = fileMap[type] || (safeName + '-workflow.json');
    const wfPath = path.join(CUSTOMERS_DIR, wfFile);
    const fallback = path.join(CUSTOMERS_DIR, safeName + '-workflow.json');

    // For fibonacci-nudge, fall back to the template if no customer-specific file
    const templateFallback = type === 'fibonacci-nudge'
      ? path.join(__dirname, 'workflows/fibonacci-nudge-workflow.json')
      : null;

    const filePath = fs.existsSync(wfPath) ? wfPath
      : (fs.existsSync(fallback) ? fallback
      : (templateFallback && fs.existsSync(templateFallback) ? templateFallback : null));

    if (!filePath) {
      return res.status(404).json({ error: 'Workflow not found. Ask the customer to save their profile first.' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${type}-workflow.json"`);
    res.send(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/customers/:email/workflows-all — list all available workflow files for a customer
app.get('/api/admin/customers/:email/workflows-all', requireAdmin, (req, res) => {
  try {
    const email    = decodeURIComponent(req.params.email);
    const safeName = sanitizeEmail(email);
    const types = [
      { type: 'lead-nurturing',  label: 'Lead Nurturing',       file: safeName + '-lead-nurturing-workflow.json'  },
      { type: 'email-reply',     label: 'AI Email Reply',        file: safeName + '-email-reply-workflow.json'     },
      { type: 'fibonacci-nudge', label: 'Fibonacci Nudge Emails', file: safeName + '-fibonacci-nudge-workflow.json' },
    ];
    const available = types.map(t => ({
      ...t,
      exists: fs.existsSync(path.join(CUSTOMERS_DIR, t.file)),
    }));
    res.json({ workflows: available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Telegram Bot Webhook ----------------------------------
// POST /telegram/webhook � receives messages from leads via the bot
app.post('/telegram/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  try {
    const cfg = loadConfig();
    if (!cfg) return;
    const botToken = process.env.LEAD_BOT_TOKEN || cfg.lead_bot_token;
    if (!botToken) return;
    const { message } = req.body;
    if (!message) return;
    await handleLeadMessage({
      message,
      botToken,
      companyName: cfg.company_name || 'Our Company',
      companyUrl:  cfg.company_url  || '',
      bookingUrl:  cfg.booking_url  || '',
      awsAccessKey:   process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey:   process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion:      process.env.AWS_REGION || 'us-east-1',
      bedrockModelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
  } catch (err) {
    console.error('[TelegramBot] Webhook error:', err.message);
  }
});

// -- IMAP Email Reply Cron (every 5 minutes) ---------------
setInterval(async () => {
  try {
    const cfg = loadConfig();
    if (!cfg || !cfg.imap_host) return;
    const result = await pollAndReply({
      imapHost:    cfg.imap_host,
      imapUser:    cfg.imap_user,
      imapPass:    cfg.imap_pass,
      smtpHost:    cfg.smtp_host,
      smtpPort:    cfg.smtp_port || 587,
      smtpUser:    cfg.smtp_user,
      smtpPass:    cfg.smtp_pass,
      fromEmail:   cfg.smtp_from || cfg.smtp_user,
      companyName: cfg.company_name,
      companyUrl:  cfg.company_url,
      bookingUrl:  cfg.booking_url,
      awsAccessKey:   process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey:   process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion:      process.env.AWS_REGION || 'us-east-1',
      bedrockModelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
    if (result.replied > 0) console.log(`[IMAP] Auto-replied to ${result.replied} emails`);
  } catch (err) {
    console.error('[IMAP] Cron error:', err.message);
  }
}, 5 * 60 * 1000);
// POST /api/chat/widget — embeddable chatbot endpoint
app.post('/api/chat/widget', async (req, res) => {
  try {
    const { message, sessionId, companyEmail } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    let companyName = 'Our Company';
    let companyUrl  = '';
    let bookingUrl  = '';
    let kbText      = '';

    if (companyEmail) {
      const cPath = customerFilePath(companyEmail);
      if (fs.existsSync(cPath)) {
        const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
        companyName = cData.company_name || companyName;
        companyUrl  = cData.company_url  || '';
        bookingUrl  = cData.booking_url  || '';
      }
      // Load per-customer KB and find relevant chunks
      const kbPath = path.join(CUSTOMERS_DIR, require('./ai/knowledge-base').sanitizeEmailForKB(companyEmail) + '-kb.json');
      if (fs.existsSync(kbPath)) {
        const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        if (kb && kb.chunks && kb.chunks.length > 0) {
          const queryWords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const broadKeywords = ['all products', 'list', 'what do you', 'what products', 'what services', 'what offer', 'overview', 'everything', 'tell me about', 'what are your', 'name all', 'show all'];
          const isBroad = broadKeywords.some(k => message.toLowerCase().includes(k)) || queryWords.length <= 2;

          if (isBroad) {
            kbText = kb.chunks.map(c => c.text).join('\n\n').slice(0, 6000);
          } else {
            const scored = kb.chunks.map(c => {
              const text = c.text.toLowerCase();
              const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
              return { text: c.text, score };
            }).sort((a, b) => b.score - a.score);
            const topChunks = scored.filter(c => c.score > 0).slice(0, 5);
            const otherChunks = scored.filter(c => c.score === 0).slice(0, 2);
            kbText = [...topChunks, ...otherChunks].map(c => c.text).join('\n\n').slice(0, 6000);
          }
        }
      }
    }

    // Fall back to global KB if no per-customer KB
    if (!kbText) {
      const { loadKnowledgeBase } = require('./ai/knowledge-base');
      const kb = loadKnowledgeBase();
      if (kb && kb.chunks) {
        const queryWords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const scored = kb.chunks.map(c => {
          const text = c.text.toLowerCase();
          const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
          return { text: c.text, score };
        }).sort((a, b) => b.score - a.score);
        kbText = scored.slice(0, 6).map(c => c.text).join('\n\n').slice(0, 6000);
      }
    }

    const systemPrompt = `You are a helpful AI assistant for ${companyName}. Answer questions about the company, its products and services.
Be friendly, concise, and helpful. If you don't know something, say so honestly.
${bookingUrl ? `To book a meeting or demo, direct users to: ${bookingUrl}` : ''}
${companyUrl ? `Company website: ${companyUrl}` : ''}

KNOWLEDGE BASE:
${kbText || 'No specific knowledge base available. Answer based on general knowledge.'}`;

    const { bedrockChat } = require('./ai/bedrock-client');
    const reply = await bedrockChat({
      accessKey:  process.env.AWS_ACCESS_KEY_ID,
      secretKey:  process.env.AWS_SECRET_ACCESS_KEY,
      region:     process.env.AWS_REGION      || 'us-east-1',
      modelId:    process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      systemPrompt,
      messages: [{ role: 'user', content: message }],
      maxTokens: 400,
    });

    res.json({ reply });
  } catch (err) {
    console.error('[ChatWidget] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  // Count registered customers (exclude workflow and kb files)
  let customerCount = 0;
  try {
    const files = fs.readdirSync(CUSTOMERS_DIR);
    customerCount = files.filter(f => f.endsWith('.json') && !f.endsWith('-workflow.json') && !f.endsWith('-kb.json') && f !== '.gitkeep').length;
  } catch {}

  // Count KB chunks from global KB
  let kbChunks = 0;
  try {
    const KB_FILE = path.join(__dirname, 'data/knowledge-base.json');
    if (fs.existsSync(KB_FILE)) {
      const kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
      kbChunks = kb.chunks ? kb.chunks.length : 0;
    }
  } catch {}

  const region = process.env.AWS_REGION || 'us-east-1';

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Nurturio Platform            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log('  🌐 App        →  http://localhost:' + PORT);
  console.log('  📊 Dashboard  →  http://localhost:' + PORT + '/dashboard.html');
  console.log('  🔐 Admin      →  http://localhost:' + PORT + '/admin/login.html');
  console.log('');
  console.log('  📦 Customers  :  ' + customerCount + ' registered');
  console.log('  🧠 KB Chunks  :  ' + kbChunks + ' chunks trained');
  console.log('  🤖 AI Model   :  AWS Bedrock Claude Haiku 4.5');
  console.log('  🔑 AWS Region :  ' + region);
  console.log('');

  // Register Telegram webhook if bot token is set
  const leadBotToken = process.env.LEAD_BOT_TOKEN;
  const serverUrl    = process.env.SERVER_URL; // e.g. https://your-server.com
  if (leadBotToken && serverUrl) {
    setTelegramWebhook(leadBotToken, serverUrl + '/telegram/webhook')
      .then(() => console.log('  Telegram bot webhook registered'))
      .catch(e => console.log('  Telegram webhook failed:', e.message));
  }
});

