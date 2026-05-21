/**
 * ai/fibonacci-nudge.js
 * Generates follow-up nudge emails using AWS Bedrock (Claude).
 * Sends emails at Fibonacci intervals: 1, 1, 2, 3, 5, 8, 13 days after first contact.
 */

const { bedrockChat } = require('./bedrock-client');

const FIBONACCI_DAYS = [1, 1, 2, 3, 5, 8, 13];

const NUDGE_ANGLES = [
  'Check in — did they get the first email?',
  'Share a specific use case relevant to their industry',
  'Offer a free demo or walkthrough',
  'Share a customer success story',
  'Address a common objection (cost, complexity, time)',
  'Create urgency — limited onboarding slots',
  'Final follow-up — keep the door open',
];

/**
 * Returns the next nudge step and scheduled date.
 */
function getNextNudge(lastStep, firstContactDate) {
  const nextStep = lastStep + 1;
  if (nextStep > FIBONACCI_DAYS.length) return null;

  const daysToAdd = FIBONACCI_DAYS.slice(0, nextStep).reduce((a, b) => a + b, 0);
  const scheduledDate = new Date(firstContactDate);
  scheduledDate.setDate(scheduledDate.getDate() + daysToAdd);

  return { nextStep, scheduledDate, angle: NUDGE_ANGLES[nextStep - 1] || 'Follow up' };
}

/**
 * Generates a nudge email using AWS Bedrock.
 */
async function generateNudgeEmail({
  leadName, leadEmail, productName,
  companyName, companyUrl, bookingUrl,
  nudgeStep,
  awsAccessKey, awsSecretKey, awsRegion, bedrockModelId,
}) {
  const angle = NUDGE_ANGLES[nudgeStep - 1] || 'Follow up warmly';

  const systemPrompt =
    `You are a warm, persistent sales assistant for ${companyName}.\n` +
    `Write a short follow-up email to a lead who hasn't responded yet.\n\n` +
    `RULES:\n` +
    `- This is follow-up #${nudgeStep} — keep it brief (under 100 words)\n` +
    `- Angle for this email: ${angle}\n` +
    `- Focus on ${productName || companyName}\n` +
    `- Do NOT mention pricing — direct them to the website\n` +
    `- End with a single clear CTA\n` +
    `- Sign off as "${companyName} Team"\n` +
    `- Write only the email body, no subject line\n\n` +
    `WEBSITE: ${companyUrl}\nBOOK A CALL: ${bookingUrl || companyUrl}`;

  const body = await bedrockChat({
    accessKey:  awsAccessKey  || process.env.AWS_ACCESS_KEY_ID,
    secretKey:  awsSecretKey  || process.env.AWS_SECRET_ACCESS_KEY,
    region:     awsRegion     || process.env.AWS_REGION      || 'us-east-1',
    modelId:    bedrockModelId || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    systemPrompt,
    messages: [{
      role:    'user',
      content: `Lead name: ${leadName}\nProduct: ${productName}\n\nWrite the follow-up email:`,
    }],
    maxTokens: 200,
  });

  const subjects = [
    `Quick check-in, ${leadName}`,
    `${productName} — a use case for you`,
    `Want a quick demo, ${leadName}?`,
    `How teams like yours use ${productName}`,
    `Still thinking it over, ${leadName}?`,
    `Last few onboarding spots this month`,
    `Keeping the door open, ${leadName}`,
  ];

  return {
    subject: subjects[nudgeStep - 1] || `Following up — ${companyName}`,
    body,
  };
}

module.exports = { generateNudgeEmail, getNextNudge, FIBONACCI_DAYS };
