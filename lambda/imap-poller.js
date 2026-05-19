/**
 * lambda/imap-poller.js
 * EventBridge-triggered Lambda — polls IMAP every 5 minutes.
 * Reads customer configs from DynamoDB, auto-replies to lead emails using Bedrock.
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const tls      = require('tls');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');

const REGION          = process.env.AWS_REGION || 'us-east-1';
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'nurturio-customers';
const KB_BUCKET       = process.env.KB_BUCKET || 'nurturio-kb';
const REPLIED_TABLE   = process.env.REPLIED_TABLE || 'nurturio-sessions'; // reuse sessions table with prefix

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3     = new S3Client({ region: REGION });
const ssm    = new SSMClient({ region: REGION });

let _ssmCache = {};
async function getParam(name) {
  if (_ssmCache[name]) return _ssmCache[name];
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: `/nurturio/${name}`, WithDecryption: true }));
    _ssmCache[name] = r.Parameter.Value;
    return _ssmCache[name];
  } catch { return process.env[name.toUpperCase().replace(/-/g,'_')] || ''; }
}

async function loadKB(email) {
  try {
    const key = `customers/${email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}-kb.json`;
    const r = await s3.send(new GetObjectCommand({ Bucket: KB_BUCKET, Key: key }));
    return JSON.parse(await r.Body.transformToString());
  } catch { return null; }
}

function searchKB(kb, query, topN = 4) {
  if (!kb?.chunks?.length) return [];
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return kb.chunks
    .map(c => ({ text: c.text, score: words.reduce((s, w) => s + (c.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(c => c.text);
}

async function hasReplied(messageId) {
  try {
    const r = await dynamo.send(new GetCommand({ TableName: REPLIED_TABLE, Key: { token: `replied:${messageId}` } }));
    return !!r.Item;
  } catch { return false; }
}

async function markReplied(messageId) {
  const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 days
  await dynamo.send(new PutCommand({ TableName: REPLIED_TABLE, Item: { token: `replied:${messageId}`, expires } }));
}

async function fetchUnseenEmails({ imapHost, imapPort = 993, imapUser, imapPass }) {
  return new Promise((resolve) => {
    const emails = [];
    let buffer = '', state = 'connecting', currentEmail = null;
    const socket = tls.connect({ host: imapHost, port: imapPort }, () => {});
    socket.setTimeout(20000);
    socket.on('timeout', () => { socket.destroy(); resolve(emails); });
    socket.on('error', () => resolve(emails));
    const send = cmd => socket.write(cmd + '\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (state === 'connecting' && line.includes('OK')) { state = 'login'; send(`A001 LOGIN "${imapUser}" "${imapPass}"`); }
        else if (state === 'login' && line.includes('A001 OK')) { state = 'select'; send('A002 SELECT INBOX'); }
        else if (state === 'select' && line.includes('A002 OK')) { state = 'search'; send('A003 SEARCH UNSEEN'); }
        else if (state === 'search' && line.startsWith('* SEARCH')) {
          const ids = line.replace('* SEARCH', '').trim().split(' ').filter(Boolean);
          if (!ids.length) { state = 'logout'; send('A005 LOGOUT'); }
          else { state = 'fetch'; send(`A004 FETCH ${ids.slice(0, 10).join(',')} (BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID IN-REPLY-TO)] BODY[TEXT])`); }
        } else if (state === 'fetch') {
          if (line.startsWith('* ') && line.includes('FETCH')) currentEmail = { from: '', subject: '', messageId: '', body: '', inReplyTo: '' };
          else if (currentEmail) {
            if (line.startsWith('From:'))        currentEmail.from       = line.replace('From:', '').trim();
            if (line.startsWith('Subject:'))     currentEmail.subject    = line.replace('Subject:', '').trim();
            if (line.startsWith('Message-ID:'))  currentEmail.messageId  = line.replace('Message-ID:', '').trim();
            if (line.startsWith('In-Reply-To:')) currentEmail.inReplyTo  = line.replace('In-Reply-To:', '').trim();
            if (line === ')' && currentEmail.from) { emails.push({ ...currentEmail }); currentEmail = null; }
            if (currentEmail && !['From:', 'Subject:', 'Message-ID:', 'In-Reply-To:'].some(h => line.startsWith(h)) && !line.startsWith('* ') && !line.startsWith('A004')) {
              currentEmail.body = (currentEmail.body || '') + line + '\n';
            }
          }
          if (line.includes('A004 OK')) { state = 'logout'; send('A005 LOGOUT'); }
        } else if (state === 'logout' && line.includes('BYE')) { socket.destroy(); resolve(emails); }
      }
    });
  });
}

async function bedrockReply(systemPrompt, userMessage) {
  const accessKey = await getParam('aws-access-key') || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = await getParam('aws-secret-key') || process.env.AWS_SECRET_ACCESS_KEY;
  const modelId   = await getParam('bedrock-model-id') || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  const { bedrockChat } = require('./bedrock-client');
  return bedrockChat({ accessKey, secretKey, region: REGION, modelId, systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 250 });
}

exports.handler = async () => {
  console.log('[IMAP Poller] Starting...');

  // Scan all customers with IMAP configured
  const scan = await dynamo.send(new ScanCommand({
    TableName: CUSTOMERS_TABLE,
    FilterExpression: 'attribute_exists(imap_host) AND imap_host <> :empty',
    ExpressionAttributeValues: { ':empty': '' },
  }));

  const customers = scan.Items || [];
  console.log(`[IMAP Poller] Found ${customers.length} customers with IMAP`);

  for (const customer of customers) {
    try {
      const emails = await fetchUnseenEmails({
        imapHost: customer.imap_host,
        imapUser: customer.imap_user || customer.smtp_user,
        imapPass: customer.imap_pass || customer.smtp_pass,
      });

      const kb = await loadKB(customer.email);

      for (const email of emails) {
        if (!email.inReplyTo && !email.subject?.toLowerCase().startsWith('re:')) continue;
        if (!email.from || email.from.includes(customer.smtp_user)) continue;
        if (/auto.?reply|out of office|vacation|noreply/i.test(email.subject + email.from)) continue;
        if (await hasReplied(email.messageId)) continue;

        const fromMatch = email.from.match(/^(.+?)\s*</);
        const leadName  = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : 'there';
        const leadEmail = (email.from.match(/<(.+?)>/) || [])[1] || email.from;

        const kbContext = searchKB(kb, email.body || email.subject, 4).join('\n\n')
          || `${customer.company_name} — visit ${customer.company_url}`;

        const systemPrompt = `You are a helpful sales assistant for ${customer.company_name}.\nReply to this lead email warmly and professionally (under 120 words).\nOnly answer questions about ${customer.company_name}.\nDo NOT mention pricing — direct them to the website.\nEnd with a clear call-to-action.\nSign off as "${customer.company_name} Team".\n\nCOMPANY KNOWLEDGE:\n${kbContext}\n\nWEBSITE: ${customer.company_url}\nBOOK A CALL: ${customer.booking_url || customer.company_url}`;

        const aiReply = await bedrockReply(systemPrompt, `Lead: ${leadName}\nEmail: ${leadEmail}\n\nTheir reply:\n${(email.body || '').slice(0, 500)}\n\nWrite a reply:`);

        // Send reply via SMTP
        const transporter = nodemailer.createTransport({
          host: customer.smtp_host || 'smtp.gmail.com',
          port: parseInt(customer.smtp_port || '587'),
          secure: false,
          auth: { user: customer.smtp_user, pass: customer.smtp_pass },
        });

        await transporter.sendMail({
          from: customer.smtp_user,
          to: leadEmail,
          subject: email.subject?.startsWith('Re:') ? email.subject : 'Re: ' + email.subject,
          text: aiReply,
          inReplyTo: email.messageId,
          references: email.messageId,
        });

        await markReplied(email.messageId);
        console.log(`[IMAP Poller] Auto-replied to ${leadEmail} for customer ${customer.email}`);
      }
    } catch (e) {
      console.error(`[IMAP Poller] Error for ${customer.email}:`, e.message);
    }
  }

  return { replied: true };
};
