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
