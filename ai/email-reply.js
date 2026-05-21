/**
 * ai/email-reply.js
 * AI-powered auto-reply to incoming lead emails using AWS Bedrock (Claude).
 */

const { bedrockChat }             = require('./bedrock-client');
const { searchKB, loadKnowledgeBase } = require('./knowledge-base');

async function generateEmailReply({
  leadName, leadEmail, incomingEmail,
  companyName, companyUrl, bookingUrl,
  awsAccessKey, awsSecretKey, awsRegion, bedrockModelId,
}) {
  const relevantChunks = searchKB(incomingEmail, 5);
  const kbContext = relevantChunks.length > 0
    ? relevantChunks.join('\n\n')
    : `${companyName} is a technology company. Visit ${companyUrl} for more information.`;

  const systemPrompt =
    `You are a helpful sales assistant for ${companyName}.\n` +
    `Reply to incoming lead emails in a warm, professional, concise way.\n\n` +
    `RULES:\n` +
    `1. Only answer questions about ${companyName} and its products/services\n` +
    `2. Never make up information not in the knowledge base\n` +
    `3. Keep replies under 150 words\n` +
    `4. Always end with a call-to-action (book a call or visit website)\n` +
    `5. Do NOT mention pricing — direct them to the website\n` +
    `6. Sign off as "${companyName} Team"\n\n` +
    `COMPANY KNOWLEDGE BASE:\n${kbContext}\n\n` +
    `BOOKING LINK: ${bookingUrl || companyUrl}\n` +
    `WEBSITE: ${companyUrl}`;

  const reply = await bedrockChat({
    accessKey:  awsAccessKey  || process.env.AWS_ACCESS_KEY_ID,
    secretKey:  awsSecretKey  || process.env.AWS_SECRET_ACCESS_KEY,
    region:     awsRegion     || process.env.AWS_REGION     || 'us-east-1',
    modelId:    bedrockModelId || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0',
    systemPrompt,
    messages: [{
      role:    'user',
      content: `Lead name: ${leadName}\nLead email: ${leadEmail}\n\nTheir email:\n${incomingEmail}\n\nWrite a reply:`,
    }],
    maxTokens: 300,
  });

  return reply;
}

module.exports = { generateEmailReply };
