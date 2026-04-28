# Complete Setup Guide

## Prerequisites
- Node.js installed
- PostgreSQL installed
- Docker installed (for Metabase)
- Google account
- Slack workspace (optional)

---

## Step 1: Install n8n

```bash
npm install n8n -g
```

Start n8n:
```bash
n8n start
```

Access at: http://localhost:5678

---

## Step 2: Setup Google Sheets (CRM)

1. Go to Google Sheets
2. Create new sheet named "CRM_Leads"
3. Add headers: `name | email | phone | login_count`
4. Import data from `sample-data/crm_leads.csv`
5. Share sheet and copy the Sheet ID from URL

---

## Step 3: Setup PostgreSQL Database

Open terminal and run:

```bash
psql -U postgres
```

Then execute:
```bash
psql -U postgres -f database/setup.sql
```

Verify:
```sql
\c lead_nurturing
SELECT * FROM leads;
```

---

## Step 4: Configure n8n Workflow

### 4.1 Import Workflow
1. Open n8n (http://localhost:5678)
2. Click "Import from File"
3. Select `workflows/lead-nurturing-workflow.json`

### 4.2 Configure Google Sheets Credential
1. Click on "Google Sheets" node
2. Create new credential
3. Authenticate with Google
4. Replace `YOUR_SHEET_ID` with your actual Sheet ID

### 4.3 Configure PostgreSQL Credential
1. Click on "PostgreSQL" node
2. Create new credential
3. Enter:
   - Host: localhost
   - Database: lead_nurturing
   - User: postgres
   - Password: your_password
   - Port: 5432

### 4.4 Configure Slack Credential (Optional)
1. Go to https://api.slack.com/apps
2. Create new app
3. Add "Incoming Webhooks"
4. Copy webhook URL
5. In n8n, add Slack credential with webhook

### 4.5 Configure Gmail Credential (Optional)
1. Click on "Gmail" node
2. Create new credential
3. Authenticate with Google
4. Grant permissions

---

## Step 5: Test the Workflow

1. Click "Execute Workflow" in n8n
2. Check if data flows through all nodes
3. Verify data in PostgreSQL:
   ```sql
   SELECT * FROM leads ORDER BY created_at DESC;
   ```
4. Check Slack for hot lead alerts
5. Check Gmail for warm lead emails

---

## Step 6: Setup Metabase Dashboard

### 6.1 Start Metabase
```bash
docker run -d -p 3000:3000 --name metabase metabase/metabase
```

Access at: http://localhost:3000

### 6.2 Initial Setup
1. Create admin account
2. Click "Add Database"
3. Select PostgreSQL
4. Enter connection details:
   - Name: Lead Nurturing
   - Host: host.docker.internal (Windows/Mac) or localhost
   - Port: 5432
   - Database: lead_nurturing
   - Username: postgres
   - Password: your_password

### 6.3 Create Dashboard
1. Click "New" → "Dashboard"
2. Name it "Lead Nurturing Dashboard"
3. Add questions using queries from `dashboard/metabase-queries.md`

---

## Step 7: Enable Automation

In n8n:
1. Activate the workflow (toggle switch)
2. Workflow will run every 5 minutes automatically

---

## Step 8: Demo the Project

### Demo Script:
1. **Show Google Sheets** - Your CRM data source
2. **Show n8n workflow** - Explain each node
3. **Add new lead** in Google Sheets with login_count = 6
4. **Execute workflow** manually
5. **Show Slack alert** for hot lead
6. **Show database** - New lead stored
7. **Show Metabase dashboard** - Updated metrics

---

## Troubleshooting

### n8n won't start
```bash
# Kill existing process
npx kill-port 5678
n8n start
```

### PostgreSQL connection error
- Check if PostgreSQL is running
- Verify credentials
- Check port 5432 is not blocked

### Google Sheets not fetching data
- Verify Sheet ID is correct
- Check Google Sheets credential is authenticated
- Ensure sheet is shared properly

### Metabase can't connect to database
- Use `host.docker.internal` instead of `localhost` on Windows/Mac
- Check PostgreSQL allows external connections

---

## Next Steps

✅ Project is complete!

### Enhancements you can add:
- WhatsApp integration
- AI-powered lead scoring
- A/B testing for emails
- Lead behavior tracking
- Automated demo scheduling
- Multi-channel nurturing
- Predictive analytics

---

## Project Demo Points

When presenting this project, highlight:

1. **Real-world application** - Solves actual SaaS problem
2. **Full-stack skills** - Database, automation, analytics
3. **Scalability** - Can handle thousands of leads
4. **Integration skills** - Multiple tools working together
5. **Business impact** - Increases conversion rates
6. **Automation expertise** - Reduces manual work

This project demonstrates skills needed for:
- Marketing Automation Engineer
- Backend Developer
- SaaS Engineer
- Growth Engineer
- Data Engineer
