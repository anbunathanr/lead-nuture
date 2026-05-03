# Lead Nurturing Automation — Digitrans Solutions

Automated CRM lead outreach system. Every 5 minutes, fetches new leads from Frappe CRM, sends personalised messages via Slack, Telegram, Email, WhatsApp, and SMS, then marks them as Contacted. A live analytics dashboard shows outreach progress.

## Architecture

```
Frappe CRM
    │
    ▼
n8n Workflow (every 5 min)
    ├── Login to CRM (fresh session)
    ├── Fetch leads where status = New (2 per run)
    ├── Validate email
    ├── Send alerts → Slack · Telegram · Email · WhatsApp · SMS
    └── Mark lead as Contacted in CRM

Express Server (local) / AWS Lambda (production)
    └── GET /api/crm/leads  →  Analytics Dashboard (S3/CloudFront)
```

## Stack

| Layer | Technology |
|-------|-----------|
| Workflow automation | n8n (company-hosted) |
| CRM | Frappe CRM |
| Alerts | Slack · Telegram · Gmail SMTP · Twilio WhatsApp/SMS |
| Dashboard API | Express (local) / AWS Lambda + API Gateway (production) |
| Dashboard UI | Static HTML → S3 + CloudFront |
| Secrets | `.env` (local) / AWS SSM Parameter Store (production) |

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in credentials
cp .env.example .env

# 3. Start the dashboard server
npm start
# Dashboard → http://localhost:3001
```

## n8n Workflow Setup

The workflow runs on your company's n8n instance — no local n8n needed.

1. Open your company n8n
2. Import `workflows/lead-nurturing-workflow.json`
3. Replace all `{{PLACEHOLDER}}` values with real credentials (see table below)
4. Set up credentials in n8n for Telegram, SMTP, and Twilio Basic Auth
5. Activate the workflow

### Placeholders in workflow JSON

| Placeholder | What to replace with |
|-------------|---------------------|
| `{{CRM_HOST}}` | `your-frappe-host:8000` |
| `{{CRM_USER}}` | Frappe login email |
| `{{CRM_PASSWORD}}` | Frappe login password |
| `{{SLACK_WEBHOOK_PATH}}` | `T.../B.../xxx` (from Slack webhook URL) |
| `{{TELEGRAM_CHAT_ID}}` | Your Telegram chat ID |
| `{{TWILIO_ACCOUNT_SID}}` | Twilio Account SID |
| `{{SMTP_FROM_EMAIL}}` | Sender email address |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `CRM_BASE_URL` | ✅ | Frappe CRM base URL |
| `CRM_USER` | ✅ | Frappe login email |
| `CRM_PASSWORD` | ✅ | Frappe login password |
| `PORT` | optional | Server port (default: 3001) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/crm/leads` | Live lead stats + full lead list for dashboard |
| `GET` | `/api/crm/health` | CRM connectivity check |

## CRM Lead Statuses

| Status | Set by | Meaning |
|--------|--------|---------|
| `New` | CRM / manual | Not yet contacted — workflow picks these up |
| `Contacted` | n8n (automatic) | Initial message sent |
| `Nurture` | Sales team | Replied but not ready |
| `Qualified` | Sales team | Wants a demo/call |
| `Unqualified` | Sales team | Not a good fit |
| `Junk` | Sales team | Spam or invalid |

## Project Structure

```
├── server.js                        # Local dev server (Express)
├── crm.js                           # Frappe CRM client (session, fetch, stats)
├── lambda/
│   └── handler.js                   # AWS Lambda handler (production)
├── workflows/
│   └── lead-nurturing-workflow.json # n8n workflow (import into company n8n)
├── public/
│   └── index.html                   # Analytics dashboard
├── docs/
│   └── aws-deployment.md            # AWS serverless deployment guide
├── tests/
│   ├── crm.unit.test.js             # Unit tests
│   ├── crm.routes.test.js           # Route tests
│   └── crm.pbt.test.js              # Property-based tests
├── .env.example                     # Environment variable template
└── .gitignore
```

## Running Tests

```bash
npm test
```

## Production Deployment (AWS Serverless)

Uses only free-tier eligible services: **Lambda · API Gateway · S3 · CloudFront · SSM**

See [`docs/aws-deployment.md`](docs/aws-deployment.md) for step-by-step instructions.

```
Browser → CloudFront → S3 (index.html)
                ↓
         API Gateway → Lambda → Frappe CRM
```

## Security

- Never commit `.env` — it's in `.gitignore`
- The workflow JSON uses `{{PLACEHOLDER}}` values — fill them in n8n directly, not in the file
- For production, store credentials in AWS SSM Parameter Store instead of environment variables
