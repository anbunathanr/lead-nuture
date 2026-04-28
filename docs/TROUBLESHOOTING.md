# Troubleshooting Guide

## Common Issues and Solutions

### 1. n8n Won't Start

**Error:** Port 5678 already in use

**Solution:**
```bash
# Windows
netstat -ano | findstr :5678
taskkill /PID <PID> /F

# Then restart
n8n start
```

---

### 2. PostgreSQL Connection Failed

**Error:** Connection refused to localhost:5432

**Solutions:**

**Check if PostgreSQL is running:**
```bash
# Windows
sc query postgresql-x64-14

# Start if not running
net start postgresql-x64-14
```

**Verify credentials:**
```sql
psql -U postgres -d lead_nurturing
```

**Check pg_hba.conf:**
- Location: `C:\Program Files\PostgreSQL\14\data\pg_hba.conf`
- Add: `host all all 127.0.0.1/32 md5`

---

### 3. Google Sheets Not Fetching Data

**Error:** Invalid credentials or Sheet ID

**Solutions:**

1. **Verify Sheet ID:**
   - URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`
   - Copy the SHEET_ID part

2. **Re-authenticate:**
   - Delete credential in n8n
   - Create new credential
   - Complete OAuth flow

3. **Check permissions:**
   - Sheet must be shared with your Google account
   - Or set to "Anyone with link can view"

---

### 4. Workflow Execution Fails

**Error:** Node execution failed

**Solutions:**

1. **Test each node individually:**
   - Click "Execute Node" on each step
   - Check output data

2. **Check data format:**
   - Ensure Google Sheets has headers
   - Verify column names match workflow

3. **Enable error workflow:**
   - Settings → Error Workflow
   - Add error handling nodes

---

### 5. Slack Alerts Not Sending

**Error:** Webhook URL invalid

**Solutions:**

1. **Verify webhook:**
   - Go to https://api.slack.com/apps
   - Check webhook URL is active
   - Test with curl:
   ```bash
   curl -X POST -H 'Content-type: application/json' --data '{"text":"Test"}' YOUR_WEBHOOK_URL
   ```

2. **Check channel:**
   - Ensure channel exists
   - Bot must be invited to channel

---

### 6. Gmail Not Sending Emails

**Error:** Authentication failed

**Solutions:**

1. **Enable 2-Step Verification:**
   - Google Account → Security
   - Turn on 2-Step Verification

2. **Create App Password:**
   - Google Account → Security → App passwords
   - Generate password for "Mail"
   - Use this in n8n

3. **Check Gmail API:**
   - Enable Gmail API in Google Cloud Console
   - Add OAuth consent screen

---

### 7. Metabase Can't Connect to Database

**Error:** Connection refused

**Solutions:**

1. **Use correct host:**
   - Windows/Mac: `host.docker.internal`
   - Linux: `172.17.0.1`

2. **Check PostgreSQL allows external connections:**
   - Edit `postgresql.conf`
   - Set: `listen_addresses = '*'`
   - Restart PostgreSQL

3. **Verify credentials:**
   ```bash
   psql -h localhost -U postgres -d lead_nurturing
   ```

---

### 8. Workflow Not Running Automatically

**Error:** Cron trigger not firing

**Solutions:**

1. **Activate workflow:**
   - Toggle "Active" switch in n8n
   - Check workflow is saved

2. **Verify cron expression:**
   - `*/5 * * * *` = every 5 minutes
   - Test with shorter interval: `*/1 * * * *`

3. **Check n8n logs:**
   ```bash
   # View logs
   n8n start --log-level debug
   ```

---

### 9. Database Table Not Created

**Error:** Relation "leads" does not exist

**Solution:**
```bash
# Run setup script again
psql -U postgres -f database/setup.sql

# Or manually create table
psql -U postgres -d lead_nurturing
CREATE TABLE leads (...);
```

---

### 10. Data Not Showing in Dashboard

**Error:** No data in Metabase

**Solutions:**

1. **Verify data in database:**
   ```sql
   SELECT * FROM leads;
   ```

2. **Refresh Metabase schema:**
   - Admin → Databases
   - Click "Sync database schema now"

3. **Check query:**
   - Test SQL query directly in Metabase SQL editor

---

## Performance Issues

### Workflow Running Slow

**Solutions:**
- Reduce cron frequency
- Add batch processing
- Optimize database queries
- Add indexes to database

### Database Growing Too Large

**Solutions:**
```sql
-- Archive old leads
CREATE TABLE leads_archive AS 
SELECT * FROM leads WHERE created_at < NOW() - INTERVAL '90 days';

-- Delete archived leads
DELETE FROM leads WHERE created_at < NOW() - INTERVAL '90 days';

-- Vacuum database
VACUUM FULL;
```

---

## Getting Help

1. **n8n Community:** https://community.n8n.io/
2. **PostgreSQL Docs:** https://www.postgresql.org/docs/
3. **Metabase Forum:** https://discourse.metabase.com/

---

## Debug Checklist

Before asking for help, verify:

- [ ] All services are running (n8n, PostgreSQL, Metabase)
- [ ] Credentials are correct
- [ ] Database table exists
- [ ] Google Sheet has correct format
- [ ] Workflow is activated
- [ ] No firewall blocking ports
- [ ] Logs checked for errors
- [ ] Each node tested individually
