# Lead Nurturing Automation Project

Automated lead scoring and nurturing system using CRM Lead API data, n8n workflows, PostgreSQL, and Metabase dashboard.

## Architecture

```
CRM Lead API (Frappe) → n8n Workflow → Lead Classification → Alerts (Email/Slack/WhatsApp/Telegram) → CRM Status Update → Metabase Dashboard
```

## Quick Start

### 1. Install Dependencies
```bash
npm install n8n -g
```

### 2. Setup Database
```bash
# Install PostgreSQL, then run:
psql -U postgres -f database/setup.sql
```

### 3. Start n8n
```bash
n8n start
```
Open http://localhost:5678

### 4. Import Workflow
- Open n8n
- Import `workflows/lead-nurturing-workflow.json`
- Configure credentials (SMTP, Slack, Telegram, Twilio)
- Set environment variable `CRM_SID` in n8n for API auth

### 5. CRM API Configuration

The workflow fetches leads from:

```bash
http://34.196.221.16:8000/api/resource/CRM Lead
```

Request details:

- Query param `fields=["name","email","mobile_no","status","organization"]`
- Header `Cookie: sid=<your session id>`

### 6. Setup Dashboard
```bash
docker run -d -p 3000:3000 metabase/metabase
```
Open http://localhost:3000

## Project Structure

```
├── database/           # PostgreSQL setup scripts
├── workflows/          # n8n workflow JSON
├── dashboard/          # Metabase queries
├── docs/              # Documentation
└── sample-data/       # Sample CRM data
```

## Features

- ✅ Automated lead scoring (HOT/WARM/COLD)
- ✅ Real-time Slack alerts for hot leads
- ✅ Email nurturing for warm leads
- ✅ PostgreSQL data storage
- ✅ Analytics dashboard
- ✅ Scheduled automation (every 5 minutes)

## Demo Flow

1. CRM lead is created/updated in Frappe
2. Cron trigger runs every 5 minutes in n8n
3. Lead is mapped and classified (HOT/WARM/COLD)
4. Alerts/messages are sent based on lead status
5. CRM lead status is updated back via API
6. Dashboard updates in real-time
