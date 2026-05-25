# Nurturio — AWS Deployment Guide

**Services used:** Lambda · API Gateway · DynamoDB · S3 · CloudFront · SSM · Bedrock

<<<<<<< HEAD
=======
**NOT used:** EC2, RDS, VPC, NAT Gateway, Load Balancers, ECS, OpenSearch

---

## Current Deployed Resources

| Resource | Name / URL |
|----------|-----------|
| **CloudFront (Static Site)** | **`https://dew2yodq4ld2q.cloudfront.net`** |
| API Gateway | `https://1pqeziijq3.execute-api.us-east-1.amazonaws.com` |
| S3 Static (origin) | `nurturio-static-976193236457-prod` |
| S3 KB | `nurturio-kb-976193236457-prod` |
| DynamoDB Customers | `nurturio-customers-prod` |
| DynamoDB Sessions | `nurturio-sessions-prod` |
| Deploy Bucket | `nurturio-deploy-976193236457` |
| CloudFront Distribution ID | `E55GGZN5WBS0S` |
| AWS Account | `976193236457` |
| Region | `us-east-1` |

>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc
---

## Architecture

```
Browser
<<<<<<< HEAD
  │
  ├── Static pages (index.html, dashboard.html, admin/)
  │   └── CloudFront (HTTPS + caching) → S3 (private bucket)
  │
  └── API calls (/api/*)
      └── API Gateway → Lambda (api-handler.js)
                              │
                              ├── DynamoDB (customers, sessions, nudge)
                              ├── S3 (knowledge base files)
                              ├── Bedrock (Claude Haiku 4.5)
                              └── SSM (secrets)

EventBridge (every 5 min) → Lambda (imap-poller.js)
=======
  |
  |-- Static pages (index.html, dashboard.html, chatbot-widget.html)
  |   └── CloudFront --> S3 (nurturio-static bucket)
  |
  └-- API calls (/api/*)
      └── CloudFront --> API Gateway --> Lambda (api-handler.js)
                                              |
                                              |-- DynamoDB (customers, sessions)
                                              |-- S3 (knowledge base files)
                                              |-- Bedrock (Claude Haiku 4.5)
                                              └-- SSM (secrets)
>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc
```

---

## CloudFront — Already Deployed

<<<<<<< HEAD
1. **AWS CLI** configured: `aws configure`
2. **SAM CLI** installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
3. **Node.js 18+**
4. AWS account with Bedrock access to Claude Haiku 4.5
5. An S3 bucket for SAM deployment artifacts (e.g. `nurturio-deploy-976193236457`)
=======
CloudFront distribution is live:
>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc

| | |
|-|-|
| **Static Site URL** | `https://dew2yodq4ld2q.cloudfront.net` |
| Distribution ID | `E55GGZN5WBS0S` |
| Origin | `nurturio-static-976193236457-prod.s3-website-us-east-1.amazonaws.com` |
| Status | Deployed (allow ~10 min for first propagation) |

<<<<<<< HEAD
## Backend Deployment (Lambda + API Gateway)

### Step 1: Copy shared modules into lambda folder
=======
**Customer App**: `https://dew2yodq4ld2q.cloudfront.net`
**Admin Panel**: `https://dew2yodq4ld2q.cloudfront.net/admin/login.html`
**Chatbot**: `https://dew2yodq4ld2q.cloudfront.net/chatbot-widget.html?company=EMAIL`
>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc

### To invalidate cache after deploying new static files:
```bash
<<<<<<< HEAD
cp ai/bedrock-client.js lambda/bedrock-client.js
```

### Step 2: Build

```bash
sam build --template-file infrastructure/template.yaml
```

### Step 3: Deploy

```bash
sam deploy --template-file .aws-sam/build/template.yaml \
  --stack-name nurturio \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --s3-bucket nurturio-deploy-976193236457 \
  --parameter-overrides \
    AdminPassword="nurturio-admin-2024" \
    BedrockModelId="us.anthropic.claude-haiku-4-5-20251001-v1:0" \
    Environment="prod" \
  --no-confirm-changeset
```

### Step 4: Note the outputs

After deploy, SAM prints:

| Output | Example |
|--------|---------|
| `ApiUrl` | `https://1pqeziijq3.execute-api.us-east-1.amazonaws.com` |
| `CloudFrontUrl` | `https://d1234abcdef.cloudfront.net` |
| `CloudFrontDistributionId` | `E1234ABCDEF` |
| `StaticBucketName` | `nurturio-static-976193236457-prod` |

