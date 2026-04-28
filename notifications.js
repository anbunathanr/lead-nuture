const nodemailer = require('nodemailer');
const twilio     = require('twilio');

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function log(channel, msg) {
  console.log(`  [${channel}] ${msg}`);
}

function getTwilio() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function getMailTransport() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

  if (!smtpHost || !smtpUser || !smtpPass) return null;

  return nodemailer.createTransport({
    host:   smtpHost,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: smtpUser, pass: smtpPass }
  });
}

const CALENDLY = 'https://calendly.com/digitrans-solutions';
const WEBSITE  = 'https://digitransolutions.in';
const COMPANY  = 'Digitrans Solutions';

// ─────────────────────────────────────────────────────────
//  SLACK  (team only)
// ─────────────────────────────────────────────────────────
async function notifySlack(lead, products, type = 'instant') {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return log('Slack', 'skipped — no webhook');

  const isHot  = lead.lead_status === 'HOT';
  const emoji  = isHot ? '🔥' : '🟠';
  const urgent = isHot ? '🚨 Contact within 5 minutes!' : '💡 Send demo invite today!';

  const nudgeNote = type === 'followup'
    ? `\n⏰ *FOLLOW-UP #${lead.followup_count || 1} — No response yet!*` : '';

  const text = `${emoji} *${lead.lead_status} LEAD${type === 'followup' ? ' — FOLLOW UP' : ''}*${nudgeNote}\n\n` +
    `👤 *${lead.name}*\n📧 ${lead.email}\n📱 ${lead.phone || 'N/A'}\n` +
    `🏢 ${lead.company || 'N/A'} (${lead.role || 'N/A'})\n` +
    `🛍️ *Products:* ${products}\n⚡ Score: ${lead.login_count}/10\n\n` +
    `${urgent}\n📅 ${CALENDLY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  log('Slack', res.ok ? '✅ sent' : `❌ failed (${res.status})`);
}

// ─────────────────────────────────────────────────────────
//  TELEGRAM  (team only)
// ─────────────────────────────────────────────────────────
async function notifyTelegram(lead, products, type = 'instant') {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return log('Telegram', 'skipped — no credentials');

  const emoji = lead.lead_status === 'HOT' ? '🔥' : '🟠';
  const nudge = type === 'followup' ? ` — FOLLOW UP #${lead.followup_count || 1}` : '';

  const text = `${emoji} *${lead.lead_status} LEAD${nudge}*\n\n` +
    `👤 *${lead.name}*\n📧 ${lead.email}\n📱 ${lead.phone || 'N/A'}\n` +
    `🏢 ${lead.company || 'N/A'}\n🛍️ ${products}\n⚡ Score: ${lead.login_count}/10\n\n` +
    `📅 ${CALENDLY}`;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) }
  );
  const d = await res.json();
  log('Telegram', d.ok ? '✅ sent' : `❌ ${d.description}`);
}

