# Project Architecture

## System Flow

```
┌─────────────────────┐
│  Google Sheets      │
│  (CRM Data)         │
│  - name             │
│  - email            │
│  - phone            │
│  - login_count      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  n8n Workflow       │
│  ┌───────────────┐  │
│  │ Cron Trigger  │  │
│  │ (Every 5 min) │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Fetch Data    │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Lead Scoring  │  │
│  │ HOT/WARM/COLD │  │
│  └───────┬───────┘  │
└──────────┼──────────┘
           │
           ▼
┌─────────────────────┐
│  PostgreSQL         │
│  Database           │
│  - Store leads      │
│  - Track history    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Decision Logic     │
│  ┌───────────────┐  │
│  │ IF HOT        │──┼──► Slack Alert
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ IF WARM       │──┼──► Gmail Email
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ IF COLD       │──┼──► Drip Campaign
│  └───────────────┘  │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Metabase           │
│  Dashboard          │
│  - Total leads      │
│  - Status breakdown │
│  - Growth trends    │
│  - Hot leads list   │
└─────────────────────┘
```

## Technology Stack

### Data Source
- **Google Sheets** - CRM data storage

### Automation
- **n8n** - Workflow automation platform

### Database
- **PostgreSQL** - Persistent data storage

### Notifications
- **Slack** - Hot lead alerts
- **Gmail** - Email nurturing

### Analytics
- **Metabase** - Business intelligence dashboard

## Lead Scoring Logic

```javascript
if (login_count >= 5) → HOT
if (login_count >= 2) → WARM
if (login_count < 2)  → COLD
```

## Automation Rules

| Lead Status | Action | Channel |
|------------|--------|---------|
| HOT | Immediate alert | Slack |
| WARM | Nurture email | Gmail |
| COLD | Drip campaign | Email (future) |

## Database Schema

```sql
leads
├── id (SERIAL PRIMARY KEY)
├── name (TEXT)
├── email (TEXT)
├── phone (TEXT)
├── login_count (INT)
├── lead_status (TEXT)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

## Key Features

1. **Automated Lead Scoring** - Classifies leads based on engagement
2. **Real-time Alerts** - Instant Slack notifications for hot leads
3. **Email Automation** - Nurture sequences for warm leads
4. **Data Persistence** - All leads stored in PostgreSQL
5. **Analytics Dashboard** - Visual insights into lead pipeline
6. **Scheduled Execution** - Runs every 5 minutes automatically

## Scalability

This architecture can handle:
- ✅ 10,000+ leads
- ✅ Multiple CRM sources
- ✅ Custom scoring rules
- ✅ Multi-channel campaigns
- ✅ A/B testing
- ✅ Advanced analytics
