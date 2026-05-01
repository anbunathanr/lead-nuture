// Property-based tests for CRM integration
// Feature: crm-integration

const fc = require('fast-check');
const { mapCrmLead, scoreCrmLead } = require('../crm');

// Arbitrary generator for a CRM lead record
const crmStatusArb = fc.oneof(
  fc.constant('New'),
  fc.constant('Replied'),
  fc.constant('Interested'),
  fc.constant('Open'),
  fc.constant(''),
  fc.string({ maxLength: 20 })
);

const crmLeadArb = fc.record({
  name:         fc.string({ minLength: 1, maxLength: 30 }),
  lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
  email_id:     fc.emailAddress(),
  mobile_no:    fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
  status:       crmStatusArb,
  organization: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  source:       fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  notes:        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
});

// ── Property 1: Field mapping completeness ───────────────
// Feature: crm-integration, Property 1: Field mapping completeness
describe('Property 1: Field mapping completeness', () => {
  // Generator for CRM records where all fields are present (non-empty strings)
  const fullCrmLeadArb = fc.record({
    name:         fc.string({ minLength: 1, maxLength: 30 }),
    lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
    email_id:     fc.emailAddress(),
    mobile_no:    fc.string({ minLength: 1, maxLength: 15 }),
    organization: fc.string({ minLength: 1, maxLength: 50 }),
    source:       fc.string({ minLength: 1, maxLength: 30 }),
    notes:        fc.string({ minLength: 1, maxLength: 100 }),
    status:       fc.constant('New'),
  });

  test('for any CRM record with all fields present, mapped object has correct field values', () => {
    // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
    fc.assert(
      fc.property(fullCrmLeadArb, (crmRecord) => {
        const lead = mapCrmLead(crmRecord);
        expect(lead).not.toBeNull();
        expect(lead.name).toBe(crmRecord.lead_name);       // Req 3.1
        expect(lead.email).toBe(crmRecord.email_id);       // Req 3.2
        expect(lead.phone).toBe(crmRecord.mobile_no);      // Req 3.3
        expect(lead.company).toBe(crmRecord.organization); // Req 3.4
        expect(lead.industry).toBe(crmRecord.source);      // Req 3.5
        expect(lead.notes).toBe(crmRecord.notes);          // Req 3.6
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 2: Scoring determinism ──────────────────────
// Feature: crm-integration, Property 2: Scoring determinism
describe('Property 2: Scoring determinism', () => {
  test('scoreCrmLead returns the same result on repeated calls for any CRM lead', () => {
    // Validates: Requirements 4.1, 4.2
    fc.assert(
      fc.property(crmLeadArb, (lead) => {
        const result1 = scoreCrmLead(lead);
        const result2 = scoreCrmLead(lead);
        expect(result1.score).toBe(result2.score);
        expect(result1.lead_status).toBe(result2.lead_status);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 3: Score-to-classification monotonicity ─────
// Feature: crm-integration, Property 3: Score-to-classification monotonicity
describe('Property 3: Score-to-classification monotonicity', () => {
  // Priority order: HOT > WARM > COLD
  const priority = { HOT: 2, WARM: 1, COLD: 0 };

  test('for any two leads, higher score implies higher or equal classification priority', () => {
    // Validates: Requirements 4.2
    fc.assert(
      fc.property(crmLeadArb, crmLeadArb, (leadA, leadB) => {
        const a = scoreCrmLead(leadA);
        const b = scoreCrmLead(leadB);

        if (a.score >= b.score) {
          expect(priority[a.lead_status]).toBeGreaterThanOrEqual(priority[b.lead_status]);
        } else {
          expect(priority[a.lead_status]).toBeLessThanOrEqual(priority[b.lead_status]);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── Shared mock setup for polling properties ──────────────

jest.mock('../notifications', () => ({
  dispatchAlerts:    jest.fn().mockResolvedValue(undefined),
  scheduleFollowups: jest.fn().mockResolvedValue(undefined),
}));

const { pollCrmLeads } = require('../crm');
const { dispatchAlerts, scheduleFollowups } = require('../notifications');

/** Build a mock pg Pool that tracks inserts and supports pre-seeded emails */
function makePool(existingEmails = []) {
  const rows = [];
  return {
    _rows: rows,
    query: jest.fn(async (sql, params) => {
      if (sql.includes('SELECT id FROM leads WHERE email')) {
        return { rows: existingEmails.includes(params[0]) ? [{ id: 999 }] : [] };
      }
      if (sql.includes('INSERT INTO leads')) {
        const row = { id: rows.length + 1, name: params[0], email: params[1],
          role: params[3], company: params[4], product: params[5],
          login_count: params[8], lead_status: params[9] };
        rows.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    }),
  };
}

/** Arbitrary generator for a valid CRM lead (required fields always present) */
const validCrmLeadArb = fc.record({
  name:         fc.string({ minLength: 1, maxLength: 30 }),
  lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
  email_id:     fc.emailAddress(),
  mobile_no:    fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
  status:       fc.constant('New'),
  organization: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  source:       fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  notes:        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
});

// ── Property 4: Deduplication invariant ──────────────────
// Feature: crm-integration, Property 4: Deduplication invariant
describe('Property 4: Deduplication invariant', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'test-sid' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test('for any lead already in DB, re-processing does not increase row count or call dispatchAlerts', async () => {
    // Validates: Requirements 3.7
    await fc.assert(
      fc.asyncProperty(validCrmLeadArb, async (record) => {
        jest.clearAllMocks();
        // Pre-seed the email as already existing
        const pool = makePool([record.email_id]);
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ data: [record] }),
        });

        const before = pool._rows.length;
        const result = await pollCrmLeads(pool);
        const after  = pool._rows.length;

        expect(after).toBe(before);           // no new rows
        expect(result.skipped).toBeGreaterThanOrEqual(1);
        expect(dispatchAlerts).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 5: Dispatch pipeline completeness ───────────
// Feature: crm-integration, Property 5: Dispatch pipeline completeness
describe('Property 5: Dispatch pipeline completeness', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'test-sid' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test('for any new CRM lead stored, dispatchAlerts and scheduleFollowups are called with correct args', async () => {
    // Validates: Requirements 5.1, 5.2, 5.4
    await fc.assert(
      fc.asyncProperty(validCrmLeadArb, async (record) => {
        jest.clearAllMocks();
        const pool = makePool(); // no pre-existing emails
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ data: [record] }),
        });

        const result = await pollCrmLeads(pool);

        expect(result.processed).toBe(1);
        expect(dispatchAlerts).toHaveBeenCalledTimes(1);
        expect(scheduleFollowups).toHaveBeenCalledTimes(1);

        // products argument === organization field
        const dispatchCall = dispatchAlerts.mock.calls[0];
        const expectedProducts = record.organization || '';
        expect(dispatchCall[1]).toBe(expectedProducts);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 6: CRM write-back correctness ───────────────
// Feature: crm-integration, Property 6: CRM write-back correctness
describe('Property 6: CRM write-back correctness', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'test-sid' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test('for any processed lead, a PUT is made to the correct CRM endpoint with the correct status', async () => {
    // Validates: Requirements 6.1, 6.3
    await fc.assert(
      fc.asyncProperty(validCrmLeadArb, async (record) => {
        jest.clearAllMocks();
        const pool = makePool();
        const fetchCalls = [];
        global.fetch = jest.fn().mockImplementation((url, opts) => {
          fetchCalls.push({ url, method: opts?.method || 'GET', body: opts?.body });
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ data: [record] }),
          });
        });

        const result = await pollCrmLeads(pool);
        expect(result.processed).toBe(1);

        // Find the PUT call for write-back
        const putCall = fetchCalls.find(c => c.method === 'PUT');
        expect(putCall).toBeDefined();
        expect(putCall.url).toContain(`/api/resource/CRM Lead/${encodeURIComponent(record.name)}`);

        const body = JSON.parse(putCall.body);
        expect(['HOT', 'WARM', 'COLD']).toContain(body.status);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 8: Bug Condition - Expired Session Causes 403 Without Retry ──
// Bugfix spec: crm-forbidden-error-fix
// **Validates: Requirements 1.1, 1.2, 1.3**
//
// CRITICAL: This test MUST FAIL on unfixed code.
// Failure confirms the bug exists: the n8n workflow uses a static CRM_SID
// with no retry/re-auth logic, so expired sessions cause permanent 403 failures.
//
// The test asserts the EXPECTED (correct) behavior:
//   - When a 403 is received, the system should re-authenticate and retry
//   - retryAttempted should be true
//   - The final result should succeed (not return errors:1)
//
// On unfixed code this FAILS because:
//   - The n8n workflow has no retry logic (static CRM_SID, no re-auth)
//   - pollCrmLeads with no CRM_USER/CRM_PASSWORD falls back to static CRM_SID
//   - A 403 on the retry (same stale sid) means errors:1 is returned
//
// Counterexamples documented:
//   - HTTP 403 Forbidden with "No permission for CRM Lead"
//   - No retry attempt occurs in the n8n workflow nodes
//   - Workflow stops at "Fetch CRM Leads" node without re-authentication
//   - "Update CRM Status" node never reached when fetch fails with 403

describe('Property 8: Bug Condition - Expired Session Causes 403 Without Retry', () => {
  // Scoped to the concrete failing case: expired/invalid CRM_SID
  // The n8n workflow uses: `={{ 'sid=' + ($env.CRM_SID || 'YOUR_SESSION_ID') }}`
  // This is a static value — no dynamic refresh, no re-auth on 403.

  const origEnv = process.env;

  beforeEach(() => {
    // Simulate the n8n workflow scenario: only CRM_SID is set (no CRM_USER/CRM_PASSWORD)
    // This mirrors the n8n workflow which uses $env.CRM_SID directly
    process.env = {
      ...origEnv,
      CRM_BASE_URL: 'http://34.196.221.16:8000',
      CRM_SID: 'expired_invalid_session_id_12345',
    };
    delete process.env.CRM_USER;
    delete process.env.CRM_PASSWORD;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test(
    'Fetch CRM Leads: expired CRM_SID causes 403 - system should re-authenticate and retry (FAILS on unfixed code)',
    async () => {
      // Validates: Requirements 1.1, 1.2
      //
      // Scoped PBT: deterministic bug — we use the concrete failing case
      // (expired session → 403 → no retry) rather than random inputs,
      // because the bug is 100% reproducible with this specific scenario.
      //
      // EXPECTED behavior (correct): system re-authenticates and retries
      // ACTUAL behavior (buggy): system returns errors:1 without retry

      const fetchCalls = [];
      let retryAttempted = false;

      // Simulate: first call returns 403 (expired session), second call (retry) returns 200
      global.fetch = jest.fn().mockImplementation((url, opts) => {
        const cookie = (opts?.headers?.Cookie) || '';
        fetchCalls.push({ url, cookie, method: opts?.method || 'GET' });

        // First call with expired session → 403
        if (fetchCalls.length === 1) {
          return Promise.resolve({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({
              exc_type: 'PermissionError',
              exception: 'No permission for CRM Lead',
            }),
          });
        }

        // Subsequent calls (retry with fresh session) → 200
        retryAttempted = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: [] }),
        });
      });

      const pool = makePool();
      const result = await pollCrmLeads(pool);

      // EXPECTED (correct) behavior assertions:
      // 1. The system should have retried after the 403
      expect(retryAttempted).toBe(true); // FAILS on unfixed: no retry without CRM_USER/CRM_PASSWORD

      // 2. The result should NOT be errors:1 — it should succeed after retry
      expect(result.errors).toBe(0); // FAILS on unfixed: returns errors:1

      // 3. At least 2 fetch calls should have been made (initial + retry)
      expect(fetchCalls.length).toBeGreaterThanOrEqual(2); // FAILS on unfixed: only 1 call

      // 4. The retry should use a fresh session (different from the expired one)
      if (fetchCalls.length >= 2) {
        const initialCookie = fetchCalls[0].cookie;
        const retryCookie = fetchCalls[1].cookie;
        // After re-auth, the session cookie should be refreshed
        expect(retryCookie).not.toContain('expired_invalid_session_id_12345');
      }
    }
  );

  test(
    'Update CRM Status: expired CRM_SID causes 403 - system should re-authenticate and retry (FAILS on unfixed code)',
    async () => {
      // Validates: Requirements 1.3
      //
      // Scoped PBT: concrete failing case for the write-back operation
      // The n8n "Update CRM Status" node uses the same static CRM_SID
      // and has no retry logic for 403 responses.

      const fetchCalls = [];
      let writeBackRetried = false;

      global.fetch = jest.fn().mockImplementation((url, opts) => {
        const method = opts?.method || 'GET';
        const cookie = (opts?.headers?.Cookie) || '';
        fetchCalls.push({ url, method, cookie });

        if (method === 'GET') {
          // Fetch leads succeeds (to get to the write-back step)
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              data: [{
                name: 'CRM-LEAD-2025-TEST-001',
                lead_name: 'Test Lead',
                email_id: 'testlead@example.com',
                mobile_no: '9999999999',
                status: 'New',
                organization: 'TestCorp',
                source: 'Website',
                notes: 'Bug condition test',
              }],
            }),
          });
        }

        if (method === 'PUT') {
          const putCalls = fetchCalls.filter(c => c.method === 'PUT');

          // First PUT with expired session → 403
          if (putCalls.length === 1) {
            return Promise.resolve({
              ok: false,
              status: 403,
              statusText: 'Forbidden',
              json: async () => ({
                exc_type: 'PermissionError',
                exception: 'No permission for CRM Lead',
              }),
            });
          }

          // Retry PUT with fresh session → 200
          writeBackRetried = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ data: {} }),
          });
        }

        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const pool = makePool();
      const result = await pollCrmLeads(pool);

      // EXPECTED (correct) behavior assertions:
      // 1. The lead should be processed (fetch succeeded)
      expect(result.processed).toBe(1); // Should pass even on unfixed code (fetch works)

      // 2. The write-back should have been retried after 403
      expect(writeBackRetried).toBe(true); // FAILS on unfixed: writeCrmStatus logs error but doesn't retry

      // 3. At least 2 PUT calls should have been made (initial + retry)
      const putCalls = fetchCalls.filter(c => c.method === 'PUT');
      expect(putCalls.length).toBeGreaterThanOrEqual(2); // FAILS on unfixed: only 1 PUT attempt
    }
  );
});

// ── Property 9: Preservation - Valid Session Behavior ────
// Bugfix spec: crm-forbidden-error-fix
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
//
// EXPECTED OUTCOME: Tests PASS on unfixed code (baseline behavior to preserve).
// These tests encode the behavior that must remain unchanged after the fix.

describe('Property 9: Preservation - Valid Session Fetches Leads Without Re-Auth', () => {
  // Req 3.1: WHEN the workflow executes with a valid, non-expired session
  //          THEN the system SHALL CONTINUE TO fetch CRM leads successfully
  //          without triggering re-authentication.
  //
  // Observation on unfixed code:
  //   - With a valid CRM_SID and a 200 response, pollCrmLeads processes leads normally.
  //   - No re-authentication is triggered (getCrmSid() returns cached sid, no clearCrmSession()).
  //   - fetch is called exactly once for the GET (plus once per lead for PUT write-back).

  const origEnv = process.env;

  beforeEach(() => {
    // Simulate valid session: only CRM_SID set (mirrors n8n workflow env)
    process.env = {
      ...origEnv,
      CRM_BASE_URL: 'http://34.196.221.16:8000',
      CRM_SID: 'valid_session_id_abc123',
    };
    delete process.env.CRM_USER;
    delete process.env.CRM_PASSWORD;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  // Generator for valid session IDs (non-empty, no auth-failure characters)
  const validSidArb = fc.string({ minLength: 8, maxLength: 64 }).filter(s => s.trim().length > 0);

  test(
    'for any valid CRM_SID, a 200 response is processed without triggering re-authentication',
    async () => {
      // Validates: Requirements 3.1
      // Note: getCrmSid() caches the session in module-level state.
      // We verify the key preservation property: no re-auth is triggered
      // (i.e., fetch is called exactly once for GET, and the result has no errors).
      await fc.assert(
        fc.asyncProperty(validCrmLeadArb, async (record) => {
          jest.clearAllMocks();

          let getCallCount = 0;
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            const method = opts?.method || 'GET';
            if (method === 'GET') getCallCount++;
            return Promise.resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({ data: [record] }),
            });
          });

          const pool = makePool();
          const result = await pollCrmLeads(pool);

          // Should succeed without errors
          expect(result.errors).toBe(0);
          expect(result.processed).toBe(1);

          // Exactly 1 GET call — no re-auth triggered
          expect(getCallCount).toBe(1);
        }),
        { numRuns: 50 }
      );
    }
  );

  test(
    'for any valid session, fetch is called exactly once for the GET (no unnecessary re-auth retries)',
    async () => {
      // Validates: Requirements 3.1 — no unnecessary re-authentication
      await fc.assert(
        fc.asyncProperty(validSidArb, fc.array(validCrmLeadArb, { minLength: 0, maxLength: 5 }), async (sid, records) => {
          jest.clearAllMocks();
          process.env.CRM_SID = sid;

          let getCallCount = 0;
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            const method = opts?.method || 'GET';
            if (method === 'GET') getCallCount++;
            return Promise.resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({ data: records }),
            });
          });

          const pool = makePool();
          await pollCrmLeads(pool);

          // Exactly 1 GET call — no retry, no re-auth
          expect(getCallCount).toBe(1);
        }),
        { numRuns: 50 }
      );
    }
  );
});

// ── Property 10: Preservation - Non-Auth Errors Fail Gracefully ──
// Bugfix spec: crm-forbidden-error-fix
// **Validates: Requirements 3.4**
//
// EXPECTED OUTCOME: Tests PASS on unfixed code (baseline behavior to preserve).

describe('Property 10: Preservation - Non-Auth Errors Fail Gracefully Without Re-Auth', () => {
  // Req 3.4: WHEN the CRM API returns errors other than 401/403 (e.g., 500, network timeout)
  //          THEN the system SHALL CONTINUE TO log the error and fail gracefully
  //          without infinite retry loops.
  //
  // Observation on unfixed code:
  //   - HTTP 500 → pollCrmLeads returns { errors: 1 } immediately (no retry, no re-auth)
  //   - Network timeout/error → catch block returns { errors: 1 } immediately
  //   - No clearCrmSession() is called for non-auth errors

  const origEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      CRM_BASE_URL: 'http://34.196.221.16:8000',
      CRM_SID: 'some_session_id',
    };
    delete process.env.CRM_USER;
    delete process.env.CRM_PASSWORD;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  // Generator for non-auth HTTP error status codes (not 401 or 403)
  const nonAuthStatusArb = fc.oneof(
    fc.constant(500),
    fc.constant(502),
    fc.constant(503),
    fc.constant(504),
    fc.constant(404),
    fc.constant(400),
    fc.integer({ min: 405, max: 599 }).filter(s => s !== 401 && s !== 403)
  );

  test(
    'for any non-auth HTTP error (not 401/403), the workflow fails gracefully with errors:1 and no re-auth',
    async () => {
      // Validates: Requirements 3.4
      await fc.assert(
        fc.asyncProperty(nonAuthStatusArb, async (status) => {
          jest.clearAllMocks();

          const fetchCalls = [];
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            fetchCalls.push({ url, method: opts?.method || 'GET' });
            return Promise.resolve({
              ok: false,
              status,
              statusText: 'Error',
              json: async () => ({}),
            });
          });

          const pool = makePool();
          const result = await pollCrmLeads(pool);

          // Should fail gracefully with errors:1
          expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });

          // Should NOT retry (only 1 fetch call — no re-auth loop)
          expect(fetchCalls.length).toBe(1);

          // No leads should be inserted
          const insertCalls = pool.query.mock.calls.filter(c => c[0].includes('INSERT INTO leads'));
          expect(insertCalls).toHaveLength(0);
        }),
        { numRuns: 50 }
      );
    }
  );

  test(
    'for any network error (timeout, ECONNREFUSED), the workflow fails gracefully with errors:1 and no re-auth',
    async () => {
      // Validates: Requirements 3.4
      const networkErrorArb = fc.oneof(
        fc.constant(new Error('ECONNREFUSED')),
        fc.constant(new Error('fetch failed')),
        fc.constant(new Error('network timeout')),
        fc.constant(new Error('ETIMEDOUT')),
      );

      await fc.assert(
        fc.asyncProperty(networkErrorArb, async (networkError) => {
          jest.clearAllMocks();

          const fetchCalls = [];
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            fetchCalls.push({ url, method: opts?.method || 'GET' });
            return Promise.reject(networkError);
          });

          const pool = makePool();
          const result = await pollCrmLeads(pool);

          // Should fail gracefully with errors:1
          expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });

          // Should NOT retry (only 1 fetch call — no infinite loop)
          expect(fetchCalls.length).toBe(1);
        }),
        { numRuns: 20 }
      );
    }
  );
});

// ── Property 11: Preservation - Lead Processing Pipeline Intact ──
// Bugfix spec: crm-forbidden-error-fix
// **Validates: Requirements 3.2, 3.3**
//
// EXPECTED OUTCOME: Tests PASS on unfixed code (baseline behavior to preserve).

describe('Property 11: Preservation - Lead Classification, Notifications, and Write-Back With Valid Session', () => {
  // Req 3.2: pollCrmLeads() called directly continues to handle session management
  //          and retry logic as currently implemented.
  // Req 3.3: WHEN the workflow processes leads with valid sessions THEN the system
  //          SHALL CONTINUE TO classify leads, dispatch notifications, and update CRM status.
  //
  // Observation on unfixed code:
  //   - Valid session → leads are classified (HOT/WARM/COLD via scoreCrmLead)
  //   - dispatchAlerts and scheduleFollowups are called for each new lead
  //   - writeCrmStatus makes a PUT call for each processed lead

  const origEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      CRM_BASE_URL: 'http://localhost:8000',
      CRM_SID: 'valid-test-sid',
    };
    delete process.env.CRM_USER;
    delete process.env.CRM_PASSWORD;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  // Generator for CRM records that produce each classification
  const hotRecordArb = fc.record({
    name:         fc.string({ minLength: 1, maxLength: 30 }),
    lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
    email_id:     fc.emailAddress(),
    mobile_no:    fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
    status:       fc.constant('Interested'), // +4 points
    organization: fc.string({ minLength: 1, maxLength: 50 }), // +1 point
    source:       fc.string({ minLength: 1, maxLength: 30 }), // +1 point
    notes:        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  }); // score = 6 → WARM (not HOT since max is 6 with these fields)

  const warmRecordArb = fc.record({
    name:         fc.string({ minLength: 1, maxLength: 30 }),
    lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
    email_id:     fc.emailAddress(),
    mobile_no:    fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
    status:       fc.constant('Replied'), // +3 points
    organization: fc.string({ minLength: 1, maxLength: 50 }), // +1 point
    source:       fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    notes:        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  }); // score >= 3 → WARM

  const coldRecordArb = fc.record({
    name:         fc.string({ minLength: 1, maxLength: 30 }),
    lead_name:    fc.string({ minLength: 1, maxLength: 50 }),
    email_id:     fc.emailAddress(),
    mobile_no:    fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
    status:       fc.constant('New'), // +1 point
    organization: fc.constant(undefined), // 0 points
    source:       fc.constant(undefined), // 0 points
    notes:        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  }); // score = 1 → COLD

  test(
    'for any new lead with valid session, dispatchAlerts and scheduleFollowups are called exactly once',
    async () => {
      // Validates: Requirements 3.3
      await fc.assert(
        fc.asyncProperty(validCrmLeadArb, async (record) => {
          jest.clearAllMocks();
          const pool = makePool();
          global.fetch = jest.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ data: [record] }),
          });

          const result = await pollCrmLeads(pool);

          expect(result.processed).toBe(1);
          expect(result.errors).toBe(0);
          // Notification pipeline intact
          expect(dispatchAlerts).toHaveBeenCalledTimes(1);
          expect(scheduleFollowups).toHaveBeenCalledTimes(1);
        }),
        { numRuns: 50 }
      );
    }
  );

  test(
    'for any new lead with valid session, a PUT write-back is made to the correct CRM endpoint',
    async () => {
      // Validates: Requirements 3.3 — CRM write-back continues working
      await fc.assert(
        fc.asyncProperty(validCrmLeadArb, async (record) => {
          jest.clearAllMocks();
          const pool = makePool();
          const fetchCalls = [];
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            fetchCalls.push({ url, method: opts?.method || 'GET', body: opts?.body });
            return Promise.resolve({
              ok: true, status: 200, statusText: 'OK',
              json: async () => ({ data: [record] }),
            });
          });

          const result = await pollCrmLeads(pool);
          expect(result.processed).toBe(1);

          // Write-back PUT must be present
          const putCall = fetchCalls.find(c => c.method === 'PUT');
          expect(putCall).toBeDefined();
          expect(putCall.url).toContain(`/api/resource/CRM Lead/${encodeURIComponent(record.name)}`);

          // Status must be a valid classification
          const body = JSON.parse(putCall.body);
          expect(['HOT', 'WARM', 'COLD']).toContain(body.status);
        }),
        { numRuns: 50 }
      );
    }
  );

  test(
    'for any COLD lead (score < 3), lead_status is COLD and write-back uses COLD',
    async () => {
      // Validates: Requirements 3.3 — lead classification unchanged
      await fc.assert(
        fc.asyncProperty(coldRecordArb, async (record) => {
          jest.clearAllMocks();
          const pool = makePool();
          const fetchCalls = [];
          global.fetch = jest.fn().mockImplementation((url, opts) => {
            fetchCalls.push({ url, method: opts?.method || 'GET', body: opts?.body });
            return Promise.resolve({
              ok: true, status: 200, statusText: 'OK',
              json: async () => ({ data: [record] }),
            });
          });

          await pollCrmLeads(pool);

          // Verify classification via DB insert
          const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO leads'));
          expect(insertCall).toBeDefined();
          const insertedStatus = insertCall[1][9]; // lead_status is 10th param
          expect(insertedStatus).toBe('COLD');

          // Verify write-back uses COLD
          const putCall = fetchCalls.find(c => c.method === 'PUT');
          expect(putCall).toBeDefined();
          const body = JSON.parse(putCall.body);
          expect(body.status).toBe('COLD');
        }),
        { numRuns: 30 }
      );
    }
  );
});

