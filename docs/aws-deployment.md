# Nurturio — AWS Deployment Guide

**Services used:** Lambda · API Gateway · DynamoDB · S3 · CloudFront · SSM · EventBridge · Bedrock

---

## Architecture

```
Browser
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
```

---

## Prerequisites

1. **AWS CLI** configured: `aws configure`
2. **SAM CLI** installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
3. **Node.js 18+**
4. AWS account with Bedrock access to Claude Haiku 4.5
5. An S3 bucket for SAM deployment artifacts (e.g. `nurturio-deploy-976193236457`)

---

## Backend Deployment (Lambda + API Gateway)

### Step 1: Copy shared modules into lambda folder

```bash
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

---

## What gets created

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
| S3 | `nurturio-static-{accountId}-prod` | Static HTML (private, served via CloudFront) |
| EventBridge | `nurturio-imap-schedule-prod` | 5-min IMAP trigger |
| SSM | `/nurturio/*` | Secrets |

---

## Why CloudFront?

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
