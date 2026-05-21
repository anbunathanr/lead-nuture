/**
 * ai/imap-poller.js
 * Polls Gmail/IMAP inbox for replies to outreach emails.
 * Uses AWS Bedrock (Claude) to generate AI replies.
 */

const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const { bedrockChat } = require('./bedrock-client');
const { searchKB }    = require('./knowledge-base');

const REPLIED_FILE = path.join(__dirname, '../data/replied-emails.json');

function loadReplied() {
  if (!fs.existsSync(REPLIED_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(REPLIED_FILE, 'utf8')));
}

function saveReplied(set) {
  fs.mkdirSync(path.dirname(REPLIED_FILE), { recursive: true });
  fs.writeFileSync(REPLIED_FILE, JSON.stringify([...set]));
}

async function fetchUnseenEmails({ imapHost, imapPort = 993, imapUser, imapPass }) {
  return new Promise((resolve) => {
    const emails = [];
    let buffer = '';
    let state  = 'connecting';
    let currentEmail = null;

    const socket = tls.connect({ host: imapHost, port: imapPort }, () => {});
    socket.setTimeout(20000);
    socket.on('timeout', () => { socket.destroy(); resolve(emails); });
    socket.on('error', () => resolve(emails));

    function send(cmd) { socket.write(cmd + '\r\n'); }

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (state === 'connecting' && line.includes('OK')) {
          state = 'login';
          send(`A001 LOGIN "${imapUser}" "${imapPass}"`);
        } else if (state === 'login' && line.includes('A001 OK')) {
          state = 'select';
          send('A002 SELECT INBOX');
        } else if (state === 'select' && line.includes('A002 OK')) {
          state = 'search';
          send('A003 SEARCH UNSEEN');
        } else if (state === 'search' && line.startsWith('* SEARCH')) {
          const ids = line.replace('* SEARCH', '').trim().split(' ').filter(Boolean);
          if (ids.length === 0) { state = 'logout'; send('A005 LOGOUT'); }
          else { state = 'fetch'; send(`A004 FETCH ${ids.slice(0, 10).join(',')} (BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID IN-REPLY-TO)] BODY[TEXT])`); }
        } else if (state === 'fetch') {
          if (line.startsWith('* ') && line.includes('FETCH')) {
            currentEmail = { from: '', subject: '', messageId: '', body: '', inReplyTo: '' };
          } else if (currentEmail) {
            if (line.startsWith('From:'))        currentEmail.from       = line.replace('From:', '').trim();
            if (line.startsWith('Subject:'))     currentEmail.subject    = line.replace('Subject:', '').trim();
            if (line.startsWith('Message-ID:'))  currentEmail.messageId  = line.replace('Message-ID:', '').trim();
            if (line.startsWith('In-Reply-To:')) currentEmail.inReplyTo  = line.replace('In-Reply-To:', '').trim();
            if (line === ')' && currentEmail.from) { emails.push({ ...currentEmail }); currentEmail = null; }
            if (currentEmail && !line.startsWith('From:') && !line.startsWith('Subject:') &&
                !line.startsWith('Message-ID:') && !line.startsWith('In-Reply-To:') &&
                !line.startsWith('* ') && !line.startsWith('A004')) {
              currentEmail.body = (currentEmail.body || '') + line + '\n';
            }
          }
          if (line.includes('A004 OK')) { state = 'logout'; send('A005 LOGOUT'); }
        } else if (state === 'logout' && line.includes('BYE')) {
          socket.destroy(); resolve(emails);
        }
      }
    });
  });
}

async function sendEmailReply({ smtpHost, smtpPort = 587, smtpUser, smtpPass, fromEmail, toEmail, subject, body, inReplyTo }) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtpHost, port: smtpPort, secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });
  await transporter.sendMail({
    from: fromEmail, to: toEmail,
    subject: subject.startsWith('Re:') ? subject : 'Re: ' + subject,
    text: body, inReplyTo, references: inReplyTo,
  });
}

async function pollAndReply({
  imapHost, imapUser, imapPass,
  smtpHost, smtpPort, smtpUser, smtpPass, fromEmail,
  companyName, companyUrl, bookingUrl,
  awsAccessKey, awsSecretKey, awsRegion, bedrockModelId,
}) {
  if (!imapHost || !imapUser || !imapPass) {
    console.log('[IMAP] Skipped — IMAP not configured');
    return { replied: 0 };
  }

  const replied = loadReplied();
  let count = 0;

  try {
    const emails = await fetchUnseenEmails({ imapHost, imapUser, imapPass });
    console.log(`[IMAP] Found ${emails.length} unseen emails`);

    for (const email of emails) {
      if (!email.inReplyTo || replied.has(email.messageId)) continue;
      if (!email.from || email.from.includes(fromEmail)) continue;

      const fromMatch = email.from.match(/^(.+?)\s*</);
      const leadName  = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : 'there';
      const leadEmail = (email.from.match(/<(.+?)>/) || [])[1] || email.from;

      const relevantChunks = searchKB(email.body || email.subject, 4);
      const kbContext = relevantChunks.join('\n\n') || `${companyName} — visit ${companyUrl}`;

      const systemPrompt =
        `You are a helpful sales assistant for ${companyName}.\n` +
        `Reply to this lead's email in a warm, professional, concise way (under 120 words).\n` +
        `Only answer questions about ${companyName}.\n` +
        `Do NOT mention pricing — direct them to the website.\n` +
        `End with a clear call-to-action.\n` +
        `Sign off as "${companyName} Team".\n\n` +
        `COMPANY KNOWLEDGE:\n${kbContext}\n\n` +
        `WEBSITE: ${companyUrl}\nBOOK A CALL: ${bookingUrl || companyUrl}`;

      const aiReply = await bedrockChat({
        accessKey:  awsAccessKey  || process.env.AWS_ACCESS_KEY_ID,
        secretKey:  awsSecretKey  || process.env.AWS_SECRET_ACCESS_KEY,
        region:     awsRegion     || process.env.AWS_REGION     || 'us-east-1',
        modelId:    bedrockModelId || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0',
        systemPrompt,
        messages: [{
          role:    'user',
          content: `Lead: ${leadName}\nEmail: ${leadEmail}\n\nTheir reply:\n${(email.body || '').slice(0, 500)}\n\nWrite a reply:`,
        }],
        maxTokens: 250,
      });

      await sendEmailReply({
        smtpHost, smtpPort, smtpUser, smtpPass, fromEmail,
        toEmail: leadEmail, subject: email.subject,
        body: aiReply, inReplyTo: email.messageId,
      });

      replied.add(email.messageId);
      count++;
      console.log(`[IMAP] Auto-replied to ${leadEmail}`);
    }

    saveReplied(replied);
  } catch (err) {
    console.error('[IMAP] Poll error:', err.message);
  }

  return { replied: count };
}

module.exports = { pollAndReply };