// ── Property 12: Preservation - Non-401/403 Responses Match Original Behavior ──
// Bugfix spec: crm-forbidden-error-fix
// **Validates: Requirements 3.1, 3.4**
//
// EXPECTED OUTCOME: Tests PASS on unfixed code (baseline behavior to preserve).

describe('Property 12: Preservation - Non-401/403 Responses Match Original Workflow Behavior', () => {
  // For all CRM API responses that are NOT 401/403, the workflow behavior
  // matches the original unfixed workflow exactly.
  //
  // Observation on unfixed code:
  //   - 200 OK → processes leads (processed >= 0, errors = 0)
  //   - Non-auth errors (500, 502, etc.) → errors: 1, no retry
  //   - Network errors → errors: 1, no retry
  //   - In all cases, no re-authentication is attempted

  const origEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      CRM_BASE_URL: 'http://localhost:8000',
      CRM_SID: 'test-sid-xyz',
    };
    delete process.env.CRM_USER;
    delete process.env.CRM_PASSWORD;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test(
    'for any 200 response, result has errors:0 and processed+skipped equals record count',
    async () => {
      // Validates: Requirements 3.1
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCrmLeadArb, { minLength: 0, maxLength: 5 }),
          async (records) => {
            jest.clearAllMocks();
            const pool = makePool();
            global.fetch = jest.fn().mockResolvedValue({
              ok: true, status: 200, statusText: 'OK',
              json: async () => ({ data: records }),
            });

            const result = await pollCrmLeads(pool);

            expect(result.errors).toBe(0);
            expect(result.processed + result.skipped).toBe(records.length);
          }
        ),
        { numRuns: 50 }
      );
    }
  );

  test(
    'for any non-401/403 error response, result is errors:1 with no re-auth (same as original)',
    async () => {
      // Validates: Requirements 3.4
      // Non-auth error statuses: anything except 401 and 403
      const nonAuthErrorArb = fc.oneof(
        fc.constant(500),
        fc.constant(502),
        fc.constant(503),
        fc.constant(404),
        fc.constant(400),
      );

      await fc.assert(
        fc.asyncProperty(nonAuthErrorArb, async (status) => {
          jest.clearAllMocks();

          let fetchCallCount = 0;
          global.fetch = jest.fn().mockImplementation(() => {
            fetchCallCount++;
            return Promise.resolve({
              ok: false, status, statusText: 'Error',
              json: async () => ({}),
            });
          });

          const pool = makePool();
          const result = await pollCrmLeads(pool);

          // Graceful failure
          expect(result.errors).toBe(1);
          expect(result.processed).toBe(0);
          expect(result.skipped).toBe(0);

          // No re-auth retry: exactly 1 fetch call
          expect(fetchCallCount).toBe(1);
        }),
        { numRuns: 30 }
      );
    }
  );

  test(
    'for any 200 response, no re-authentication is triggered (fetch called exactly once for GET)',
    async () => {
      // Validates: Requirements 3.1 — valid sessions never trigger re-auth
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCrmLeadArb, { minLength: 1, maxLength: 3 }),
          async (records) => {
            jest.clearAllMocks();
            const pool = makePool();
            let getCallCount = 0;

            global.fetch = jest.fn().mockImplementation((url, opts) => {
              const method = opts?.method || 'GET';
              if (method === 'GET') getCallCount++;
              return Promise.resolve({
                ok: true, status: 200, statusText: 'OK',
                json: async () => ({ data: records }),
              });
            });

            await pollCrmLeads(pool);

            // Exactly 1 GET — no re-auth retry
            expect(getCallCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    }
  );
});

