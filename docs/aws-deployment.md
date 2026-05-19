# Nurturio — AWS Serverless Deployment

**Services used:** Lambda · API Gateway · DynamoDB · S3 · CloudFront · SSM · EventBridge · Bedrock

**NOT used (too expensive):** EC2, RDS, VPC, NAT Gateway, Load Balancers, ECS, OpenSearch

---

## Architecture

```
Browser
  │
  ├── Static pages (index.html, dashboard.html, chatbot-widget.html)
  │   └── CloudFront → S3 (nurturio-static bucket)
  │
  └── API calls (/api/*)
      └── CloudFront → API Gateway → Lambda (api-handler.js)
                                          │
                                          ├── DynamoDB (customers, sessions, nudge)
                                          ├── S3 (knowledge base files)
                                          ├── Bedrock (Claude Haiku 4.5)
                                          └── SSM (secrets)

EventBridge (every 5 min) → Lambda (imap-poller.js)
                                  │
                                  ├── DynamoDB (read customer IMAP configs)
                                  ├── S3 (load KB)
                                  ├── Bedrock (generate reply)
                                  └── SMTP (send reply)
```

---

## Prerequisites

1. **AWS CLI** installed and configured: `aws configure`
2. **SAM CLI** installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
3. **Node.js 18+** installed
4. AWS account with Bedrock access to Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)

---

## Deploy in 3 commands

```bash
# 1. Set your secrets as environment variables
export ADMIN_PASSWORD="your-strong-admin-password"
export LEAD_BOT_TOKEN="your-telegram-bot-token"   # optional
export AWS_REGION="us-east-1"

# 2. Make deploy script executable
chmod +x scripts/deploy.sh

# 3. Deploy everything
./scripts/deploy.sh
```

The script will output your app URL when done.

---

## What gets created

| Resource | Name | Purpose |
|----------|------|---------|
| Lambda | `nurturio-api-prod` | All API routes |
| Lambda | `nurturio-imap-poller-prod` | Email reply automation |
| API Gateway | `nurturio-api-prod` | HTTP API |
| DynamoDB | `nurturio-customers-prod` | Customer profiles |
| DynamoDB | `nurturio-sessions-prod` | Auth sessions + replied emails |
| DynamoDB | `nurturio-nudge-prod` | Nudge schedules |
| S3 | `nurturio-kb-{accountId}-prod` | Knowledge base files |
| S3 | `nurturio-static-{accountId}-prod` | Static HTML pages |
| CloudFront | auto | CDN + HTTPS |
| EventBridge | `nurturio-imap-schedule-prod` | 5-min IMAP trigger |
| SSM | `/nurturio/*` | Secrets |

---

## Estimated Cost

All within AWS free tier for typical usage:

| Service | Free Tier | Typical Usage |
|---------|-----------|---------------|
| Lambda | 1M requests/month | ~10K requests/month |
| API Gateway | 1M requests/month | ~10K requests/month |
| DynamoDB | 25GB + 25 WCU/RCU | < 1GB, minimal throughput |
| S3 | 5GB + 20K requests | < 100MB |
| CloudFront | 1TB transfer | Minimal |
| EventBridge | 14M events/month | ~8,640/month |
| Bedrock | Pay per token | ~$0.25/1K emails |

**Estimated monthly cost: ~$0–5** depending on Bedrock usage.

---

## After deployment

### Update n8n workflows
Replace `https://stricken-unpledged-aorta.ngrok-free.dev` with your CloudFront URL in:
- `workflows/lead-nurturing-workflow.json`
- `workflows/email-reply-workflow.json`

### Add customer IMAP config
For the IMAP poller to work, customers need `imap_host`, `imap_user`, `imap_pass` in their profile. Add these fields to the dashboard profile form.

### Tear down
```bash
aws cloudformation delete-stack --stack-name nurturio --region us-east-1
```

---

## Local Development

Keep using `server.js` locally — it's still fully functional:

```bash
npm install
cp .env.example .env   # fill in your values
npm start              # http://localhost:8080
```
