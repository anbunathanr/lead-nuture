# 📁 Project File Map

Quick guide to what each file does and when to use it.

---

## 🎯 Start Here

```
📄 GETTING_STARTED.md  ← READ THIS FIRST!
📄 README.md           ← Project overview
📄 CHECKLIST.md        ← Step-by-step build guide
```

---

## 📂 Project Structure

```
Lead Nurturing/
│
├── 📄 GETTING_STARTED.md      ← Your starting point
├── 📄 README.md               ← Project overview
├── 📄 CHECKLIST.md            ← Day-by-day build guide
├── 📄 QUICK_REFERENCE.md      ← Commands & URLs
├── 📄 PROJECT_SUMMARY.md      ← Portfolio/resume content
├── 📄 package.json            ← Node.js dependencies
├── 📄 .env.example            ← Configuration template
├── 📄 .gitignore              ← Git ignore rules
│
├── 📁 database/
│   └── 📄 setup.sql           ← PostgreSQL schema
│
├── 📁 workflows/
│   ├── 📄 lead-nurturing-workflow.json  ← n8n workflow
│   └── 📄 lead-scoring-function.js      ← Scoring logic
│
├── 📁 sample-data/
│   └── 📄 crm_leads.csv       ← Test CRM data
│
├── 📁 dashboard/
│   └── 📄 metabase-queries.md ← Dashboard SQL queries
│
└── 📁 docs/
    ├── 📄 SETUP_GUIDE.md      ← Detailed setup steps
    ├── 📄 ARCHITECTURE.md     ← System design
    ├── 📄 DEMO_SCRIPT.md      ← Presentation guide
    ├── 📄 TROUBLESHOOTING.md  ← Fix common issues
    ├── 📄 ADVANCED_FEATURES.md← Future enhancements
    ├── 📄 EMAIL_TEMPLATES.md  ← Email content
    └── 📄 WORKFLOW_DIAGRAM.md ← Visual diagrams
```

---

## 📖 File Purpose Guide

### 🟢 Essential Files (Must Read)

| File | Purpose | When to Use |
|------|---------|-------------|
| **GETTING_STARTED.md** | Your roadmap | Start here |
| **README.md** | Project overview | First read |
| **CHECKLIST.md** | Build steps | During setup |
| **docs/SETUP_GUIDE.md** | Detailed instructions | When building |

### 🟡 Configuration Files (Must Use)

| File | Purpose | When to Use |
|------|---------|-------------|
| **database/setup.sql** | Database schema | Database setup |
| **workflows/lead-nurturing-workflow.json** | n8n workflow | Import to n8n |
| **.env.example** | Config template | Initial setup |
| **package.json** | Dependencies | npm install |

### 🔵 Reference Files (Use as Needed)

| File | Purpose | When to Use |
|------|---------|-------------|
| **QUICK_REFERENCE.md** | Quick commands | During work |
| **docs/TROUBLESHOOTING.md** | Fix issues | When stuck |
| **docs/ARCHITECTURE.md** | System design | Understanding flow |
| **docs/WORKFLOW_DIAGRAM.md** | Visual diagrams | Presentations |

### 🟣 Demo Files (For Presentation)

| File | Purpose | When to Use |
|------|---------|-------------|
| **docs/DEMO_SCRIPT.md** | Demo guide | Before presenting |
| **PROJECT_SUMMARY.md** | Portfolio content | Resume/LinkedIn |
| **sample-data/crm_leads.csv** | Test data | Demo preparation |

### 🟠 Advanced Files (Optional)

| File | Purpose | When to Use |
|------|---------|-------------|
| **docs/ADVANCED_FEATURES.md** | Future features | After completion |
| **docs/EMAIL_TEMPLATES.md** | Email content | Customization |
| **dashboard/metabase-queries.md** | SQL queries | Dashboard setup |

---

## 🎯 Usage Scenarios

### Scenario 1: "I'm just starting"
```
1. Read: GETTING_STARTED.md
2. Read: README.md
3. Follow: CHECKLIST.md (Day 1)
4. Reference: docs/SETUP_GUIDE.md
```

### Scenario 2: "I'm setting up the database"
```
1. Open: database/setup.sql
2. Follow: docs/SETUP_GUIDE.md (Step 3)
3. Reference: QUICK_REFERENCE.md (Database section)
```

### Scenario 3: "I'm configuring n8n"
```
1. Import: workflows/lead-nurturing-workflow.json
2. Copy: workflows/lead-scoring-function.js
3. Follow: docs/SETUP_GUIDE.md (Step 4)
4. Reference: QUICK_REFERENCE.md (Credentials)
```

### Scenario 4: "Something's not working"
```
1. Check: docs/TROUBLESHOOTING.md
2. Reference: QUICK_REFERENCE.md
3. Review: docs/SETUP_GUIDE.md
```

### Scenario 5: "I'm preparing to demo"
```
1. Read: docs/DEMO_SCRIPT.md
2. Review: PROJECT_SUMMARY.md
3. Check: QUICK_REFERENCE.md (Demo checklist)
4. Use: sample-data/crm_leads.csv
```