---

## Frontend Deployment (S3 + CloudFront)

### Step 1: Sync static files to S3

```bash
aws s3 sync public/ s3://nurturio-static-976193236457-prod/ --delete
```

### Step 2: Invalidate CloudFront cache

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234ABCDEF \
  --paths "/*"
```

Replace `E1234ABCDEF` with your actual `CloudFrontDistributionId` from the SAM outputs.

### That's it!

Your frontend is now live at the CloudFront URL with HTTPS:
```
https://d1234abcdef.cloudfront.net
https://d1234abcdef.cloudfront.net/admin/login.html
```

---

## Full Deploy (both frontend + backend)

```bash
# 1. Copy shared AI module
cp ai/bedrock-client.js lambda/bedrock-client.js

# 2. Build & deploy backend
sam build --template-file infrastructure/template.yaml
sam deploy --template-file .aws-sam/build/template.yaml \
  --stack-name nurturio \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --s3-bucket nurturio-deploy-976193236457 \
  --parameter-overrides \
    AdminPassword="nurturio-admin-2024" \
    BedrockModelId="us.anthropic.claude-haiku-4-5-20251001-v1:0" \
    Environment="prod" \
  --no-confirm-changeset

# 3. Deploy frontend
aws s3 sync public/ s3://nurturio-static-976193236457-prod/ --delete

# 4. Invalidate cache
aws cloudfront create-invalidation \
  --distribution-id E1234ABCDEF \
  --paths "/*"
```

=======
aws cloudfront create-invalidation --distribution-id E55GGZN5WBS0S --paths "/*"
```

>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc
---

## Setting Up CloudFront (Reference — Already Done)

Currently the app runs on S3 website URL (HTTP only). CloudFront adds HTTPS and a clean URL.

### Step 1 — Create CloudFront Distribution for Static Site

1. Go to **AWS Console → CloudFront → Create Distribution**
2. **Origin domain**: select `nurturio-static-976193236457-prod.s3-website-us-east-1.amazonaws.com`
   - Origin type: **S3 website endpoint** (not S3 bucket)
3. **Viewer protocol policy**: Redirect HTTP to HTTPS
4. **Default root object**: `index.html`
5. **Custom error pages** (for SPA routing):
   - Error code: `403` → Response page: `/index.html` → HTTP 200
   - Error code: `404` → Response page: `/index.html` → HTTP 200
6. Click **Create Distribution**
7. Wait ~10 minutes for deployment
8. Note your CloudFront URL: `https://XXXXXXXXXXXX.cloudfront.net`

### Step 2 — Create CloudFront Distribution for API Gateway

1. Go to **CloudFront → Create Distribution**
2. **Origin domain**: `1pqeziijq3.execute-api.us-east-1.amazonaws.com`
3. **Origin path**: leave empty
4. **Viewer protocol policy**: HTTPS only
5. **Allowed HTTP methods**: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
6. **Cache policy**: `CachingDisabled` (APIs must not be cached)
7. **Origin request policy**: `AllViewerExceptHostHeader`
8. Click **Create Distribution**
9. Note your API CloudFront URL: `https://YYYYYYYYYYYY.cloudfront.net`

### Step 3 — Update Frontend to Use CloudFront API URL

Once you have the API CloudFront URL, update these files:

**`public/dashboard.html`** — replace all occurrences of:
```
https://1pqeziijq3.execute-api.us-east-1.amazonaws.com
```
with:
```
https://YYYYYYYYYYYY.cloudfront.net
```

**`public/admin/dashboard.html`** — same replacement

**`public/index.html`** — same replacement

**`public/chatbot-widget.html`** — same replacement

Then redeploy static files:
```bash
aws s3 sync public/ s3://nurturio-static-976193236457-prod/ --delete
```

### Step 4 — Update n8n Workflows

In your n8n workflows, the Lambda API URL is already set to:
```
https://1pqeziijq3.execute-api.us-east-1.amazonaws.com
```

If you set up a CloudFront distribution for the API, update the workflows too. Download fresh workflows from the admin dashboard after updating.

---

## Standard Deployment (Lambda + S3)

### Build and Deploy Lambda

