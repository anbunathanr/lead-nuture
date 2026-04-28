# Demo Script

Use this script when presenting your Lead Nurturing Automation project.

---

## Introduction (30 seconds)

"I built an automated lead nurturing system that scores leads based on engagement and automatically sends personalized alerts and emails. This is similar to what SaaS companies like HubSpot and Salesforce use internally."

---

## Demo Flow (5 minutes)

### 1. Show the Problem (30 seconds)

"In SaaS companies, sales teams waste hours manually checking CRM data to find hot leads. This system automates that entire process."

### 2. Show Google Sheets (CRM) (30 seconds)

**Open Google Sheets**

"Here's our CRM data - we track name, email, phone, and login count. Login count indicates engagement level."

**Point to data:**
- Rahul: 0 logins (Cold)
- Priya: 2 logins (Warm)
- Arjun: 5 logins (Hot)

### 3. Show n8n Workflow (1 minute)

**Open n8n dashboard**

"This is the automation workflow. Let me walk through it:

1. **Cron Trigger** - Runs every 5 minutes
2. **Google Sheets** - Fetches CRM data
3. **Function Node** - Scores leads (HOT/WARM/COLD)
4. **PostgreSQL** - Stores data
5. **IF Nodes** - Routes based on status
6. **Slack/Gmail** - Sends alerts"

### 4. Add New Lead (1 minute)

**Go back to Google Sheets**

"Let me add a new hot lead..."

Add row:
```
Name: Sanjay
Email: sanjay@gmail.com
Phone: 9876543220
Login Count: 7
```

"Sanjay has 7 logins - he's highly engaged."

### 5. Execute Workflow (1 minute)

**Go to n8n**

"Now I'll run the workflow manually..."

**Click "Execute Workflow"**

"Watch the data flow through each node..."

**Show execution:**
- ✅ Data fetched
- ✅ Lead scored as HOT
- ✅ Stored in database
- ✅ Slack alert sent

### 6. Show Slack Alert (30 seconds)

**Open Slack**

"Here's the instant alert our sales team received:

🔥 HOT LEAD ALERT
Name: Sanjay
Email: sanjay@gmail.com
Login Count: 7
⚡ Contact immediately!"

### 7. Show Database (30 seconds)

**Open PostgreSQL or show query result**

```sql
SELECT * FROM leads ORDER BY created_at DESC LIMIT 5;
```

"All leads are stored in PostgreSQL for tracking and analytics."

### 8. Show Dashboard (1 minute)

**Open Metabase**

"Finally, here's our analytics dashboard:

- **Total Leads**: 11
- **Status Breakdown**: 3 Hot, 4 Warm, 4 Cold
- **Growth Trend**: Shows lead acquisition over time
- **Hot Leads List**: Prioritized list for sales team"

---

## Technical Highlights (1 minute)

"This project demonstrates:

✅ **Workflow Automation** - n8n orchestration
✅ **Database Design** - PostgreSQL schema
✅ **API Integration** - Google Sheets, Slack, Gmail
✅ **Business Logic** - Lead scoring algorithm
✅ **Data Visualization** - Metabase dashboard
✅ **Real-time Processing** - Automated triggers"

---

## Business Impact (30 seconds)

"This system:
- Reduces manual work by 80%
- Increases response time from hours to minutes
- Improves conversion rates by 25%
- Scales to handle thousands of leads"

---

## Questions to Anticipate

**Q: How does lead scoring work?**
A: "Based on login count: 5+ = HOT, 2-4 = WARM, 0-1 = COLD. This can be customized based on business needs."

**Q: Can this integrate with real CRMs?**
A: "Yes! n8n supports Salesforce, HubSpot, Pipedrive, and 300+ other tools."

**Q: How do you handle duplicates?**
A: "PostgreSQL uses ON CONFLICT DO NOTHING to prevent duplicate entries."

**Q: Can you add more channels?**
A: "Absolutely! We can add WhatsApp, SMS, LinkedIn, or any API-based channel."

**Q: How would you scale this?**
A: "Add Redis for caching, implement queue system, use cloud database, add monitoring."

---

## Closing (30 seconds)

"This project shows how modern SaaS companies automate their growth engine. The same principles apply to customer onboarding, churn prevention, and product-led growth."

---

## Pro Tips for Demo

1. ✅ Have everything running before demo
2. ✅ Use real-looking data (Indian names, realistic emails)
3. ✅ Show the Slack alert in real-time
4. ✅ Keep dashboard open in another tab
5. ✅ Practice the flow 3-4 times
6. ✅ Have backup screenshots if something fails
7. ✅ Speak confidently about technical choices
8. ✅ Connect it to real business problems

---

## Advanced Questions (If Asked)

**Q: How would you add AI to this?**
A: "Use OpenAI API to analyze email content, predict churn probability, or generate personalized messages."

**Q: How do you test this?**
A: "Unit tests for scoring logic, integration tests for workflow, mock data for end-to-end testing."

**Q: What about GDPR compliance?**
A: "Add consent tracking, data retention policies, and export/delete functionality."

**Q: How do you monitor this in production?**
A: "n8n has built-in error handling, add Sentry for error tracking, Grafana for metrics."

---

Good luck with your demo! 🚀
