# AWS Serverless Deployment

Uses only free-tier eligible, serverless AWS services:
**Lambda · API Gateway · S3 · CloudFront · SSM Parameter Store**

## Architecture

```
Browser
  │
  ├── Static dashboard ──► CloudFront ──► S3 (public/index.html)
  │
  └── API calls ──► API Gateway ──► Lambda (lambda/handler.js)
                                         │
                                         └──► Frappe CRM
```

---

## Step 1 — Store credentials in SSM Parameter Store

In AWS Console → Systems Manager → Parameter Store → Create parameter:

| Parameter Name | Value |
|----------------|-------|
| `/leadflow/CRM_BASE_URL` | `http://your-frappe-host:8000` |
| `/leadflow/CRM_USER` | your Frappe email |
| `/leadflow/CRM_PASSWORD` | your Frappe password |

Use **SecureString** type for USER and PASSWORD.

---

## Step 2 — Deploy Lambda

1. Zip the Lambda code:
```bash
zip -r lambda.zip lambda/handler.js crm.js
```

2. AWS Console → Lambda → Create function:
   - Runtime: **Node.js 18.x**
   - Upload `lambda.zip`
   - Handler: `lambda/handler.handler`
   - Timeout: 30 seconds
   - Memory: 128 MB

3. Add environment variables in Lambda configuration:
   - `CRM_BASE_URL` — or fetch from SSM (see handler.js comments)
   - `CRM_USER`
   - `CRM_PASSWORD`

4. Add Lambda execution role permission:
   - `ssm:GetParameter` on `/leadflow/*`

---

## Step 3 — Set up API Gateway

1. Create **HTTP API** (not REST API — cheaper)
2. Add routes:
   - `GET /api/crm/leads` → Lambda
   - `GET /api/crm/health` → Lambda
3. Enable CORS (allow origin `*`)
4. Deploy → note the invoke URL:
   `https://abc123.execute-api.us-east-1.amazonaws.com`

---

## Step 4 — Deploy Dashboard to S3

1. Update `public/index.html` — change the API fetch URL:
```js
// Find this line and replace with your API Gateway URL:
const res = await fetch('/api/crm/leads');
// Change to:
const res = await fetch('https://abc123.execute-api.us-east-1.amazonaws.com/api/crm/leads');
```

2. Create S3 bucket:
   - Enable **Static website hosting**
   - Uncheck "Block all public access"
   - Add bucket policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
  }]
}
```

3. Upload `public/index.html`

---

## Step 5 — CloudFront (HTTPS + CDN)

1. Create CloudFront distribution:
   - Origin: your S3 bucket website endpoint
   - Default root object: `index.html`
   - Redirect HTTP to HTTPS
2. Your dashboard is now live at `https://xxxxx.cloudfront.net`

---

## Estimated Cost

All within AWS free tier for typical usage:

| Service | Free Tier | Typical Usage |
|---------|-----------|---------------|
| Lambda | 1M requests/month | ~8,640 requests/month (every 5 min) |
| API Gateway | 1M requests/month | Same as Lambda |
| S3 | 5GB storage | < 1MB |
| CloudFront | 1TB transfer/month | Minimal |
| SSM | 10,000 API calls/month | Minimal |

**Estimated monthly cost: $0** (within free tier)

---

## Local Development

No AWS needed for local dev:

```bash
npm install
cp .env.example .env   # fill in CRM credentials
npm start              # http://localhost:3001
```
