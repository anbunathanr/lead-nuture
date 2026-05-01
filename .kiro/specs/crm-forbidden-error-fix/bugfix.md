# Bugfix Requirements Document

## Introduction

The n8n workflow "Lead Nurturing - Categorized Multi-Channel" fails with a "Forbidden" error when attempting to fetch CRM leads from the Frappe CRM API, despite successful authentication. The workflow runs every 5 minutes via cron trigger and uses a static session ID (`CRM_SID`) from environment variables. The error occurs because the Frappe session cookie expires after a period of inactivity, but the n8n workflow continues using the stale session ID without re-authenticating.

The existing `crm.js` module already implements dynamic session management with automatic login and session refresh, but the n8n workflow bypasses this logic by directly calling the CRM API with a hardcoded session cookie.

**Impact:** The workflow fails to fetch new leads, preventing automated lead nurturing and notification dispatch. Manual intervention is required to update the `CRM_SID` environment variable whenever the session expires.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the n8n workflow executes the "Fetch CRM Leads" HTTP Request node with a static `CRM_SID` cookie AND the Frappe session has expired THEN the system returns HTTP 403 Forbidden with error message "No permission for CRM Lead"

1.2 WHEN the n8n workflow executes the "Fetch CRM Leads" HTTP Request node with an expired session THEN the system logs "[CRM] Network error during fetch: fetch failed" and does not retry with fresh credentials

1.3 WHEN the n8n workflow executes the "Update CRM Status" HTTP Request node with an expired session THEN the system fails to write back lead status to the CRM without error recovery

### Expected Behavior (Correct)

2.1 WHEN the n8n workflow needs to fetch CRM leads AND the session has expired THEN the system SHALL automatically re-authenticate with the CRM using stored credentials and retry the request with a fresh session

2.2 WHEN the n8n workflow encounters a 403 or 401 error from the CRM API THEN the system SHALL clear the cached session, obtain a new session via login, and retry the failed request once

2.3 WHEN the n8n workflow needs to update CRM lead status AND the session has expired THEN the system SHALL automatically re-authenticate and complete the write-back operation successfully

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the n8n workflow executes with a valid, non-expired session THEN the system SHALL CONTINUE TO fetch CRM leads successfully without triggering re-authentication

3.2 WHEN the existing `crm.js` module's `pollCrmLeads()` function is called directly (outside n8n) THEN the system SHALL CONTINUE TO handle session management and retry logic as currently implemented

3.3 WHEN the n8n workflow processes leads with valid sessions THEN the system SHALL CONTINUE TO classify leads, dispatch notifications, and update CRM status as currently implemented

3.4 WHEN the CRM API returns errors other than 401/403 (e.g., 500, network timeout) THEN the system SHALL CONTINUE TO log the error and fail gracefully without infinite retry loops
