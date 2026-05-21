# CRM Forbidden Error Bugfix Design

## Overview

The n8n workflow fails with HTTP 403 Forbidden errors when the Frappe CRM session expires. The workflow uses a static `CRM_SID` environment variable that becomes stale after session expiration, causing all CRM API requests to fail. The fix will implement automatic session refresh logic within the n8n workflow to detect authentication failures (401/403 responses) and retry with fresh credentials, mirroring the session management already present in the `crm.js` module.

The fix ensures the workflow can recover from expired sessions without manual intervention, maintaining continuous lead nurturing operations.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the n8n workflow makes CRM API requests with an expired session cookie
- **Property (P)**: The desired behavior when authentication fails - the workflow should automatically re-authenticate and retry the request
- **Preservation**: Existing workflow behavior with valid sessions, error handling for non-auth errors, and all downstream lead processing logic must remain unchanged
- **Fetch CRM Leads node**: The HTTP Request node in the n8n workflow that fetches leads from `http://34.196.221.16:8000/api/resource/CRM Lead`
- **Update CRM Status node**: The HTTP Request node that writes lead status back to the CRM via PUT request
- **Session expiration**: When the Frappe CRM invalidates the `sid` cookie due to inactivity or timeout
- **CRM_SID**: Environment variable containing the static Frappe session ID used by the n8n workflow
- **crm.js module**: The Node.js module with existing session management logic (`getCrmSid()`, `clearCrmSession()`, `crmHeaders()`)

---

## Bug Details

### Bug Condition

The bug manifests when the n8n workflow executes HTTP requests to the Frappe CRM API using a session cookie that has expired. The workflow's "Fetch CRM Leads" and "Update CRM Status" nodes use a static `CRM_SID` from environment variables, which becomes invalid after the Frappe session times out. When this occurs, the CRM API returns HTTP 403 Forbidden, but the workflow has no retry or re-authentication logic.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { httpRequest: HTTPRequest, response: HTTPResponse }
  OUTPUT: boolean
  
  RETURN input.httpRequest.url CONTAINS "api/resource/CRM Lead"
         AND input.httpRequest.headers.Cookie CONTAINS "sid="
         AND (input.response.status = 403 OR input.response.status = 401)
         AND input.response.body CONTAINS "No permission"
