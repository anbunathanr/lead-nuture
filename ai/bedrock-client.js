/**
 * ai/bedrock-client.js
 * AWS Bedrock Converse API client with correct AWS Signature V4.
 */

const https  = require('https');
const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = hmacSha256('AWS4' + secretKey, dateStamp);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Calls AWS Bedrock Converse API with Claude.
 */
async function bedrockChat({ accessKey, secretKey, region, modelId, systemPrompt, messages, maxTokens = 500 }) {
  const service  = 'bedrock';
  const host     = `bedrock-runtime.${region}.amazonaws.com`;

  // URL-encode the colon in the model ID for the HTTP path
  const urlPath  = `/model/${modelId.replace(/:/g, '%3A')}/converse`;
  // For canonical URI in Sig V4, percent signs must themselves be encoded (%25)
  const canonicalPath = `/model/${modelId.replace(/:/g, '%253A')}/converse`;

  const bodyObj = {
    messages: messages.map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: String(m.content) }],
    })),
    inferenceConfig: { maxTokens, temperature: 0.7 },
  };
  if (systemPrompt) bodyObj.system = [{ text: systemPrompt }];

  const body = JSON.stringify(bodyObj);

  // Timestamps
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); // 20240101T120000Z
  const dateStamp = amzDate.slice(0, 8); // 20240101

  const payloadHash = sha256(body);

  // Canonical headers — must be sorted alphabetically by header name
  // content-type, host, x-amz-content-sha256, x-amz-date
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'POST',
    canonicalPath,   // double-encoded for Sig V4 canonical URI
    '',                  // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature  = hmacSha256(signingKey, stringToSign).toString('hex');

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path:     urlPath,
      method:   'POST',
      headers: {
        'Content-Type':          'application/json',
        'Content-Length':        Buffer.byteLength(body),
        'x-amz-date':            amzDate,
        'x-amz-content-sha256':  payloadHash,
        'Authorization':         authHeader,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.message || json.__type) {
            return reject(new Error(json.message || json.__type));
          }
          const text = json.output?.message?.content?.[0]?.text?.trim() || '';
          resolve(text);
        } catch (e) {
          reject(new Error('Invalid Bedrock response: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Bedrock timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { bedrockChat };
