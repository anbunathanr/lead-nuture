# Nurturio — AI-Powered Lead Nurturing SaaS

Nurturio is a multi-tenant SaaS platform that automates lead nurturing for businesses using AI (AWS Bedrock Claude), n8n workflows, Frappe CRM, email (SMTP), and SMS (Fast2SMS).

## Live URLs

| Service | URL |
|---------|-----|
| Customer App | `http://nurturio-static-976193236457-prod.s3-website-us-east-1.amazonaws.com` |
| Admin Panel | `http://nurturio-static-976193236457-prod.s3-website-us-east-1.amazonaws.com/admin/login.html` |
| API (Lambda) | `https://1pqeziijq3.execute-api.us-east-1.amazonaws.com` |
| Local Dev | `http://localhost:8080` |

## Architecture

```
Customer Browser (S3 Static)
        │
        ▼
API Gateway → Lambda (api-handler.js)
        │
        ├── DynamoDB  (customers, sessions)
        ├── S3        (knowledge base files per customer)
        ├── SSM       (secrets)
        └── Bedrock   (Claude Haiku 4.5 — AI email/chat)

n8n Workflows (company-hosted at n8n.digitransolutions.in)
        ├── Lead Nurturing    (every 5 min — New leads → email + SMS)
        ├── Email Reply       (every 5 min — IMAP poll → AI reply)
        └── Follow-up         (every hour  — Contacted/Nurture/Qualified → follow-up)
```

## Stack

| Layer | Technology |
|-------|-----------|
| AI | AWS Bedrock Claude Haiku 4.5 |
| Workflow automation | n8n (self-hosted) |
| CRM | Frappe CRM |
| Email | SMTP (Gmail App Password) |
| SMS | Fast2SMS (India) |
| Alerts | Slack Webhook + Telegram Bot |
| Backend | Node.js + Express (local) / AWS Lambda (production) |
| Database | AWS DynamoDB |
| Storage | AWS S3 |
| Frontend | Static HTML → S3 |
| Secrets | `.env` (local) / AWS SSM Parameter Store (production) |

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in credentials
cp .env.example .env

# 3. Start the server
npm start
# App → http://localhost:8080
# Admin → http://localhost:8080/admin/login.html
```

## Customer Workflow

1. Customer signs up at `/` with company name, website, CRM credentials, SMTP credentials
2. Customer trains their Knowledge Base (paste text, upload PDF, or crawl website URL)
3. Admin downloads 3 n8n workflows pre-filled with customer's details:
   - **Lead Nurturing** — picks up `New` leads from CRM, sends AI email + SMS, marks `Contacted`
   - **Email Reply** — polls IMAP inbox, auto-replies to lead responses using live KB
   - **Follow-up** — hourly, sends follow-ups to `Contacted`/`Nurture`/`Qualified` leads
4. Customer imports workflows into n8n, sets up SMTP + Telegram credentials, activates

## CRM Lead Status Flow

```
New → (Lead Nurturing workflow) → Contacted
Contacted → (Follow-up workflow) → Nurture   (after first follow-up)
Nurture → (manually by sales) → Qualified
Qualified → (Follow-up workflow sends closing email)
Won / Unqualified / Junk → no more emails
```

## Alert Systems

Nurturio sends real-time alerts to your team through multiple channels whenever a lead is processed.

### Slack (Team Channel)
- New lead detected → alert with name, email, phone, product/org
- Shows whether email + SMS were sent or lead was marked Junk
- Follow-up sent → alert with lead name, status, and channels used
- Email reply received → alert with lead message preview

### Telegram (Personal / Team Bot)
- Same alerts as Slack but delivered to your Telegram chat
- Get your Chat ID by messaging `@userinfobot` on Telegram
- Supports Markdown formatting for clean readable alerts
- Works on mobile — instant push notifications

### Alert Content per Event

| Event | What you see |
|-------|-------------|
| New lead (with product) | 🎯 Targeted Lead — [Product] · Name · Email · Phone · ✉️ Email sending... 📲 SMS sending... |
| New lead (no product) | 📋 New Lead · Name · Email · Phone · ✉️ Email sending... |
| No valid email | ⚠️ No valid email — Junk |
| Follow-up sent | 🔔 Follow-up Sent · Name · Email · Status · ✉️ Email sent + SMS sent ✓ |
| Lead replied (email) | 📬 Lead Replied — AI Auto-Replied · Name · Email · Subject · Message preview |

### SMS (Fast2SMS — India)
- Sent directly to the **lead's** phone number (not your team)
- Pure ASCII messages, max 160 chars = 1 segment = ₹5 per SMS
- Sender ID: `FSTSMS` (shared Fast2SMS sender)
- Requires ₹100 minimum recharge at fast2sms.com
- API key stored in `.env` as `FAST2SMS_API_KEY` — injected server-side into workflows



### Lead Nurturing (every 5 min)
- Fetches 1 `New` lead from Frappe CRM
- Slack + Telegram alert fires immediately for every lead
- If lead has `organization` field → personalized product email
- If no `organization` → welcome email listing all products
- Sends email (SMTP) + SMS (Fast2SMS) in parallel
- Marks lead as `Contacted` in CRM

### Email Reply (every 5 min)
- Polls Gmail INBOX via IMAP for unread emails
- Filters to replies only (has `Re:` subject or `In-Reply-To` header)
- Fetches live KB from Lambda API
- Generates AI reply using Bedrock + KB
- Sends reply via SMTP
- Notifies via Telegram + Slack

### Follow-up / Fibonacci Nudge (every hour)
- Fetches 1 lead sorted by `modified ASC` (least-recently-touched first)
- Status-based email tone:
  - `Contacted` → cold nudge (ask a question, offer demo)
  - `Nurture` → warm email (share benefit, success story)
  - `Qualified` → closing email
- Sends email + SMS
- Moves `Contacted` → `Nurture` after first follow-up (rotates queue)
- Notifies via Telegram + Slack

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/customer/register` | Register new customer |
| `POST` | `/api/customer/login` | Customer login |
| `GET` | `/api/customer/profile?email=` | Get profile |
| `PUT` | `/api/customer/profile` | Update profile |
| `POST` | `/api/kb/train` | Train KB from URL |
| `POST` | `/api/kb/manual` | Add text to KB |
| `GET` | `/api/kb/text?email=` | Get KB text (used by n8n) |
| `DELETE` | `/api/kb?email=` | Clear KB |
| `POST` | `/api/ai/chat` | Bedrock AI chat (used by n8n) |
| `POST` | `/api/chat/widget` | Chatbot widget endpoint |
| `POST` | `/api/admin/login` | Admin login |
| `GET` | `/api/admin/customers` | List all customers |
| `GET` | `/api/admin/customers/:email/workflow?type=` | Download workflow JSON |