END FUNCTION
```

### Examples

- **Fetch operation with expired session**: The "Fetch CRM Leads" node executes with `Cookie: sid=expired_session_id_123`, receives HTTP 403 with body `{"exc_type": "PermissionError", "exception": "No permission for CRM Lead"}`, and the workflow fails without retry. Expected: Workflow should re-authenticate and retry.

- **Write-back operation with expired session**: The "Update CRM Status" node executes PUT request with expired session, receives HTTP 403, and fails to update lead status in CRM. Expected: Workflow should re-authenticate and complete the write-back.

- **Multiple consecutive requests with expired session**: The workflow fetches leads (fails with 403), then attempts to update status (also fails with 403), requiring two separate manual interventions. Expected: Single re-authentication should fix both operations.

- **Edge case - Network error vs auth error**: The CRM API returns HTTP 500 (server error) instead of 403. Expected: Workflow should fail gracefully without triggering re-authentication logic (not an auth issue).

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Successful CRM API requests with valid sessions must continue to work exactly as before
- Lead classification logic (HOT/WARM/COLD) must remain unchanged
- Notification dispatch to Slack, Telegram, Email, SMS, WhatsApp must continue working
- Error handling for non-authentication errors (500, network timeout, etc.) must remain unchanged
- The existing `crm.js` module's session management must continue working independently

**Scope:**
All inputs that do NOT involve expired session authentication (401/403 errors) should be completely unaffected by this fix. This includes:
- Valid session requests that succeed on first attempt
- Non-authentication errors (HTTP 500, 502, network failures)
- Downstream lead processing after successful CRM fetch
- All notification channels and their message formatting

---

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Static Session Cookie**: The n8n workflow uses `={{ 'sid=' + ($env.CRM_SID || 'YOUR_SESSION_ID') }}` which reads a static environment variable that never refreshes
   - The `CRM_SID` is set once and never updated when the Frappe session expires
   - The workflow has no mechanism to detect session expiration

2. **No Retry Logic in n8n Workflow**: Unlike the `crm.js` module which has retry logic in `checkCrmHealth()` and `pollCrmLeads()`, the n8n workflow HTTP Request nodes fail immediately on 403
   - The `crm.js` module clears session and retries: `clearCrmSession(); const retryHeaders = await crmHeaders();`
   - The n8n workflow has no equivalent retry mechanism

3. **Bypassing Existing Session Management**: The workflow directly calls the CRM API instead of using the `crm.js` module's `crmHeaders()` function
   - The `crm.js` module has `getCrmSid()` which handles login and caching
   - The workflow hardcodes the cookie header, bypassing this logic

4. **No Error Detection for Auth Failures**: The workflow treats 403 errors as generic failures rather than authentication-specific errors that require re-authentication

---

## Correctness Properties

Property 1: Bug Condition - Automatic Session Refresh on Auth Failure

_For any_ HTTP request to the CRM API where the response status is 401 or 403 (authentication failure), the fixed workflow SHALL automatically clear the cached session, re-authenticate with the CRM using stored credentials (CRM_USER and CRM_PASSWORD), obtain a fresh session cookie, and retry the original request once with the new session.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Valid Session Behavior

_For any_ HTTP request to the CRM API where the response status is NOT 401 or 403 (successful requests or non-auth errors), the fixed workflow SHALL produce exactly the same behavior as the original workflow, preserving all existing lead processing, notification dispatch, and error handling logic.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

---

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `workflows/lead-nurturing-workflow.json`

**Nodes**: `Fetch CRM Leads` (node-fetch-crm) and `Update CRM Status` (node-update-crm)

**Specific Changes**:

1. **Add Session Refresh Function Node**: Create a new Function node that implements session refresh logic
   - Name: "Refresh CRM Session"
   - Logic: Call Frappe login API with `CRM_USER` and `CRM_PASSWORD`, extract `sid` from response cookies
   - Returns: Fresh session ID or error if login fails

2. **Add Error Detection Logic**: Modify or add Function nodes after HTTP Request nodes to detect 401/403 responses
   - Check response status code
   - If 401 or 403, trigger session refresh flow
   - If other error, fail gracefully as before

3. **Implement Retry Logic for Fetch Operation**: Add conditional branching after "Fetch CRM Leads" node
   - On 401/403: Route to "Refresh CRM Session" node, then retry "Fetch CRM Leads" with new session
   - On success: Continue to "Convert CRM Data" as before
   - On other errors: Fail gracefully

4. **Implement Retry Logic for Write-back Operation**: Add conditional branching after "Update CRM Status" node
   - On 401/403: Route to "Refresh CRM Session" node, then retry "Update CRM Status" with new session
   - On success: Complete workflow
   - On other errors: Log and continue (write-back is non-fatal)

5. **Update Cookie Header to Use Dynamic Session**: Modify HTTP Request nodes to use session from previous node output instead of static `$env.CRM_SID`
   - Change from: `{{ 'sid=' + ($env.CRM_SID || 'YOUR_SESSION_ID') }}`
   - Change to: `{{ 'sid=' + ($json.session_id || $env.CRM_SID || 'YOUR_SESSION_ID') }}`
   - This allows dynamic session injection after refresh

**Alternative Approach (if n8n workflow modification is too complex):**

**File**: `crm.js`

**Function**: Create new Express API endpoint `/api/crm/fetch-leads` and `/api/crm/update-status`

**Specific Changes**:
1. Add Express routes that wrap the existing `crm.js` session management
2. Modify n8n workflow to call these endpoints instead of directly calling Frappe CRM
3. The endpoints handle session refresh internally using existing `getCrmSid()` and `clearCrmSession()` logic

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code by simulating expired sessions, then verify the fix works correctly and preserves existing behavior for valid sessions and non-auth errors.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that expired sessions cause 403 errors without retry. If we refute, we will need to re-hypothesize.

**Test Plan**: Manually expire the CRM session (or use an invalid `CRM_SID`), then trigger the n8n workflow. Observe that the "Fetch CRM Leads" node fails with 403 and the workflow stops without retry. Run these tests on the UNFIXED workflow to confirm the bug.

**Test Cases**:
1. **Expired Session Fetch Test**: Set `CRM_SID` to an expired/invalid value, trigger workflow, observe 403 error on "Fetch CRM Leads" node (will fail on unfixed workflow)
2. **Expired Session Write-back Test**: Set `CRM_SID` to expired value, manually trigger "Update CRM Status" node, observe 403 error (will fail on unfixed workflow)
3. **Multiple Request Failure Test**: With expired session, observe both fetch and write-back operations fail with 403 (will fail on unfixed workflow)
4. **Valid Session Test**: With valid `CRM_SID`, observe workflow succeeds (should pass on unfixed workflow - baseline)

**Expected Counterexamples**:
- HTTP 403 Forbidden responses with message "No permission for CRM Lead"
- Workflow execution stops at "Fetch CRM Leads" node without retry
- No automatic re-authentication occurs
- Possible causes: static session cookie, no retry logic, no error detection for auth failures

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (expired session causing 401/403), the fixed workflow produces the expected behavior (automatic re-authentication and retry).

**Pseudocode:**
```
FOR ALL httpRequest WHERE isBugCondition(httpRequest, response) DO
  result := executeWorkflow_fixed(httpRequest)
  ASSERT result.status = 200 OR result.status = success
  ASSERT result.retryCount = 1
  ASSERT result.sessionRefreshed = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (valid sessions, non-auth errors), the fixed workflow produces the same result as the original workflow.