### Scenario 6: "I want to add features"
```
1. Read: docs/ADVANCED_FEATURES.md
2. Review: docs/ARCHITECTURE.md
3. Modify: workflows/lead-scoring-function.js
```

### Scenario 7: "I'm updating my resume"
```
1. Copy from: PROJECT_SUMMARY.md
2. Reference: docs/ARCHITECTURE.md
3. Use metrics from: README.md
```

---

## 📊 File Dependencies

```
GETTING_STARTED.md
    ↓
README.md
    ↓
CHECKLIST.md
    ↓
docs/SETUP_GUIDE.md
    ↓
┌───────────────┬───────────────┬───────────────┐
│               │               │               │
database/       workflows/      sample-data/    dashboard/
setup.sql       *.json          *.csv           *.md
│               │               │               │
└───────────────┴───────────────┴───────────────┘
                    ↓
            docs/DEMO_SCRIPT.md
                    ↓
            PROJECT_SUMMARY.md
```

---

## 🔍 Quick Find

### "How do I install n8n?"
→ **docs/SETUP_GUIDE.md** (Step 1)
→ **QUICK_REFERENCE.md** (Quick Start Commands)

### "What's the database schema?"
→ **database/setup.sql**
→ **docs/ARCHITECTURE.md**

### "How do I import the workflow?"
→ **workflows/lead-nurturing-workflow.json**
→ **docs/SETUP_GUIDE.md** (Step 4)

### "What test data should I use?"
→ **sample-data/crm_leads.csv**
→ **QUICK_REFERENCE.md** (Sample Test Data)

### "How do I demo this?"
→ **docs/DEMO_SCRIPT.md**
→ **QUICK_REFERENCE.md** (Demo Checklist)

### "Something's broken, help!"
→ **docs/TROUBLESHOOTING.md**
→ **QUICK_REFERENCE.md** (Troubleshooting Commands)

### "What features can I add?"
→ **docs/ADVANCED_FEATURES.md**

### "How do I explain this to recruiters?"
→ **PROJECT_SUMMARY.md**
→ **docs/ARCHITECTURE.md**

---

## 📝 Editing Guide

### Files You WILL Edit:
- ✏️ **.env.example** → Copy to .env and add your credentials
- ✏️ **workflows/lead-nurturing-workflow.json** → Add your Sheet ID
- ✏️ **workflows/lead-scoring-function.js** → Customize scoring logic
- ✏️ **sample-data/crm_leads.csv** → Add your test data

### Files You MIGHT Edit:
- ✏️ **docs/EMAIL_TEMPLATES.md** → Customize email content
- ✏️ **dashboard/metabase-queries.md** → Add custom queries
- ✏️ **PROJECT_SUMMARY.md** → Add your name/contact

### Files You SHOULDN'T Edit:
- ❌ **database/setup.sql** (unless you know SQL well)
- ❌ **docs/SETUP_GUIDE.md** (reference only)
- ❌ **docs/TROUBLESHOOTING.md** (reference only)

---

## 🎓 Learning Path by File

### Week 1: Setup
```
Day 1: README.md + CHECKLIST.md
Day 2: docs/SETUP_GUIDE.md + database/setup.sql
Day 3: workflows/*.json + docs/ARCHITECTURE.md
Day 4: dashboard/metabase-queries.md
Day 5: QUICK_REFERENCE.md + Testing
```

### Week 2: Customization
```
Day 1: workflows/lead-scoring-function.js
Day 2: docs/EMAIL_TEMPLATES.md
Day 3: sample-data/crm_leads.csv
Day 4: dashboard/metabase-queries.md
Day 5: docs/ADVANCED_FEATURES.md
```

### Week 3: Demo Prep
```
Day 1: docs/DEMO_SCRIPT.md
Day 2: PROJECT_SUMMARY.md
Day 3: docs/WORKFLOW_DIAGRAM.md
Day 4: Practice demo
Day 5: Record video
```

---

## 💾 Backup Priority

### Critical (Backup First):
1. workflows/lead-nurturing-workflow.json
2. database/setup.sql
3. .env (your credentials)

### Important (Backup Second):
4. workflows/lead-scoring-function.js
5. sample-data/crm_leads.csv
6. Custom modifications

### Reference (Can re-download):
- All docs/*.md files
- README.md
- CHECKLIST.md

---

## 🎯 File Size Reference

| File | Approx Size | Read Time |
|------|-------------|-----------|
| GETTING_STARTED.md | 5 KB | 10 min |
| README.md | 3 KB | 5 min |
| CHECKLIST.md | 8 KB | 15 min |
| docs/SETUP_GUIDE.md | 12 KB | 25 min |
| docs/DEMO_SCRIPT.md | 6 KB | 12 min |
| PROJECT_SUMMARY.md | 7 KB | 15 min |
| QUICK_REFERENCE.md | 5 KB | 10 min |

**Total reading time:** ~90 minutes

---

## 🚀 Quick Start Path

```
1. GETTING_STARTED.md (10 min)
   ↓
2. README.md (5 min)
   ↓
3. CHECKLIST.md (15 min)
   ↓
4. Start building! 🎉
```

---

**Remember:** You don't need to read everything at once. Start with GETTING_STARTED.md and follow the path! 🎯
