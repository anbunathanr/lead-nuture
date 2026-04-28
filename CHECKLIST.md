# Quick Start Checklist

Use this checklist to build the project step by step.

---

## Pre-Setup

- [ ] Node.js installed (v16+)
- [ ] PostgreSQL installed
- [ ] Docker installed (for Metabase)
- [ ] Google account created
- [ ] Slack workspace access (optional)

---

## Day 1: Setup Infrastructure

### Morning (2-3 hours)

- [ ] Install n8n globally
  ```bash
  npm install n8n -g
  ```

- [ ] Start n8n and verify
  ```bash
  n8n start
  # Open http://localhost:5678
  ```

- [ ] Create PostgreSQL database
  ```bash
  psql -U postgres -f database/setup.sql
  ```

- [ ] Verify database
  ```sql
  \c lead_nurturing
  SELECT * FROM leads;
  ```

### Afternoon (2-3 hours)

- [ ] Create Google Sheet "CRM_Leads"
- [ ] Add headers: name, email, phone, login_count
- [ ] Import sample data from `sample-data/crm_leads.csv`
- [ ] Copy Sheet ID from URL
- [ ] Share sheet (Anyone with link can view)

---

## Day 2: Build n8n Workflow

### Morning (2-3 hours)

- [ ] Open n8n (http://localhost:5678)
- [ ] Import workflow from `workflows/lead-nurturing-workflow.json`
- [ ] Configure Google Sheets credential
  - [ ] Authenticate with Google
  - [ ] Replace YOUR_SHEET_ID with actual ID
- [ ] Test Google Sheets node
  - [ ] Click "Execute Node"
  - [ ] Verify data appears

### Afternoon (2-3 hours)

- [ ] Configure PostgreSQL credential
  - [ ] Host: localhost
  - [ ] Database: lead_nurturing
  - [ ] User: postgres
  - [ ] Password: your_password
  - [ ] Port: 5432
- [ ] Test PostgreSQL node
- [ ] Test Function node (lead scoring)
- [ ] Execute full workflow
- [ ] Verify data in database

---

## Day 3: Setup Notifications

### Morning (2 hours)

- [ ] Create Slack app (optional)
  - [ ] Go to https://api.slack.com/apps
  - [ ] Create new app
  - [ ] Enable Incoming Webhooks
  - [ ] Copy webhook URL
- [ ] Configure Slack credential in n8n
- [ ] Test Slack alert
- [ ] Add test hot lead in Google Sheets
- [ ] Execute workflow
- [ ] Verify Slack message received

### Afternoon (2 hours)

- [ ] Configure Gmail credential (optional)
  - [ ] Enable 2-Step Verification
  - [ ] Create App Password
  - [ ] Add credential in n8n
- [ ] Test Gmail node
- [ ] Add test warm lead
- [ ] Execute workflow
- [ ] Verify email received

---

## Day 4: Setup Dashboard

### Morning (2 hours)

- [ ] Start Metabase
  ```bash
  docker run -d -p 3000:3000 --name metabase metabase/metabase
  ```
- [ ] Open http://localhost:3000
- [ ] Create admin account
- [ ] Add PostgreSQL database
  - [ ] Host: host.docker.internal (Windows/Mac)
  - [ ] Port: 5432
  - [ ] Database: lead_nurturing
  - [ ] Username: postgres
  - [ ] Password: your_password
- [ ] Test connection

### Afternoon (2-3 hours)

- [ ] Create new dashboard "Lead Nurturing"
- [ ] Add "Total Leads" card
- [ ] Add "Leads by Status" pie chart
- [ ] Add "Login Activity" bar chart
- [ ] Add "Leads Growth" line chart
- [ ] Add "Hot Leads List" table
- [ ] Arrange dashboard layout
- [ ] Save dashboard

---

## Day 5: Testing & Demo Prep

### Morning (2 hours)

- [ ] Activate workflow in n8n
- [ ] Wait 5 minutes for auto-execution
- [ ] Verify workflow ran automatically
- [ ] Add 3 new test leads
- [ ] Wait for next execution
- [ ] Verify all alerts sent
- [ ] Check database updated
- [ ] Refresh dashboard

### Afternoon (2 hours)

- [ ] Practice demo flow
- [ ] Prepare demo script
- [ ] Take screenshots of each step
- [ ] Record demo video (optional)
- [ ] Test on different browser
- [ ] Verify all services running
- [ ] Create backup of workflow

---

## Final Verification

- [ ] n8n workflow active and running
- [ ] PostgreSQL database has data
- [ ] Google Sheets connected
- [ ] Slack alerts working (if configured)
- [ ] Gmail emails sending (if configured)
- [ ] Metabase dashboard showing data
- [ ] All credentials saved
- [ ] Documentation reviewed

---

## Demo Day Checklist

### 30 Minutes Before

- [ ] Start all services
  - [ ] n8n: `n8n start`
  - [ ] PostgreSQL: Check running
  - [ ] Metabase: Check http://localhost:3000
- [ ] Open all tabs
  - [ ] Google Sheets
  - [ ] n8n workflow
  - [ ] Slack channel
  - [ ] Gmail inbox
  - [ ] Metabase dashboard
- [ ] Test workflow once
- [ ] Clear recent test data (optional)
- [ ] Prepare demo lead data

### During Demo

- [ ] Show Google Sheets (CRM)
- [ ] Explain workflow in n8n
- [ ] Add new hot lead
- [ ] Execute workflow
- [ ] Show Slack alert
- [ ] Show database query
- [ ] Show Metabase dashboard
- [ ] Answer questions confidently

### After Demo

- [ ] Share GitHub repo link
- [ ] Share documentation
- [ ] Offer to explain technical details
- [ ] Collect feedback

---

## Troubleshooting Quick Fixes

### n8n won't start
```bash
npx kill-port 5678
n8n start
```

### PostgreSQL not connecting
```bash
# Check if running
sc query postgresql-x64-14

# Start if needed
net start postgresql-x64-14
```

### Workflow not executing
- Check workflow is activated (toggle switch)
- Check cron expression is correct
- Check n8n logs for errors

### No data in dashboard
- Verify data in database: `SELECT * FROM leads;`
- Sync Metabase schema: Admin → Databases → Sync
- Refresh dashboard

---

## Time Estimate

| Phase | Time |
|-------|------|
| Setup Infrastructure | 4-6 hours |
| Build Workflow | 4-6 hours |
| Setup Notifications | 3-4 hours |
| Setup Dashboard | 4-5 hours |
| Testing & Demo Prep | 4 hours |
| **Total** | **19-25 hours** |

---

## Success Criteria

✅ Workflow runs automatically every 5 minutes
✅ Leads are scored correctly (HOT/WARM/COLD)
✅ Data is stored in PostgreSQL
✅ Slack alerts sent for hot leads
✅ Emails sent for warm leads
✅ Dashboard shows real-time data
✅ Demo runs smoothly end-to-end

---

## Next Steps After Completion

1. Add to GitHub with good README
2. Record demo video
3. Write blog post about project
4. Add to portfolio website
5. Share on LinkedIn
6. Consider advanced features
7. Apply to relevant jobs

---

Good luck building! 🚀

If you get stuck, check `docs/TROUBLESHOOTING.md`
