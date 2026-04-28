# Lead Nurturing Automation

Automated lead scoring and nurturing system. Fetches leads from Frappe CRM, scores them (HOT/WARM/COLD), dispatches multi-channel alerts via n8n, stores data in PostgreSQL, and writes status back to the CRM.

## Architecture

```
Frappe CRM API → n8n Workflow → Lead Classification → Alerts (Slack/Telegram/Email/WhatsApp/SMS) → CRM Status Update
                     ↕
              Express API (server.js)
                     ↕
                PostgreSQL
```

## Stack

- **n8n** — workflow automation (cron, CRM fetch, classify, notify, CRM write-back)
- **Express + Node.js** — REST API for manual triggers and web form ingestion
- **PostgreSQL** — lead and follow-up storage
- **Frappe CRM** — lead source at `http://34.196.221.16:8000`
- **Metabase** — analytics dashboard (via Docker)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in credentials
cp .env.example .env

# 3. Set up the database
psql -U postgres -f database/setup.sql

# 4. Start the Express server
npm start

# 5. Start n8n (separate terminal)
n8n start
# Open http://localhost:5678 and import workflows/lead-nurturing-workflow.json

# 6. Start Metabase (optional)
docker-compose up -d metabase
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Purpose |
|---|---|
| `CRM_BASE_URL` | Frappe CRM base URL, e.g. `http://34.196.221.16:8000` |
| `CRM_SID` | Frappe session cookie for API auth |
| `DB_*` | PostgreSQL connection settings |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram bot credentials |
| `SMTP_*` / `GMAIL_*` | Email credentials |
| `TWILIO_*` | WhatsApp / SMS via Twilio |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/leads` | Submit a lead via web form |
| `GET` | `/api/leads` | List all leads |
| `GET` | `/api/stats` | HOT/WARM/COLD counts |
| `GET` | `/api/followups` | Pending follow-ups |
| `PATCH` | `/api/leads/:id/status` | Update lead status |
| `POST` | `/api/crm/sync` | Manually trigger CRM poll |
| `GET` | `/api/crm/health` | Check CRM connectivity |

## Running Tests

```bash
npm test
```

## Project Structure

```
├── server.js                          # Express API
├── notifications.js                   # Follow-up scheduler + dispatch stub
├── crm.js                             # CRM polling, mapping, scoring (task 2+)
├── database/setup.sql                 # PostgreSQL schema
├── workflows/
│   ├── lead-nurturing-workflow.json   # n8n workflow (import this)
│   └── lead-scoring-function.js      # Scoring logic reference for n8n
├── public/                            # Web form + dashboard HTML
├── sample-data/crm_leads.csv          # Sample CRM data for testing
├── dashboard/metabase-queries.md      # Metabase SQL queries
├── tests/
│   ├── crm.unit.test.js               # Unit tests
│   └── crm.pbt.test.js                # Property-based tests
└── .kiro/specs/crm-integration/       # Feature spec (requirements, design, tasks)
```
