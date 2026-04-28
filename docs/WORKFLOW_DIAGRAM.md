# Workflow Diagram

## Complete System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     LEAD NURTURING SYSTEM                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│   DATA SOURCE       │
│                     │
│  Google Sheets      │
│  ┌───────────────┐  │
│  │ name          │  │
│  │ email         │  │
│  │ phone         │  │
│  │ login_count   │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
           │ Every 5 minutes
           │
           ▼
┌─────────────────────┐
│   AUTOMATION        │
│                     │
│  n8n Workflow       │
│  ┌───────────────┐  │
│  │ Cron Trigger  │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Fetch Data    │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Lead Scoring  │  │
│  │               │  │
│  │ if >= 5: HOT  │  │
│  │ if >= 2: WARM │  │
│  │ if < 2: COLD  │  │
│  └───────┬───────┘  │
└──────────┼──────────┘
           │
           ▼
┌─────────────────────┐
│   DATABASE          │
│                     │
│  PostgreSQL         │
│  ┌───────────────┐  │
│  │ leads table   │  │
│  │ - id          │  │
│  │ - name        │  │
│  │ - email       │  │
│  │ - phone       │  │
│  │ - login_count │  │
│  │ - lead_status │  │
│  │ - created_at  │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   DECISION LOGIC    │
│                     │
│  ┌───────────────┐  │
│  │ IF HOT?       │  │
│  └───┬───────┬───┘  │
│      │ YES   │ NO   │
│      │       │      │
└──────┼───────┼──────┘
       │       │
       │       ▼
       │  ┌─────────────────┐
       │  │ IF WARM?        │
       │  └───┬─────────┬───┘
       │      │ YES     │ NO
       │      │         │
       ▼      ▼         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  SLACK   │ │  GMAIL   │ │  QUEUE   │
│  ALERT   │ │  EMAIL   │ │  (COLD)  │
│          │ │          │ │          │
│ 🔥 HOT   │ │ 📧 WARM  │ │ ❄️ COLD  │
│ LEAD!    │ │ NURTURE  │ │ DRIP     │
└──────────┘ └──────────┘ └──────────┘
       │         │            │
       └─────────┴────────────┘
                 │
                 ▼
       ┌─────────────────┐
       │   ANALYTICS     │
       │                 │
       │  Metabase       │
       │  Dashboard      │
       │  ┌───────────┐  │
       │  │ Charts    │  │
       │  │ Metrics   │  │
       │  │ Reports   │  │
       │  └───────────┘  │
       └─────────────────┘
```

---

## Detailed Node Flow

```
START
  │
  ├─► [1] CRON TRIGGER
  │    ├─ Schedule: */5 * * * *
  │    └─ Runs every 5 minutes
  │
  ├─► [2] GOOGLE SHEETS
  │    ├─ Operation: Read
  │    ├─ Range: A:D
  │    └─ Output: Array of leads
  │
  ├─► [3] FUNCTION NODE
  │    ├─ Input: Lead data
  │    ├─ Logic: Score calculation
  │    │   ├─ login_count >= 5 → HOT
  │    │   ├─ login_count >= 2 → WARM
  │    │   └─ login_count < 2 → COLD
  │    └─ Output: Scored leads
  │
  ├─► [4] POSTGRESQL
  │    ├─ Operation: Insert
  │    ├─ Table: leads
  │    └─ Conflict: Do nothing
  │
  ├─► [5] IF NODE (Hot Check)
  │    ├─ Condition: status = 'HOT'
  │    ├─ TRUE → [6] Slack Alert
  │    └─ FALSE → [7] IF Node (Warm Check)
  │
  ├─► [6] SLACK
  │    ├─ Channel: #leads
  │    ├─ Message: Hot lead alert
  │    └─ Priority: Immediate
  │
  ├─► [7] IF NODE (Warm Check)
  │    ├─ Condition: status = 'WARM'
  │    ├─ TRUE → [8] Gmail
  │    └─ FALSE → End
  │
  ├─► [8] GMAIL
  │    ├─ To: Lead email
  │    ├─ Subject: Nurture message
  │    └─ Body: Personalized email
  │
END
```

---

## Data Flow Example

```
INPUT (Google Sheets):
┌──────────┬───────────────────┬──────────────┬─────────────┐
│ name     │ email             │ phone        │ login_count │
├──────────┼───────────────────┼──────────────┼─────────────┤
│ Rahul    │ rahul@gmail.com   │ 9876543210   │ 0           │
│ Priya    │ priya@gmail.com   │ 9876543211   │ 2           │
│ Arjun    │ arjun@gmail.com   │ 9876543212   │ 5           │
└──────────┴───────────────────┴──────────────┴─────────────┘