// ─────────────────────────────────────────────────────────
//  EMAIL  (customer)
// ─────────────────────────────────────────────────────────
const EMAIL_TEMPLATES = {

  HOT_instant: (lead, products) => ({
    subject: `🔥 ${lead.name}, you're one step away — let's talk today!`,
    text: `Hi ${lead.name},

We just saw your interest in ${products} — and honestly, you're exactly who we built this for.

🚀 What you get with ${products}:
✅ Immediate results from Day 1
✅ Dedicated onboarding support
✅ ROI within the first month
✅ Used by 500+ companies worldwide

💡 Companies like yours have seen:
• 3x faster workflows
• 60% reduction in manual effort
• Massive cost savings

You're clearly serious — so are we.

👉 Book a 15-minute call RIGHT NOW (limited slots):
${CALENDLY}

Or reply to this email — I'll personally reach out within the hour.

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  HOT_followup1: (lead, products) => ({
    subject: `⏰ ${lead.name}, still thinking? Here's what you're missing...`,
    text: `Hi ${lead.name},

I noticed you haven't booked your call yet — I just wanted to make sure you didn't miss out.

You showed interest in ${products}, and I genuinely believe it can transform how you work.

🎯 Here's what one of our customers said last week:
"I wish I had started sooner. The results were immediate." — Founder, TechStartup

⏳ Our calendar is filling up fast this week.

👉 Grab your slot before it's gone:
${CALENDLY}

If you have any questions, just reply — I'm here.

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  HOT_followup2: (lead, products) => ({
    subject: `🚨 Last chance, ${lead.name} — closing your enquiry tomorrow`,
    text: `Hi ${lead.name},

This is my final follow-up regarding your interest in ${products}.

I don't want to keep bothering you — but I also don't want you to miss out on something that could genuinely help you.

If you're still interested, let's talk:
👉 ${CALENDLY}

If the timing isn't right, no worries at all — just reply and let me know. I'll keep your details and reach out when you're ready.

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  WARM_instant: (lead, products) => ({
    subject: `📅 ${lead.name}, see ${products.split(',')[0]} in action — free demo inside`,
    text: `Hi ${lead.name},

Thanks for checking out ${products} — great choice!

We'd love to show you exactly what it can do for you in a free, personalised demo.

🎯 In just 20 minutes you'll see:
✅ Live demo tailored to your exact use case
✅ How ${products.split(',')[0]} solves your specific problem
✅ Pricing options that fit your budget
✅ How to get started immediately

🏆 What our customers say:
"This saved us 10 hours a week" — Product Manager, TechCorp
"Best investment we made this year" — Founder, StartupXYZ

👉 Schedule your FREE demo now:
${CALENDLY}

Spots are limited — book yours today!

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  WARM_followup1: (lead, products) => ({
    subject: `👋 ${lead.name}, did you get a chance to check our demo?`,
    text: `Hi ${lead.name},

Just checking in — did you get a chance to look at the demo for ${products}?

I know things get busy, so I wanted to make it even easier for you.

Here's a quick 2-minute overview of what ${products.split(',')[0]} does:
🎥 ${WEBSITE}/demo

And when you're ready for a personalised walkthrough:
👉 ${CALENDLY}

No pressure — just here to help!

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  WARM_followup2: (lead, products) => ({
    subject: `🎁 Special offer for you, ${lead.name} — expires this week`,
    text: `Hi ${lead.name},

I wanted to reach out one more time with something special.

For leads who book a demo this week, we're offering:
🎁 Extended free trial
🎁 Priority onboarding support
🎁 First month at a special rate

This is specifically for ${products} — which you showed interest in.

👉 Book your demo and claim this offer:
${CALENDLY}

This offer expires at the end of this week.

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  COLD_instant: (lead, products) => ({
    subject: `👋 Welcome, ${lead.name}! Here's everything you need to get started`,
    text: `Hi ${lead.name},

Welcome! We're really glad you found us.

You explored ${products} — here's everything you need to know:

🚀 What ${COMPANY} offers:
✅ AI-powered products built for real-world problems
✅ Free trials available — no credit card needed
✅ Expert support team always available
✅ Used by 500+ companies and individuals

📖 Explore all products: ${WEBSITE}
🎥 Watch a quick demo: ${WEBSITE}/demo

💬 Have questions? Just reply to this email — we read every message.

When you're ready to take the next step:
👉 Book a free consultation: ${CALENDLY}

Looking forward to helping you!

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  COLD_followup1: (lead, products) => ({
    subject: `💡 ${lead.name}, here's how others are using ${products.split(',')[0]}`,
    text: `Hi ${lead.name},

Hope you're doing well!

I wanted to share how people just like you are using ${products.split(',')[0]}:

📌 Student use case: "Used it for my final year project — got an A+"
📌 Freelancer use case: "Saved 5 hours per client project"
📌 Business use case: "Automated our entire workflow in 2 days"

Curious to see how it could work for you?

👉 Book a free 20-minute call: ${CALENDLY}

Or just reply with your use case and I'll give you a personalised recommendation.

Best,
${COMPANY} Team
${WEBSITE}`
  }),

  COLD_followup2: (lead, products) => ({
    subject: `🌟 ${lead.name}, we'd love to hear from you`,
    text: `Hi ${lead.name},

It's been a while since you checked out ${products}.

We're always improving our products based on feedback — and we'd love to know:

❓ What were you looking for?
❓ Did you find what you needed?
❓ Is there anything we can help with?

Just reply to this email — even a one-line answer helps us a lot.

And if you're ready to explore again:
👉 ${WEBSITE}

Best,
${COMPANY} Team
${WEBSITE}`
  }),
};

async function sendEmail(lead, products, templateKey) {
  const transport = getMailTransport();
  if (!transport) {
    return log('Email', 'skipped — set SMTP_HOST + SMTP_USER/GMAIL_USER + SMTP_PASS/GMAIL_APP_PASSWORD');
  }

  const tmpl = EMAIL_TEMPLATES[templateKey];
  if (!tmpl) return log('Email', `skipped — unknown template: ${templateKey}`);

  const { subject, text } = tmpl(lead, products);

  try {
    const fromUser = process.env.SMTP_USER || process.env.GMAIL_USER;

    await transport.sendMail({
      from: `"${COMPANY}" <${fromUser}>`,
      to:   lead.email,
      subject,
      text,
    });
    log('Email', `✅ sent [${templateKey}] to ${lead.email}`);
  } catch (e) {
    log('Email', `❌ ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────
//  WHATSAPP  (customer — via Twilio)
// ─────────────────────────────────────────────────────────
const WHATSAPP_TEMPLATES = {
  HOT_instant: (lead, products) =>
    `Hi ${lead.name}! 👋\n\nWe saw your interest in *${products}* — we'd love to connect!\n\n🔥 You're a perfect fit for what we offer.\n\n📅 Book a quick call here:\n${CALENDLY}\n\n— ${COMPANY}`,

  WARM_instant: (lead, products) =>
    `Hi ${lead.name}! 👋\n\nThanks for checking out *${products}* — we'd love to show you a free demo.\n\n📅 Schedule your personalised walkthrough here:\n${CALENDLY}\n\n— ${COMPANY}`,

  HOT_followup1: (lead, products) =>
    `Hi ${lead.name}! ⏰\n\nJust following up on your interest in *${products}*.\n\nStill interested? Let's talk!\n👉 ${CALENDLY}\n\n— ${COMPANY}`,

  WARM_followup1: (lead, products) =>
    `Hi ${lead.name}! 👋\n\nDid you get a chance to check out *${products}*?\n\nWe'd love to show you a free demo!\n📅 ${CALENDLY}\n\n— ${COMPANY}`,

  WARM_followup2: (lead, products) =>
    `Hi ${lead.name}! 🎁\n\nSpecial offer this week for *${products}* — extended free trial + priority support!\n\nBook before it expires:\n👉 ${CALENDLY}\n\n— ${COMPANY}`,
};

function normalizePhone(phone) {
  if (!phone) return null;
  let raw = String(phone).trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith('+');
  raw = raw.replace(/[^\d]/g, '');
  if (!raw) return null;

  if (hasPlus) return '+' + raw;
  if (raw.length === 10) return '+91' + raw;
  if (raw.length === 11 && raw.startsWith('0')) return '+' + raw.slice(1);
  return '+' + raw;
}

async function sendWhatsApp(lead, products, templateKey) {
  const client = getTwilio();
  const from   = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !from) return log('WhatsApp', 'skipped — no Twilio credentials');
  if (!lead.phone) return log('WhatsApp', 'skipped — no phone number');

  const tmpl = WHATSAPP_TEMPLATES[templateKey];
  if (!tmpl) return log('WhatsApp', `skipped — unknown template: ${templateKey}`);

  const normalized = normalizePhone(lead.phone);
  if (!normalized) return log('WhatsApp', 'skipped — invalid phone number');

  const to     = `whatsapp:${normalized}`;
  const body   = tmpl(lead, products);

  try {
    const msg = await client.messages.create({ from, to, body });
    log('WhatsApp', `✅ sent [${templateKey}] to ${to} sid:${msg.sid}`);
  } catch (e) {
    log('WhatsApp', `❌ ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────
//  SMS  (customer — HOT only, via Twilio)
// ─────────────────────────────────────────────────────────
async function sendSMS(lead, products) {
  const client = getTwilio();
  const from   = process.env.TWILIO_SMS_FROM;
  if (!client || !from) return log('SMS', 'skipped — no Twilio credentials');
  if (!lead.phone) return log('SMS', 'skipped — no phone number');

  const normalized = normalizePhone(lead.phone);
  if (!normalized) return log('SMS', 'skipped — invalid phone number');

  const body   = `Hi ${lead.name}! Digitrans Solutions here. You showed interest in ${products.split(',')[0]}. Book a free call: ${CALENDLY}`;

  try {
    const msg = await client.messages.create({ from, to: normalized, body });
    log('SMS', `✅ sent to ${normalized} sid:${msg.sid}`);
  } catch (e) {
    log('SMS', `❌ ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────
//  SCHEDULE FOLLOW-UPS  (stores in DB)
// ─────────────────────────────────────────────────────────
async function scheduleFollowups(pool, lead, products) {
  const schedules = {
    HOT: [
      { days: 1,  channel: 'email',     type: 'HOT_followup1' },
      { days: 2,  channel: 'whatsapp',  type: 'HOT_followup2' },
    ],
    WARM: [
      { days: 1,  channel: 'email',     type: 'WARM_followup1' },
      { days: 2,  channel: 'whatsapp',  type: 'WARM_followup2' },
    ],
    COLD: [
      { days: 1,  channel: 'email',     type: 'COLD_followup1' },
      { days: 2,  channel: 'email',     type: 'COLD_followup2' },
    ],
  };

  const plan = schedules[lead.lead_status] || [];
  for (const s of plan) {
    const scheduledAt = new Date(Date.now() + s.days * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO followups (lead_id, channel, message_type, scheduled_at)
       VALUES ($1, $2, $3, $4)`,
      [lead.id, s.channel, s.type, scheduledAt]
    );
  }
  log('Scheduler', `✅ ${plan.length} follow-ups scheduled for ${lead.lead_status} lead`);
}

// ─────────────────────────────────────────────────────────
//  PROCESS DUE FOLLOW-UPS  (called every 5 min by cron)
// ─────────────────────────────────────────────────────────
async function processDueFollowups(pool) {
  const due = await pool.query(`
    SELECT f.*, l.name, l.email, l.phone, l.company, l.role,
           l.product, l.lead_status, l.login_count
    FROM followups f
    JOIN leads l ON l.id = f.lead_id
    WHERE f.status = 'pending' AND f.scheduled_at <= NOW()
    ORDER BY f.scheduled_at ASC
    LIMIT 20
  `);

  if (!due.rows.length) return;
  console.log(`\n⏰ Processing ${due.rows.length} due follow-ups...`);

  for (const row of due.rows) {
    const products = row.product || 'our products';
    try {
      if (row.channel === 'email')    await sendEmail(row, products, row.message_type);
      if (row.channel === 'whatsapp') await sendWhatsApp(row, products, row.message_type);
      if (row.channel === 'slack')    await notifySlack(row, products, 'followup');
      if (row.channel === 'telegram') await notifyTelegram(row, products, 'followup');

      await pool.query(
        `UPDATE followups SET status='sent', sent_at=NOW() WHERE id=$1`,
        [row.id]
      );
    } catch (e) {
      console.error(`  [followup ${row.id}] ❌ ${e.message}`);
      await pool.query(
        `UPDATE followups SET status='failed' WHERE id=$1`,
        [row.id]
      );
    }
  }
}

// ─────────────────────────────────────────────────────────
//  MAIN DISPATCHER
//  n8n handles: Slack, Telegram, Email
//  notifications.js handles: WhatsApp, SMS only
// ─────────────────────────────────────────────────────────
async function dispatchAlerts(lead, products, pool) {
  console.log(`\n📣 Dispatching [${lead.lead_status}] alerts for: ${lead.name}`);
  console.log('   n8n handles Slack/Telegram/Email/WhatsApp/SMS');
}

module.exports = { dispatchAlerts, processDueFollowups };
