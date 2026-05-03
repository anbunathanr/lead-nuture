# AWS Serverless Deployment

## Architecture

```
Browser → CloudFront → S3 (index.html)
                ↓
         API Gateway → Lambda (handler.js) → Frappe CRM
```

## Components

| Component | Purpose | Cost |
|-----------|---------|------|
| **S3** | Hosts `public/index.html` | ~$0.01/month |
| **CloudFront** | CDN for dashboard | ~$0/month (free tier) |
| **API Gateway** | Routes `/api/crm/*` to Lambda | ~$0/month (free tier) |
| **Lambda** | Fetches CRM data | ~$0/month (free tier) |

---

## Step 1 — Deploy Lambda

1. Zip the Lambda code:
```bash
zip -r lambda.zip lambda/handler.js crm.js
```

2. In AWS Console → Lambda → Create function:
   - Runtime: Node.js 18.x
   - Upload `lambda.zip`
   - Handler: `lambda/handler.handler`

3. Set environment variables in Lambda:
   - `CRM_BASE_URL` = `http://34.196.221.16:8000`
   - `CRM_USER` = your Frappe email
   - `CRM_PASSWORD` = your Frappe password

---

## Step 2 — Set up API Gateway

1. Create HTTP API in API Gateway
2. Add routes:
   - `GET /api/crm/leads` → Lambda
   - `GET /api/crm/health` → Lambda
3. Enable CORS
4. Deploy → note the API URL (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`)

---

## Step 3 — Deploy Dashboard to S3

1. Update `public/index.html` — change the fetch URL:
```js
// Replace:
const res = await fetch('/api/crm/leads');
// With your API Gateway URL:
const res = await fetch('https://abc123.execute-api.us-east-1.amazonaws.com/api/crm/leads');
```

2. Create S3 bucket → enable static website hosting
3. Upload `public/index.html`
4. Set bucket policy to public read

---

## Step 4 — CloudFront (optional but recommended)

1. Create CloudFront distribution pointing to S3 bucket
2. Add custom domain if needed
3. Enable HTTPS

---

## Local Development

Still works as before:
```bash
npm install
npm start
# Dashboard at http://localhost:3001
```

---

## Security (recommended)

Store CRM credentials in **AWS Secrets Manager** instead of Lambda env vars:

```js
// In lambda/handler.js, replace process.env with:
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const client = new SecretsManagerClient({ region: 'us-east-1' });
const secret = await client.send(new GetSecretValueCommand({ SecretId: 'crm-credentials' }));
const { CRM_USER, CRM_PASSWORD, CRM_BASE_URL } = JSON.parse(secret.SecretString);
```
