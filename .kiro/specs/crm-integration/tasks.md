# Implementation Plan: CRM Integration

## Overview

Incrementally wire the Frappe CRM API into the existing LeadFlow AI system. Each task builds on the previous one, ending with a fully integrated, tested pipeline. No existing files are broken at any step.

## Tasks

- [x] 1. Install dependencies and set up test framework
  - Run `npm install --save-dev fast-check jest` (Jest may already be present; add if not)
  - Add `"test": "jest --runInBand"` to `package.json` scripts
  - Create `tests/` directory with empty `crm.unit.test.js` and `crm.pbt.test.js` files
  - Add `CRM_BASE_URL` and `CRM_SID` entries to `.env.example`
  - _Requirements: 1.1, 1.2_

- [x] 2. Implement `crm.js` — core pure functions
  - [x] 2.1 Implement `mapCrmLead(crmRecord)` function
    - Maps `lead_name→name`, `email_id→email`, `mobile_no→phone`, `organization→company`, `source→industry`, `notes→notes`
    - Sets `role = "CRM Import"`, `product = organization`
    - Preserves `name` (CRM doc ID) as `crm_id` for write-back
    - Returns `null` if `lead_name` or `email_id` is missing
    - _Requirements: 3.1–3.6, 3.8_

  - [x] 2.2 Write unit tests for `mapCrmLead()`
    - Test known CRM record → exact field values
    - Test missing `email_id` → returns null
    - Test missing `lead_name` → returns null
    - _Requirements: 3.1–3.6, 3.8_

  - [x] 2.3 Implement `scoreCrmLead(crmRecord)` function
    - Apply scoring rules: Interested=+4, Replied=+3, New=+1, source non-empty=+1, organization non-empty=+1
    - Apply thresholds: ≥7→HOT, ≥3→WARM, else COLD
    - Return `{ score, lead_status }`
    - _Requirements: 4.1, 4.2_

  - [x] 2.4 Write property test for scoring (Property 2 + Property 3)
    - **Property 2: Scoring determinism** — for any CRM lead, `scoreCrmLead` returns same result on repeated calls
    - **Property 3: Score-to-classification monotonicity** — for any two leads, higher score → higher or equal priority classification
    - **Validates: Requirements 4.1, 4.2**
    - _Feature: crm-integration, Property 2 & 3_

- [x] 3. Implement `mapCrmLead` property test
  - [x] 3.1 Write property test for field mapping (Property 1)
    - **Property 1: Field mapping completeness** — for any CRM record with all fields present, mapped object has correct field values
    - **Validates: Requirements 3.1–3.6**
    - _Feature: crm-integration, Property 1_

