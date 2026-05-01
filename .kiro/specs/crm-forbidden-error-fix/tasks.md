# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Expired Session Causes 403 Without Retry
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to the concrete failing case(s) to ensure reproducibility
  - Test that when the n8n workflow executes "Fetch CRM Leads" HTTP Request with an expired/invalid `CRM_SID`, the system returns HTTP 403 Forbidden without automatic retry or re-authentication
  - Test that when the n8n workflow executes "Update CRM Status" HTTP Request with an expired session, the system fails without retry
  - The test assertions should match the Expected Behavior: automatic re-authentication and retry should occur (from Bug Condition in design)
  - Run test on UNFIXED workflow (manually set `CRM_SID` to expired/invalid value)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: HTTP 403 responses, no retry attempts, workflow stops at failed node
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Valid Session and Non-Auth Error Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED workflow for non-buggy inputs (valid sessions, non-auth errors)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Test 1: For all valid (non-expired) `CRM_SID` values, the workflow successfully fetches CRM leads without triggering re-authentication
  - Test 2: For all non-authentication errors (HTTP 500, network timeout), the workflow fails gracefully without triggering re-authentication logic
  - Test 3: For all successful CRM fetch operations with valid sessions, lead classification, notification dispatch, and CRM write-back continue to work as before
  - Test 4: For all CRM API responses that are NOT 401/403, the workflow behavior matches the original unfixed workflow exactly
  - Run tests on UNFIXED workflow
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed workflow
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for CRM Forbidden Error - Automatic Session Refresh

  - [x] 3.1 Implement session refresh logic in n8n workflow
    - Add new Function node "Refresh CRM Session" that calls Frappe login API with `CRM_USER` and `CRM_PASSWORD`
    - Extract `sid` from Set-Cookie response header
    - Return fresh session ID or error if login fails
    - Add error detection Function nodes after "Fetch CRM Leads" and "Update CRM Status" to check for 401/403 responses
    - Implement conditional branching: on 401/403, route to "Refresh CRM Session" node, then retry original request
    - Update HTTP Request nodes to use dynamic session from previous node output: `{{ 'sid=' + ($json.session_id || $env.CRM_SID) }}`
    - Ensure single retry only (no infinite loops)
    - _Bug_Condition: isBugCondition(input) where input.response.status = 403 OR 401 AND input.httpRequest.url CONTAINS "api/resource/CRM Lead"_
    - _Expected_Behavior: For any HTTP request to CRM API with 401/403 response, workflow SHALL automatically re-authenticate and retry once with fresh session (from design)_
    - _Preservation: Valid session requests, non-auth errors, lead processing, and notification dispatch must remain unchanged (from design)_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Automatic Session Refresh on Auth Failure
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1 with expired `CRM_SID`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed - workflow now re-authenticates and retries)
    - Verify that 403 responses trigger re-authentication
    - Verify that retry succeeds with fresh session
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Session and Non-Auth Error Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm valid sessions continue to work without unnecessary re-authentication
    - Confirm non-auth errors (500, timeout) still fail gracefully without retry
    - Confirm lead processing, notification dispatch, and CRM write-back continue working
    - Confirm all non-401/403 responses produce same behavior as unfixed workflow

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify workflow handles expired sessions correctly (re-authenticates and retries)
  - Verify workflow preserves existing behavior for valid sessions and non-auth errors
  - Test full workflow end-to-end: trigger cron with expired session, observe successful recovery and lead processing
  - Test fallback: if re-authentication fails (invalid credentials), verify graceful failure with clear error message
