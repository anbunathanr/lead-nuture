/**
 * lambda/api-handler.js
 * Main API Lambda — handles all HTTP routes via API Gateway.
 * Replaces server.js for production AWS deployment.
 *
 * Storage:
 *   - DynamoDB: customers, sessions, nudge-schedule
 *   - S3: knowledge base files, static assets
 *   - SSM: secrets (admin password, AWS keys, etc.)
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const crypto = require('crypto');
const https  = require('https');
const bcrypt = require('bcrypt');

const REGION = process.env.AWS_REGION || 'us-east-1';
const CUSTOMERS_TABLE    = process.env.CUSTOMERS_TABLE    || 'nurturio-customers';
const SESSIONS_TABLE     = process.env.SESSIONS_TABLE     || 'nurturio-sessions';
const NUDGE_TABLE        = process.env.NUDGE_TABLE        || 'nurturio-nudge-schedule';
const KB_BUCKET          = process.env.KB_BUCKET          || 'nurturio-kb';
const BCRYPT_ROUNDS      = 10;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3     = new S3Client({ region: REGION });
const ssm    = new SSMClient({ region: REGION });

// ── SSM helpers ──────────────────────────────────────────
let _ssmCache = {};
async function getParam(name) {
  if (_ssmCache[name]) return _ssmCache[name];
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: `/nurturio/${name}`, WithDecryption: true }));
    _ssmCache[name] = r.Parameter.Value;
    return _ssmCache[name];
  } catch { return process.env[name.toUpperCase().replace(/-/g,'_')] || ''; }
}

// ── Response helpers ─────────────────────────────────────
function resp(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Cookie',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
function ok(body, headers)  { return resp(200, body, headers); }
function err(msg, code = 500) { return resp(code, { error: msg }); }

// ── Cookie helpers ───────────────────────────────────────
function parseCookies(cookieHeader = '') {
  return Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, v.join('=')];
  }).filter(([k]) => k));
}
function setCookieHeader(name, value, maxAge = 86400) {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

// ── Session helpers ──────────────────────────────────────
async function createSession(email) {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + 86400; // 24h TTL for DynamoDB
  await dynamo.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: { token, email, expires },
  }));
  return token;
}

async function getSessionEmail(cookieHeader, authHeader) {
  // Check Authorization: Bearer <token> header first (for S3-hosted frontend)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const r = await dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { token } }));
      if (!r.Item || r.Item.expires < Math.floor(Date.now() / 1000) || r.Item.isAdmin) return null;
      return r.Item.email;
    } catch { return null; }
  }
  // Fall back to cookie
  const cookies = parseCookies(cookieHeader);
  const token   = cookies.customer_token;
  if (!token) return null;
  try {
    const r = await dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { token } }));
    if (!r.Item || r.Item.expires < Math.floor(Date.now() / 1000)) return null;
    return r.Item.email;
  } catch { return null; }
}

async function getAdminSession(cookieHeader, authHeader) {
  // Check Authorization: Bearer <token> header first (for S3-hosted frontend)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const r = await dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { token } }));
      return !!(r.Item && r.Item.isAdmin && r.Item.expires > Math.floor(Date.now() / 1000));
    } catch { return false; }
  }
  // Fall back to cookie
  const cookies = parseCookies(cookieHeader);
  const token   = cookies.admin_token;
  if (!token) return false;
  try {
    const r = await dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { token } }));
    return !!(r.Item && r.Item.isAdmin && r.Item.expires > Math.floor(Date.now() / 1000));
  } catch { return false; }
}

// ── S3 KB helpers ────────────────────────────────────────
function kbKey(email) {
  return `customers/${email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}-kb.json`;
}

async function loadKB(email) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: KB_BUCKET, Key: kbKey(email) }));
    const body = await r.Body.transformToString();
    return JSON.parse(body);
  } catch { return null; }
}

async function saveKB(email, kb) {
  await s3.send(new PutObjectCommand({
    Bucket: KB_BUCKET,
    Key: kbKey(email),
    Body: JSON.stringify(kb),
    ContentType: 'application/json',
  }));
}

function chunkText(text, size = 500) {
  const words = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    const c = words.slice(i, i + size).join(' ').trim();
    if (c.length > 50) chunks.push(c);
  }
  return chunks;
}

// ── Bedrock helper ───────────────────────────────────────
async function bedrockChat(systemPrompt, userMessage, maxTokens = 400) {
  const accessKey = await getParam('aws-access-key') || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = await getParam('aws-secret-key') || process.env.AWS_SECRET_ACCESS_KEY;
  const modelId   = await getParam('bedrock-model-id') || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

  // Use the existing bedrock signing logic
  const { bedrockChat: _chat } = require('./bedrock-client');
  return _chat({ accessKey, secretKey, region: REGION, modelId, systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens });
}

// ── Rate limiter (in-memory, resets on cold start) ───────
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip) || { count: 0, resetAt: now + 900000 };
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + 900000; }
  e.count++;
  loginAttempts.set(ip, e);
  return e.count <= 10;
}

// ── Route handlers ───────────────────────────────────────

async function handleCustomerRegister(body) {
  const { email, password, company_name } = body;
  if (!email || !password) return err('Email and password required', 400);
  if (!company_name) return err('Company name required', 400);

  const existing = await dynamo.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { email } }));
  if (existing.Item) return err('Account already exists', 409);

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const item = {
    email, password_hash, company_name,
    company_url: body.company_url || '',
    booking_url: body.booking_url || '',
    crm_base_url: body.crm_base_url || '',
    crm_user: body.crm_user || '',
    crm_password: body.crm_password || '',
    smtp_host: body.smtp_host || 'smtp.gmail.com',
    smtp_port: body.smtp_port || '587',
    smtp_user: body.smtp_user || '',
    smtp_pass: body.smtp_pass || '',
    slack_webhook: body.slack_webhook || '',
    telegram_chat_id: body.telegram_chat_id || '',
    leads_per_run: body.leads_per_run || '2',
    registered_at: new Date().toISOString(),
    status: 'active',
    kb_trained: false,
  };
  await dynamo.send(new PutCommand({ TableName: CUSTOMERS_TABLE, Item: item }));
  const token = await createSession(email);
  return ok(
    { success: true, company_name, token },
    { 'Set-Cookie': setCookieHeader('customer_token', token) }
  );
}

async function handleCustomerLogin(body, ip) {
  if (!checkRateLimit(ip)) return err('Too many attempts. Try again in 15 minutes.', 429);
  const { email, password } = body;
  if (!email || !password) return err('Email and password required', 400);

  const r = await dynamo.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { email } }));
  if (!r.Item) return err('Account not found', 404);

  const valid = r.Item.password_hash.startsWith('$2')
    ? await bcrypt.compare(password, r.Item.password_hash)
    : crypto.createHash('sha256').update(password).digest('hex') === r.Item.password_hash;

  if (!valid) return err('Invalid password', 401);

  const token = await createSession(email);
  // Return token in body AND cookie so both S3-hosted and server-hosted frontends work
  return ok(
    { success: true, company_name: r.Item.company_name, token },
    { 'Set-Cookie': setCookieHeader('customer_token', token) }
  );
}

async function handleCustomerLogout(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  if (cookies.customer_token) {
    await dynamo.send(new DeleteCommand({ TableName: SESSIONS_TABLE, Key: { token: cookies.customer_token } })).catch(() => {});
  }
  return ok({ ok: true }, { 'Set-Cookie': 'customer_token=; Max-Age=0; Path=/' });
}

async function handleGetProfile(email, cookieHeader, authHeader = '') {
  const sessionEmail = await getSessionEmail(cookieHeader, authHeader);
  if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) return err('Unauthorized', 401);

  const r = await dynamo.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { email } }));
  if (!r.Item) return err('Not found', 404);
  const safe = { ...r.Item };
  delete safe.password_hash;
  return ok(safe);
}

async function handleUpdateProfile(body, cookieHeader, authHeader = '') {
  const { email, ...updates } = body;
  if (!email) return err('email required', 400);

  const sessionEmail = await getSessionEmail(cookieHeader, authHeader);
  if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) return err('Unauthorized', 401);

  delete updates.password_hash;
  delete updates.password;
  updates.updated_at = new Date().toISOString();

  // Build DynamoDB update expression
  const expParts = [], expNames = {}, expValues = {};
  for (const [k, v] of Object.entries(updates)) {
    expParts.push(`#${k} = :${k}`);
    expNames[`#${k}`] = k;
    expValues[`:${k}`] = v;
  }

  await dynamo.send(new UpdateCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { email },
    UpdateExpression: `SET ${expParts.join(', ')}`,
    ExpressionAttributeNames: expNames,
    ExpressionAttributeValues: expValues,
  }));

  return ok({ success: true });
}

async function handleKBTrain(body, cookieHeader, authHeader = '') {
  const { company_url, company_name, description, email } = body;
  if (email) {
    const sessionEmail = await getSessionEmail(cookieHeader, authHeader);
    if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) return err('Unauthorized', 401);
  }
  if (!company_url) return err('company_url required', 400);

  // Crawl website
  const chunks = await crawlUrl(company_url);
  let allChunks = chunks.map(text => ({ url: company_url, text }));

  // Add description if provided
  if (description) {
    allChunks = [...allChunks, ...chunkText(description).map(t => ({ url: 'manual', text: t }))];
  }

  // Preserve existing manual chunks
  if (email) {
    const existing = await loadKB(email);
    const manualChunks = (existing?.chunks || []).filter(c => c.url === 'manual');
    allChunks = [...allChunks, ...manualChunks];
  }

  const kb = {
    company_name: company_name || 'Company',
    company_url,
    built_at: new Date().toISOString(),
    chunk_count: allChunks.length,
    chunks: allChunks,
  };

  if (email) {
    await saveKB(email, kb);
    await dynamo.send(new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email },
      UpdateExpression: 'SET kb_trained = :t, updated_at = :u',
      ExpressionAttributeValues: { ':t': true, ':u': new Date().toISOString() },
    }));
  }

  return ok({ success: true, kb_chunks: allChunks.length, page_count: 1 });
}

async function handleKBManual(body, cookieHeader, authHeader = '') {
  const { text, email } = body;
  if (!text) return err('text required', 400);
  if (email) {
    const sessionEmail = await getSessionEmail(cookieHeader, authHeader);
    if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) return err('Unauthorized', 401);
  }

  const existing = await loadKB(email) || { company_name: 'Company', chunks: [] };
  const newChunks = chunkText(text).map(t => ({ url: 'manual', text: t }));
  existing.chunks = [...existing.chunks, ...newChunks];
  existing.chunk_count = existing.chunks.length;
  existing.built_at = new Date().toISOString();

  if (email) {
    await saveKB(email, existing);
    await dynamo.send(new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email },
      UpdateExpression: 'SET kb_trained = :t, updated_at = :u',
      ExpressionAttributeValues: { ':t': true, ':u': new Date().toISOString() },
    }));
  }

  return ok({ success: true, kb_chunks: existing.chunks.length });
}

async function handleKBGet(email, cookieHeader, authHeader = '') {
  if (email) {
    const sessionEmail = await getSessionEmail(cookieHeader, authHeader);
    if (!sessionEmail || sessionEmail.toLowerCase() !== email.toLowerCase()) return err('Unauthorized', 401);
  }
  const kb = email ? await loadKB(email) : null;
  if (!kb) return ok({ trained: false, chunks: 0, pages: 0, sources: [], built_at: null });
  const sourceMap = {};
  for (const c of kb.chunks) { sourceMap[c.url] = (sourceMap[c.url] || 0) + 1; }
  return ok({ trained: true, chunks: kb.chunks.length, pages: kb.page_count || 0, built_at: kb.built_at, sources: Object.entries(sourceMap).map(([url, count]) => ({ url, count })) });
}

async function handleKBText(email) {
  const kb = email ? await loadKB(email) : null;
  if (!kb?.chunks?.length) return ok({ kbText: '', trained: false });
  const seen = new Set();
  const kbText = kb.chunks.map(c => c.text).filter(t => { if (seen.has(t)) return false; seen.add(t); return true; }).join('\n\n').slice(0, 6000);
  return ok({ kbText, trained: true, chunks: kb.chunks.length });
}

async function handleAIChat(body) {
  const { systemPrompt, userMessage, maxTokens = 400 } = body;
  if (!userMessage) return err('userMessage required', 400);
  const text = await bedrockChat(systemPrompt, userMessage, maxTokens);
  return ok({ text });
}

async function handleChatWidget(body) {
  const { message, companyEmail } = body;
  if (!message) return err('message required', 400);

  let companyName = 'Our Company', companyUrl = '', bookingUrl = '', kbText = '';

  if (companyEmail) {
    const r = await dynamo.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { email: companyEmail } }));
    if (r.Item) {
      companyName = r.Item.company_name || companyName;
      companyUrl  = r.Item.company_url  || '';
      bookingUrl  = r.Item.booking_url  || '';
    }
    const kb = await loadKB(companyEmail);
    if (kb?.chunks?.length) {
      const queryWords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const broadKw = ['all products','list','what do you','what products','overview','everything','name all'];
      const isBroad = broadKw.some(k => message.toLowerCase().includes(k)) || queryWords.length <= 2;
      if (isBroad) {
        kbText = kb.chunks.map(c => c.text).join('\n\n').slice(0, 6000);
      } else {
        const scored = kb.chunks.map(c => ({ text: c.text, score: queryWords.reduce((s, w) => s + (c.text.toLowerCase().includes(w) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
        kbText = [...scored.filter(c => c.score > 0).slice(0, 5), ...scored.filter(c => c.score === 0).slice(0, 2)].map(c => c.text).join('\n\n').slice(0, 6000);
      }
    }
  }

  const systemPrompt = `You are a helpful AI assistant for ${companyName}. Answer questions about the company, its products and services. Be friendly and concise.${bookingUrl ? `\nTo book a meeting: ${bookingUrl}` : ''}${companyUrl ? `\nWebsite: ${companyUrl}` : ''}\n\nKNOWLEDGE BASE:\n${kbText || 'No knowledge base available.'}`;
  const reply = await bedrockChat(systemPrompt, message, 400);
  return ok({ reply });
}

async function handleAdminLogin(body, ip) {
  if (!checkRateLimit(ip)) return err('Too many attempts', 429);
  const adminPassword = await getParam('admin-password') || process.env.ADMIN_PASSWORD || 'nurturio-admin-2024';
  if (body.password !== adminPassword) return err('Invalid password', 401);

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + 86400;
  await dynamo.send(new PutCommand({ TableName: SESSIONS_TABLE, Item: { token, isAdmin: true, expires } }));
  // Return token in body AND cookie so both S3-hosted and server-hosted frontends work
  return ok(
    { ok: true, token },
    { 'Set-Cookie': setCookieHeader('admin_token', token) }
  );
}

async function handleAdminLogout(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  if (cookies.admin_token) {
    await dynamo.send(new DeleteCommand({ TableName: SESSIONS_TABLE, Key: { token: cookies.admin_token } })).catch(() => {});
  }
  return ok({ ok: true }, { 'Set-Cookie': 'admin_token=; Max-Age=0; Path=/' });
}

async function handleAdminCustomers(cookieHeader, authHeader = '') {
  if (!await getAdminSession(cookieHeader, authHeader)) return err('Unauthorized', 401);
  const r = await dynamo.send(new ScanCommand({ TableName: CUSTOMERS_TABLE }));
  const customers = (r.Items || []).map(c => {
    const safe = { ...c };
    delete safe.password_hash;
    ['crm_password', 'smtp_pass'].forEach(k => { if (safe[k]) safe[k] = '••••••••'; });
    return safe;
  }).sort((a, b) => new Date(b.registered_at || 0) - new Date(a.registered_at || 0));
  return ok({ customers, total: customers.length });
}

async function handleAdminWorkflow(email, type, cookieHeader, authHeader = '') {
  if (!await getAdminSession(cookieHeader, authHeader)) return err('Unauthorized', 401);
  const r = await dynamo.send(new GetCommand({ TableName: CUSTOMERS_TABLE, Key: { email } }));
  if (!r.Item) return err('Customer not found', 404);

  const c = r.Item;
  const kb = await loadKB(email);
  const kbText = (kb?.chunks || []).map(ch => ch.text).join('\n\n').slice(0, 3000).replace(/`/g, "'");

  // Load template workflow from S3 or return a basic one
  const wfTemplate = JSON.stringify(require('./workflow-template.json'));
  let wf = wfTemplate
    .replace(/rupaliii739@gmail\.com/g, c.crm_user || '')
    .replace(/Rupali1103@@/g, c.crm_password || '')
    .replace(/34\.196\.221\.16:8000/g, (c.crm_base_url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))
    .replace(/SLACK_WEBHOOK_PLACEHOLDER/g, c.slack_webhook || '')
    .replace(/"7336265543"/g, `"${c.telegram_chat_id || ''}"`)
    .replace(/https:\/\/calendar\.app\.google\/HgnRmYThZYLo7Ya98/g, c.booking_url || '')
    .replace(/https:\/\/digitransolutions\.in/g, c.company_url || '')
    .replace(/Digitrans Solutions/g, c.company_name || '')
    .replace(/\{\{COMPANY_KB_PLACEHOLDER\}\}/g, kbText);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${email.replace('@','_')}-${type}-workflow.json"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: wf,
  };
}

async function handleTelegramWebhook(body) {
  const { message } = body;
  if (!message) return ok({});

  const botToken = await getParam('lead-bot-token') || process.env.LEAD_BOT_TOKEN;
  if (!botToken) return ok({});

  const text     = message?.text || '';
  const chatId   = message?.chat?.id;
  const fromName = message?.from?.first_name || 'there';
  if (!chatId) return ok({});

  // Find which customer this bot belongs to (scan for matching bot token)
  // For now use global KB
  const kb = null; // Could scan DynamoDB for customer with this bot token
  const kbText = '';

  const systemPrompt = `You are a helpful AI assistant. Answer questions about our products and services. Be friendly and concise.\n\nKNOWLEDGE BASE:\n${kbText || 'No knowledge base available.'}`;

  let replyText;
  if (text.startsWith('/start')) {
    replyText = `Hi ${fromName}! 👋\n\nI'm your AI assistant. Ask me anything about our products and services!`;
  } else if (text && !text.startsWith('/')) {
    replyText = await bedrockChat(systemPrompt, text, 200).catch(() => 'Thanks for your message! Visit our website for more info.');
  } else {
    return ok({});
  }

  // Send Telegram reply
  const tgBody = JSON.stringify({ chat_id: chatId, text: replyText });
  await new Promise((resolve) => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${botToken}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tgBody) } }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(tgBody);
    req.end();
  });

  return ok({});
}

// ── Website crawler ──────────────────────────────────────
async function crawlUrl(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const text = data
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim();
        resolve(chunkText(text));
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

// ── Main handler ─────────────────────────────────────────
exports.handler = async (event) => {
  const method  = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path    = event.requestContext?.http?.path   || event.path || '/';
  const body    = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
  const parsed  = (() => { try { return JSON.parse(body); } catch { return {}; } })();
  const qs      = event.queryStringParameters || {};
  const cookies = event.headers?.cookie || event.headers?.Cookie || '';
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const ip      = event.requestContext?.http?.sourceIp || '0.0.0.0';

  // CORS preflight
  if (method === 'OPTIONS') return resp(200, '', { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Cookie', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });

  try {
    // Customer auth
    if (method === 'POST' && path === '/api/customer/register') return await handleCustomerRegister(parsed);
    if (method === 'POST' && path === '/api/customer/login')    return await handleCustomerLogin(parsed, ip);
    if (method === 'POST' && path === '/api/customer/logout')   return await handleCustomerLogout(cookies);
    if (method === 'GET'  && path === '/api/customer/profile')  return await handleGetProfile(qs.email, cookies, authHeader);
    if (method === 'PUT'  && path === '/api/customer/profile')  return await handleUpdateProfile(parsed, cookies, authHeader);

    // Knowledge base
    if (method === 'POST'   && path === '/api/kb/train')  return await handleKBTrain(parsed, cookies, authHeader);
    if (method === 'POST'   && path === '/api/kb/manual') return await handleKBManual(parsed, cookies, authHeader);
    if (method === 'GET'    && path === '/api/kb')        return await handleKBGet(qs.email, cookies, authHeader);
    if (method === 'GET'    && path === '/api/kb/text')   return await handleKBText(qs.email);

    // AI
    if (method === 'POST' && path === '/api/ai/chat')       return await handleAIChat(parsed);
    if (method === 'POST' && path === '/api/chat/widget')   return await handleChatWidget(parsed);

    // Admin
    if (method === 'POST' && path === '/api/admin/login')   return await handleAdminLogin(parsed, ip);
    if (method === 'POST' && path === '/api/admin/logout')  return await handleAdminLogout(cookies);
    if (method === 'GET'  && path === '/api/admin/customers') return await handleAdminCustomers(cookies, authHeader);
    if (method === 'GET'  && path.startsWith('/api/admin/customers/') && path.endsWith('/workflow')) {
      const parts = path.split('/');
      const email = decodeURIComponent(parts[4]);
      const type  = qs.type || 'lead-nurturing';
      return await handleAdminWorkflow(email, type, cookies, authHeader);
    }

    // Telegram
    if (method === 'POST' && path === '/telegram/webhook') return await handleTelegramWebhook(parsed);

    return err('Not found', 404);
  } catch (e) {
    console.error('[API]', e.message, e.stack);
    return err(e.message);
  }
};