```powershell
# Copy bedrock client to lambda folder
Copy-Item ai/bedrock-client.js lambda/bedrock-client.js -Force

# Build SAM
sam build --template-file infrastructure/template.yaml

# Deploy Lambda
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name nurturio `
  --capabilities CAPABILITY_IAM `
  --region us-east-1 `
  --s3-bucket nurturio-deploy-976193236457 `
  --parameter-overrides `
    AdminPassword="nurturio-admin-2024" `
    BedrockModelId="us.anthropic.claude-haiku-4-5-20251001-v1:0" `
    Environment="prod" `
  --no-confirm-changeset
```

### Sync Static Frontend to S3

```powershell
aws s3 sync public/ s3://nurturio-static-976193236457-prod/ --delete --region us-east-1
```

### Check Deployment Status

```powershell
aws cloudformation describe-stacks --stack-name nurturio --region us-east-1 --query "Stacks[0].StackStatus" --output text
```

---

## What Gets Created by SAM

| Resource | Name | Purpose |
|----------|------|---------|
| Lambda | `nurturio-api-prod` | All API routes |
| Lambda | `nurturio-imap-poller-prod` | Email reply automation (every 5 min) |
| API Gateway | `nurturio-api-prod` | HTTP API |
| CloudFront | auto-generated | HTTPS CDN for frontend |
| DynamoDB | `nurturio-customers-prod` | Customer profiles |
| DynamoDB | `nurturio-sessions-prod` | Auth sessions |
| DynamoDB | `nurturio-nudge-prod` | Nudge schedules |
| S3 | `nurturio-kb-{accountId}-prod` | Knowledge base files |
<<<<<<< HEAD
| S3 | `nurturio-static-{accountId}-prod` | Static HTML (private, served via CloudFront) |
| EventBridge | `nurturio-imap-schedule-prod` | 5-min IMAP trigger |
=======
| S3 | `nurturio-static-{accountId}-prod` | Static HTML pages |
>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc
| SSM | `/nurturio/*` | Secrets |

---

## Why CloudFront?

<<<<<<< HEAD
| Feature | S3 Website Hosting | CloudFront + S3 |
|---------|-------------------|-----------------|
| HTTPS | ❌ HTTP only | ✅ Free SSL |
| Caching | ❌ None | ✅ Edge caching globally |
| Custom domain | ❌ Complex | ✅ Easy with ACM cert |
| S3 bucket access | Public | Private (OAC) |
| Performance | Single region | 400+ edge locations |

---

## Custom Domain (optional)

1. Request an ACM certificate in `us-east-1` for your domain (e.g. `app.nurturio.com`)
2. Add `Aliases` and `ViewerCertificate` to the CloudFront distribution in `template.yaml`
3. Create a CNAME record pointing your domain to the CloudFront domain name

---

## Tear down

```bash
# Empty buckets first
aws s3 rm s3://nurturio-static-976193236457-prod --recursive
aws s3 rm s3://nurturio-kb-976193236457-prod --recursive

# Delete stack
aws cloudformation delete-stack --stack-name nurturio --region us-east-1
```

---

## Estimated Cost

| Service | Free Tier | Typical Usage |
|---------|-----------|---------------|
| Lambda | 1M requests/month | ~10K requests/month |
| API Gateway | 1M requests/month | ~10K requests/month |
| DynamoDB | 25GB + 25 WCU/RCU | < 1GB |
| S3 | 5GB + 20K requests | < 100MB |
| CloudFront | 1TB transfer/month | Minimal |
| EventBridge | 14M events/month | ~8,640/month |
| Bedrock | Pay per token | ~$0.25/1K emails |

**Estimated monthly cost: ~$0–5** (mostly Bedrock usage).
=======
All within AWS free tier for typical usage:

| Service | Free Tier | Typical Usage |
|---------|-----------|---------------|
| Lambda | 1M requests/month | ~10K requests/month |
| API Gateway | 1M requests/month | ~10K requests/month |
| DynamoDB | 25GB + 25 WCU/RCU | < 1GB, minimal throughput |
| S3 | 5GB + 20K requests | < 100MB |
| CloudFront | 1TB transfer | Minimal |
| Bedrock | Pay per token | ~$0.25/1K emails |

**Estimated monthly cost: ~$0–5** depending on Bedrock usage.

---

## Local Development

```bash
npm install
cp .env.example .env   # fill in your values
npm start              # http://localhost:8080
```

---

## Tear Down

```bash
aws cloudformation delete-stack --stack-name nurturio --region us-east-1
```
>>>>>>> a54e9451c208abae791123e1647e8979a6043bdc