## AWS Deployment

```bash
# Copy bedrock client to lambda
Copy-Item ai/bedrock-client.js lambda/bedrock-client.js -Force

# Build
sam build --template-file infrastructure/template.yaml

# Deploy Lambda
sam deploy --template-file .aws-sam/build/template.yaml \
  --stack-name nurturio \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --s3-bucket nurturio-deploy-976193236457 \
  --parameter-overrides AdminPassword="nurturio-admin-2024" \
    BedrockModelId="us.anthropic.claude-haiku-4-5-20251001-v1:0" \
    Environment="prod" \
  --no-confirm-changeset

# Sync static frontend
aws s3 sync public/ s3://nurturio-static-976193236457-prod/ --delete
```

## AWS Resources

| Resource | Name |
|----------|------|
| API Gateway | `https://1pqeziijq3.execute-api.us-east-1.amazonaws.com` |
| S3 Static | `nurturio-static-976193236457-prod` |
| S3 KB | `nurturio-kb-976193236457-prod` |
| DynamoDB Customers | `nurturio-customers-prod` |
| DynamoDB Sessions | `nurturio-sessions-prod` |
| Deploy Bucket | `nurturio-deploy-976193236457` |

## Project Structure

```
├── server.js                    # Local dev server (Express, port 8080)
├── lambda/
│   └── api-handler.js           # AWS Lambda handler (production)
├── ai/
│   ├── bedrock-client.js        # AWS Bedrock Sigv4 client
│   ├── knowledge-base.js        # KB build/load/chunk
│   ├── email-reply.js           # AI email reply generator
│   ├── fibonacci-nudge.js       # Nudge email generator
│   └── imap-poller.js           # IMAP email polling
├── public/
│   ├── index.html               # Customer login/signup
│   ├── dashboard.html           # Customer dashboard (Profile/CRM/Email/Alerts/KB)
│   ├── chatbot-widget.html      # Embeddable AI chatbot
│   └── admin/
│       ├── login.html           # Admin login
│       └── dashboard.html       # Admin panel (customer list + workflow downloads)
├── infrastructure/
│   └── template.yaml            # AWS SAM template
├── data/
│   └── customers/               # Local customer data (gitignored)
├── .env.example                 # Environment variable template
└── .gitignore
```

## Security Notes

- `.env` is gitignored — never commit credentials
- `data/customers/` is gitignored — contains customer credentials
- `workflows/` JSON files are gitignored — contain customer-specific secrets
- `scripts/` is gitignored — contain hardcoded credentials for local use
- Production secrets stored in AWS SSM Parameter Store