**Pseudocode:**
```
FOR ALL httpRequest WHERE NOT isBugCondition(httpRequest, response) DO
  ASSERT executeWorkflow_original(httpRequest) = executeWorkflow_fixed(httpRequest)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (valid sessions, various error codes)
- It catches edge cases that manual unit tests might miss (e.g., partial session expiration, race conditions)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED workflow first for valid sessions and non-auth errors, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Valid Session Preservation**: Observe that workflow with valid `CRM_SID` fetches leads successfully on unfixed workflow, then write test to verify this continues after fix (no unnecessary re-authentication)
2. **Non-Auth Error Preservation**: Observe that workflow with network errors (500, timeout) fails gracefully on unfixed workflow, then write test to verify this continues after fix (no retry on non-auth errors)
3. **Lead Processing Preservation**: Observe that lead classification, notification dispatch, and CRM write-back work correctly on unfixed workflow with valid session, then write test to verify this continues after fix
4. **Multiple Execution Preservation**: Run workflow multiple times with valid session on unfixed workflow, verify consistent behavior, then test that fixed workflow maintains this consistency

### Unit Tests

- Test session refresh function in isolation (mock Frappe login API, verify `sid` extraction)
- Test error detection logic (401 response triggers refresh, 403 triggers refresh, 500 does not)
- Test retry logic (single retry after refresh, no infinite loops)
- Test cookie header construction (dynamic session injection works correctly)

### Property-Based Tests

- Generate random session states (valid, expired, invalid) and verify workflow handles each correctly
- Generate random CRM API responses (200, 401, 403, 500, network errors) and verify appropriate handling
- Test that all valid sessions continue to work across many workflow executions
- Test that non-auth errors continue to fail gracefully across many scenarios

### Integration Tests

- Test full workflow with expired session: trigger cron, observe 403, verify re-authentication, verify successful fetch and processing
- Test full workflow with valid session: verify no unnecessary re-authentication occurs
- Test write-back operation with expired session: verify re-authentication and successful status update
- Test workflow resilience: expire session mid-execution, verify recovery
- Test fallback behavior: if re-authentication fails (invalid credentials), verify graceful failure with clear error message