PROCESSING (Lead Scoring):
┌──────────┬─────────────┬────────┬────────────────────┐
│ name     │ login_count │ status │ action             │
├──────────┼─────────────┼────────┼────────────────────┤
│ Rahul    │ 0           │ COLD   │ Drip campaign      │
│ Priya    │ 2           │ WARM   │ Send email         │
│ Arjun    │ 5           │ HOT    │ Slack alert        │
└──────────┴─────────────┴────────┴────────────────────┘

OUTPUT (Database):
┌────┬──────────┬───────────────────┬──────────────┬─────────────┬────────┬─────────────────────┐
│ id │ name     │ email             │ phone        │ login_count │ status │ created_at          │
├────┼──────────┼───────────────────┼──────────────┼─────────────┼────────┼─────────────────────┤
│ 1  │ Rahul    │ rahul@gmail.com   │ 9876543210   │ 0           │ COLD   │ 2024-01-15 10:00:00 │
│ 2  │ Priya    │ priya@gmail.com   │ 9876543211   │ 2           │ WARM   │ 2024-01-15 10:00:00 │
│ 3  │ Arjun    │ arjun@gmail.com   │ 9876543212   │ 5           │ HOT    │ 2024-01-15 10:00:00 │
└────┴──────────┴───────────────────┴──────────────┴─────────────┴────────┴─────────────────────┘

NOTIFICATIONS:
┌─────────────────────────────────────────────────────────┐
│ SLACK (#leads)                                          │
│ ─────────────────────────────────────────────────────── │
│ 🔥 HOT LEAD ALERT                                       │
│                                                         │
│ Name: Arjun                                             │
│ Email: arjun@gmail.com                                  │
│ Phone: 9876543212                                       │
│ Login Count: 5                                          │
│                                                         │
│ ⚡ Contact immediately!                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ GMAIL (priya@gmail.com)                                 │
│ ─────────────────────────────────────────────────────── │
│ Subject: Want to explore our product?                   │
│                                                         │
│ Hi Priya,                                               │
│                                                         │
│ We noticed you logged into the platform recently.      │
│                                                         │
│ Would you like to schedule a demo?                     │
│                                                         │
│ Best regards,                                           │
│ Your Team                                               │
└─────────────────────────────────────────────────────────┘
```

---

## System Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Metabase   │  │    Slack     │  │    Gmail     │  │
│  │  Dashboard   │  │   Alerts     │  │   Emails     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              n8n Workflow Engine                │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │    │
│  │  │  Trigger │→ │ Process  │→ │  Route   │     │    │
│  │  └──────────┘  └──────────┘  └──────────┘     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                      DATA LAYER                          │
│  ┌──────────────┐              ┌──────────────┐         │
│  │  PostgreSQL  │              │ Google Sheets│         │
│  │   Database   │              │     (CRM)    │         │
│  └──────────────┘              └──────────────┘         │
└─────────────────────────────────────────────────────────┘
```

---

## Timeline View

```
Time: 00:00 ─────────────────────────────────────────────► 00:05

00:00  Cron Trigger Fires
  │
  ├─► 00:00:01  Fetch data from Google Sheets
  │              (10 leads retrieved)
  │
  ├─► 00:00:02  Apply lead scoring logic
  │              (3 HOT, 4 WARM, 3 COLD)
  │
  ├─► 00:00:03  Store in PostgreSQL
  │              (10 records inserted)
  │
  ├─► 00:00:04  Send Slack alerts
  │              (3 hot lead notifications)
  │
  ├─► 00:00:05  Send Gmail emails
  │              (4 nurture emails)
  │
  └─► 00:00:06  Workflow complete
                 (Total time: 6 seconds)

00:05  Next execution starts...
```

---

## Integration Map

```
                    ┌─────────────┐
                    │   n8n Core  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Google Sheets │  │  PostgreSQL   │  │     Slack     │
│      API      │  │   Database    │  │   Webhook     │
└───────────────┘  └───────────────┘  └───────────────┘
        │                  │                  │
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  CRM Data     │  │  Persistent   │  │  Real-time    │
│  Source       │  │  Storage      │  │  Alerts       │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

Use these diagrams in your presentation and documentation! 📊