// ── Property 7: Sync response shape ──────────────────────
// Feature: crm-integration, Property 7: Sync response shape
describe('Property 7: Sync response shape', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'test-sid' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  // Arbitrary for a mix of valid, duplicate, and invalid records
  const mixedBatchArb = fc.array(
    fc.oneof(
      // valid new lead
      validCrmLeadArb,
      // invalid lead (missing email)
      fc.record({
        name:      fc.string({ minLength: 1, maxLength: 30 }),
        lead_name: fc.string({ minLength: 1, maxLength: 50 }),
        email_id:  fc.constant(''),
        status:    fc.constant('New'),
      }),
    ),
    { minLength: 0, maxLength: 10 }
  );

  test('for any batch of CRM records, processed+skipped+errors === total fetched, all non-negative', async () => {
    // Validates: Requirements 7.2
    await fc.assert(
      fc.asyncProperty(mixedBatchArb, async (records) => {
        jest.clearAllMocks();
        const pool = makePool();
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ data: records }),
        });

        const result = await pollCrmLeads(pool);

        // All values must be non-negative integers
        expect(result.processed).toBeGreaterThanOrEqual(0);
        expect(result.skipped).toBeGreaterThanOrEqual(0);
        expect(result.errors).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.processed)).toBe(true);
        expect(Number.isInteger(result.skipped)).toBe(true);
        expect(Number.isInteger(result.errors)).toBe(true);

        // Sum must equal total records fetched
        expect(result.processed + result.skipped + result.errors).toBe(records.length);
      }),
      { numRuns: 100 }
    );
  });
});
