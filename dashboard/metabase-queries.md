# Metabase Dashboard Queries

## 1. Total Leads Count
```sql
SELECT COUNT(*) as total_leads
FROM leads;
```
**Chart Type:** Number

---

## 2. Leads by Status
```sql
SELECT 
    lead_status,
    COUNT(*) as count
FROM leads
GROUP BY lead_status
ORDER BY count DESC;
```
**Chart Type:** Pie Chart

---

## 3. Login Activity Distribution
```sql
SELECT 
    login_count,
    COUNT(*) as lead_count
FROM leads
GROUP BY login_count
ORDER BY login_count;
```
**Chart Type:** Bar Chart

---

## 4. Leads Growth Over Time
```sql
SELECT 
    DATE(created_at) as date,
    COUNT(*) as new_leads
FROM leads
GROUP BY DATE(created_at)
ORDER BY date;
```
**Chart Type:** Line Chart

---

## 5. Hot Leads List
```sql
SELECT 
    name,
    email,
    phone,
    login_count,
    created_at
FROM leads
WHERE lead_status = 'HOT'
ORDER BY created_at DESC
LIMIT 10;
```
**Chart Type:** Table

---

## 6. Average Login Count by Status
```sql
SELECT 
    lead_status,
    AVG(login_count) as avg_logins,
    COUNT(*) as total_leads
FROM leads
GROUP BY lead_status;
```
**Chart Type:** Bar Chart

---

## 7. Recent Leads (Last 24 Hours)
```sql
SELECT 
    name,
    email,
    lead_status,
    login_count,
    created_at
FROM leads
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```
**Chart Type:** Table

---

## 8. Lead Status Funnel
```sql
SELECT 
    CASE 
        WHEN lead_status = 'HOT' THEN 1
        WHEN lead_status = 'WARM' THEN 2
        WHEN lead_status = 'COLD' THEN 3
    END as stage_order,
    lead_status,
    COUNT(*) as count
FROM leads
GROUP BY lead_status
ORDER BY stage_order;
```
**Chart Type:** Funnel Chart
