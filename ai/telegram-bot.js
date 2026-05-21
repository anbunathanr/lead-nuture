/**
 * ai/telegram-bot.js
 * Handles incoming Telegram messages from leads.
 * Uses AWS Bedrock (Claude) + company knowledge base to reply.
 */

const https = require('https');
const { bedrockChat } = require('./bedrock-client');
const { searchKB }    = require('./knowledge-base');

/**
 * Sends a Telegram message via Bot API.
 */
async function sendTelegramMessage(botToken, chatId, text, parseMode = '') {
  const body = JSON.stringify({
    chat_id:    chatId,
    text,
    parse_mode: parseMode || undefined,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${botToken}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sets the Telegram webhook URL.
 */
async function setTelegramWebhook(botToken, webhookUrl) {
  const body = JSON.stringify({ url: webhookUrl });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${botToken}/setWebhook`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Handles an incoming lead message and replies using Bedrock AI.
 */
async function handleLeadMessage({
  message, botToken,
  companyName, companyUrl, bookingUrl,
  awsAccessKey, awsSecretKey, awsRegion, bedrockModelId,
}) {
  const text     = message?.text || '';
  const chatId   = message?.chat?.id;
  const fromName = message?.from?.first_name || 'there';

  if (!chatId) return;

  // Handle /start
  if (text.startsWith('/start')) {
    await sendTelegramMessage(botToken, chatId,
      `Hi ${fromName}! 👋\n\nI'm the AI assistant for *${companyName}*.\n\nAsk me anything about our products, services, or how we can help you!\n\n🌐 ${companyUrl}`,
      'Markdown'
    );
    return;
  }

  if (!text || text.startsWith('/')) return;

  // Search KB for relevant context
  const relevantChunks = searchKB(text, 4);
  const kbContext = relevantChunks.length > 0
    ? relevantChunks.join('\n\n')
    : `${companyName} — visit ${companyUrl} for more information.`;

  const systemPrompt =
    `You are a helpful AI assistant for ${companyName}.\n` +
    `Answer questions about ${companyName} products and services ONLY.\n` +
    `Keep replies under 100 words. Be warm and helpful.\n` +
    `Do NOT mention pricing — direct them to the website.\n` +
    `End with a call-to-action when appropriate.\n` +
    `Sign off as "${companyName} Team".\n\n` +
    `COMPANY KNOWLEDGE:\n${kbContext}\n\n` +
    `WEBSITE: ${companyUrl}\nBOOK A CALL: ${bookingUrl || companyUrl}`;

  try {
    const reply = await bedrockChat({
      accessKey:  awsAccessKey  || process.env.AWS_ACCESS_KEY_ID,
      secretKey:  awsSecretKey  || process.env.AWS_SECRET_ACCESS_KEY,
      region:     awsRegion     || process.env.AWS_REGION      || 'us-east-1',
      modelId:    bedrockModelId || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      systemPrompt,
      messages: [{ role: 'user', content: text }],
      maxTokens: 200,
    });

    await sendTelegramMessage(botToken, chatId, reply || `Thanks for your message! Visit ${companyUrl} for more info.`);
  } catch (err) {
    console.error('[TelegramBot] AI error:', err.message);
    await sendTelegramMessage(botToken, chatId,
      `Thanks for reaching out! Visit ${companyUrl} or book a call: ${bookingUrl || companyUrl}`
    );
  }
}

module.exports = { handleLeadMessage, setTelegramWebhook };
