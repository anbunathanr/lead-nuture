# Requirements Document

## Introduction

This feature replaces the existing form-based lead input with a direct integration to the Frappe CRM system (running at `http://34.196.221.16:8000`). The system will periodically fetch leads from the CRM's `CRM Lead` doctype, apply the existing Hot/Warm/Cold scoring logic, dispatch multi-channel notifications (Email, WhatsApp, Slack, Telegram), schedule follow-ups, and write the computed score and status back to the CRM — creating a closed-loop automation pipeline.

The existing Express + PostgreSQL + notifications stack is kept intact; only the lead ingestion source changes from a web form to the CRM API.

## Glossary

- **CRM**: The Frappe-based CRM instance at `http://34.196.221.16:8000`
- **CRM Lead**: The Frappe doctype that stores lead records (accessed via `/api/resource/CRM Lead`)
- **Session ID (sid)**: Cookie-based authentication token required by the Frappe REST API
- **Lead Score**: Integer computed from CRM lead fields to determine priority
- **Lead Status**: Classification of a lead as HOT, WARM, or COLD based on Lead Score
- **Sync**: The process of writing computed Lead Status and score back to the CRM record
- **Poller**: The scheduled process that fetches new/updated leads from the CRM
- **Deduplication**: Preventing the same CRM lead from being processed more than once
- **Notification Dispatcher**: The existing `dispatchAlerts` function in `notifications.js`
- **Follow-up Scheduler**: The existing `scheduleFollowups` function in `notifications.js`

---

## Requirements

### Requirement 1: CRM API Connectivity

**User Story:** As a system administrator, I want the system to authenticate with the Frappe CRM API, so that lead data can be fetched securely.

#### Acceptance Criteria

1. THE System SHALL read the CRM base URL from the `CRM_BASE_URL` environment variable
2. THE System SHALL read the Frappe session ID from the `CRM_SID` environment variable
3. WHEN the CRM API returns a 401 or 403 response, THE System SHALL log an authentication error and skip that polling cycle
4. IF `CRM_BASE_URL` or `CRM_SID` is not set, THEN THE System SHALL log a configuration warning and disable CRM polling without crashing

---

### Requirement 2: Lead Fetching (Polling)

**User Story:** As a sales team member, I want the system to automatically pull new leads from the CRM every 5 minutes, so that no lead is missed.

#### Acceptance Criteria

1. THE Poller SHALL fetch leads from `/api/resource/CRM Lead` with fields: `name`, `lead_name`, `email_id`, `mobile_no`, `status`, `organization`, `source`, `notes`
2. WHEN the Poller runs, THE System SHALL request only leads whose CRM `status` is `"New"` to avoid reprocessing already-handled leads
3. THE Poller SHALL run on the same 5-minute interval already used by `processDueFollowups`
4. IF the CRM API request fails with a network error, THEN THE System SHALL log the error and retry on the next scheduled interval
5. WHEN the CRM returns an empty list, THE Poller SHALL complete silently without error

---

### Requirement 3: Lead Mapping and Deduplication

**User Story:** As a developer, I want CRM lead fields mapped to the internal lead schema, so that the existing scoring and notification logic works without modification.

#### Acceptance Criteria

1. THE System SHALL map CRM field `lead_name` → internal `name`
2. THE System SHALL map CRM field `email_id` → internal `email`
3. THE System SHALL map CRM field `mobile_no` → internal `phone`
4. THE System SHALL map CRM field `organization` → internal `company`
5. THE System SHALL map CRM field `source` → internal `industry`
6. THE System SHALL map CRM field `notes` → internal `notes`
7. WHEN a lead with the same `email` already exists in the local PostgreSQL database, THE System SHALL skip insertion and not re-trigger notifications
8. IF any required field (`name`, `email`) is missing from the CRM record, THEN THE System SHALL log a warning and skip that record

---

### Requirement 4: Lead Scoring from CRM Data

**User Story:** As a sales manager, I want CRM leads scored using available CRM fields, so that the team can prioritize outreach correctly.

#### Acceptance Criteria

1. THE System SHALL compute a Lead Score for each CRM lead using the following rules:
   - `status === "New"` → +1 point
   - `status === "Replied"` → +3 points
   - `status === "Interested"` → +4 points
   - `source` is non-empty → +1 point
   - `organization` is non-empty → +1 point
2. THE System SHALL classify leads as: score ≥ 7 → `HOT`, score ≥ 3 → `WARM`, score < 3 → `COLD`
3. THE System SHALL store the computed score in the `login_count` column (reusing existing schema) and the classification in `lead_status`

---

### Requirement 5: Notification Dispatch

**User Story:** As a sales team member, I want to receive alerts on Slack, Telegram, WhatsApp, and Email when a CRM lead is ingested, so that I can act immediately.

#### Acceptance Criteria

1. WHEN a CRM lead is successfully stored, THE System SHALL call the existing `dispatchAlerts` function with the mapped lead object and product string
2. THE System SHALL pass the CRM `organization` field as the `products` string to `dispatchAlerts`
3. WHEN a lead is classified as HOT, THE System SHALL trigger Slack and Telegram team alerts in addition to customer-facing channels
4. THE System SHALL schedule follow-ups by calling the existing `scheduleFollowups` function after storing the lead

---

### Requirement 6: CRM Status Sync (Write-back)

**User Story:** As a sales manager, I want the CRM record updated with the computed lead status, so that the CRM reflects the current state of each lead.

#### Acceptance Criteria

1. WHEN a lead is scored and stored locally, THE System SHALL send a `PUT` request to `/api/resource/CRM Lead/{name}` with `{ "status": "<HOT|WARM|COLD>" }`
2. IF the CRM write-back request fails, THEN THE System SHALL log the error but continue processing remaining leads without stopping
3. THE System SHALL perform the write-back after local storage and notification dispatch succeed

---

### Requirement 7: API Endpoint for Manual CRM Sync

**User Story:** As a developer, I want a REST endpoint to manually trigger a CRM sync, so that I can test and debug the integration without waiting for the cron.

#### Acceptance Criteria

1. THE System SHALL expose a `POST /api/crm/sync` endpoint that immediately triggers one full CRM polling cycle
2. WHEN the sync completes, THE System SHALL return a JSON response with `{ processed: N, skipped: N, errors: N }`
3. IF CRM credentials are not configured, THEN THE System SHALL return HTTP 503 with `{ error: "CRM not configured" }`

---

### Requirement 8: CRM API Health Check

**User Story:** As a developer, I want a health-check endpoint for the CRM connection, so that I can verify credentials and connectivity quickly.

#### Acceptance Criteria

1. THE System SHALL expose a `GET /api/crm/health` endpoint
2. WHEN the CRM API is reachable and credentials are valid, THE System SHALL return `{ status: "ok", crm: "<CRM_BASE_URL>" }`
3. WHEN the CRM API is unreachable or returns an auth error, THE System SHALL return HTTP 503 with `{ status: "error", message: "<reason>" }`