- [x] 4. Implement `checkCrmHealth()` and `pollCrmLeads()` in `crm.js`
  - [x] 4.1 Implement `checkCrmHealth()`
    - Return `{ ok: false, message: "CRM not configured" }` if env vars missing
    - Make GET request to `${CRM_BASE_URL}/api/resource/CRM Lead?limit=1` with `Cookie: sid=<CRM_SID>`
    - Return `{ ok: true, message: "ok", crm: CRM_BASE_URL }` on 200
    - Return `{ ok: false, message: "<status> <statusText>" }` on non-200
    - Catch network errors and return `{ ok: false, message: err.message }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.2, 8.3_

  - [x] 4.2 Implement `pollCrmLeads(pool)`
    - Return `{ processed: 0, skipped: 0, errors: 0 }` early if env vars missing
    - Fetch from `${CRM_BASE_URL}/api/resource/CRM Lead` with fields and `filters=[["status","=","New"]]`
    - For each record: call `mapCrmLead()`, skip if null (increment skipped)
    - Call `scoreCrmLead()` on mapped lead
    - Check DB for existing email — skip if found (increment skipped)
    - INSERT into `leads` table with computed score and status
    - Call `dispatchAlerts(lead, products, pool)` and `scheduleFollowups(pool, lead, products)`
    - Call `writeCrmStatus(crmId, lead_status)` (see 4.3)
    - Catch per-record errors, increment errors counter, continue
    - Return `{ processed, skipped, errors }`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.7, 3.8, 5.1, 5.2, 5.4, 6.3_

  - [x] 4.3 Implement `writeCrmStatus(crmId, status)`
    - PUT `${CRM_BASE_URL}/api/resource/CRM Lead/${crmId}` with `{ status }` and session cookie
    - Log success or error; never throw (errors are non-fatal)
    - _Requirements: 6.1, 6.2_

- [x] 5. Checkpoint — unit test the polling pipeline
  - [x] 5.1 Write unit tests for `pollCrmLeads()` and `checkCrmHealth()`
    - Mock `fetch` to return a known CRM response; verify DB insert and dispatch called
    - Test deduplication: same email twice → second call skipped, no extra DB row
    - Test missing env vars → returns `{ processed:0, skipped:0, errors:0 }` without throwing
    - Test CRM 401 response → logs error, returns errors:1
    - Test empty CRM list → returns `{ processed:0, skipped:0, errors:0 }`
    - _Requirements: 1.3, 1.4, 2.4, 2.5, 3.7_

  - [x] 5.2 Write property test for deduplication (Property 4)
    - **Property 4: Deduplication invariant** — for any lead already in DB, re-processing it does not increase row count or call dispatchAlerts
    - **Validates: Requirements 3.7**
    - _Feature: crm-integration, Property 4_

  - [x] 5.3 Write property test for dispatch pipeline (Property 5)
    - **Property 5: Dispatch pipeline completeness** — for any new CRM lead stored, dispatchAlerts is called with products === organization and scheduleFollowups is called
    - **Validates: Requirements 5.1, 5.2, 5.4**
    - _Feature: crm-integration, Property 5_

  - [x] 5.4 Write property test for CRM write-back (Property 6)
    - **Property 6: CRM write-back correctness** — for any processed lead, a PUT is made to the correct CRM endpoint with the correct status value
    - **Validates: Requirements 6.1, 6.3**
    - _Feature: crm-integration, Property 6_

- [x] 6. Wire `crm.js` into `server.js`
  - [x] 6.1 Add `POST /api/crm/sync` route
    - Import `pollCrmLeads` from `./crm`
    - Call `pollCrmLeads(pool)` and return result as JSON
    - Return HTTP 503 `{ error: "CRM not configured" }` if env vars missing
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.2 Add `GET /api/crm/health` route
    - Import `checkCrmHealth` from `./crm`
    - Return `{ status: "ok", crm: CRM_BASE_URL }` on success
    - Return HTTP 503 `{ status: "error", message }` on failure
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 6.3 Extend the existing 5-minute `setInterval` to also call `pollCrmLeads(pool)`
    - Add `pollCrmLeads(pool).catch(console.error)` inside the existing interval callback
    - Also call once on startup (alongside `processDueFollowups`)
    - _Requirements: 2.3_

  - [x] 6.4 Write unit tests for new routes
    - `POST /api/crm/sync` with no CRM config → HTTP 503
    - `GET /api/crm/health` with mocked successful CRM → `{ status: "ok" }`
    - `GET /api/crm/health` with mocked failed CRM → HTTP 503
    - _Requirements: 7.3, 8.2, 8.3_

  - [x] 6.5 Write property test for sync response shape (Property 7)
    - **Property 7: Sync response shape** — for any batch of CRM records, `processed + skipped + errors === total fetched`, all values non-negative integers
    - **Validates: Requirements 7.2**
    - _Feature: crm-integration, Property 7_

- [x] 7. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP — all tasks are currently required
- The existing `notifications.js`, `database/setup.sql`, and all existing routes are untouched
- `crm_id` does not need a new DB column — it is only used transiently during the polling cycle for write-back
- All HTTP calls to the CRM use native `fetch` (Node 18+, already in use in `server.js`)
