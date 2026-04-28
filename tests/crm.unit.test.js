// Unit tests for CRM integration
// Feature: crm-integration

jest.mock('../notifications', () => ({
  dispatchAlerts:    jest.fn().mockResolvedValue(undefined),
  scheduleFollowups: jest.fn().mockResolvedValue(undefined),
}));

const { mapCrmLead, scoreCrmLead, pollCrmLeads, checkCrmHealth } = require('../crm');
const { dispatchAlerts, scheduleFollowups } = require('../notifications');

// ── mapCrmLead() ──────────────────────────────────────────

describe('mapCrmLead()', () => {
  const fullRecord = {
    name:         'CRM-LEAD-2025-00001',
    lead_name:    'Rahul Sharma',
    email_id:     'rahul@example.com',
    mobile_no:    '9876543210',
    organization: 'TechCorp',
    source:       'Website',
    notes:        'Interested in AI products',
    status:       'New',
  };

  test('maps all fields correctly from a known CRM record', () => {
    const lead = mapCrmLead(fullRecord);
    expect(lead).not.toBeNull();
    expect(lead.crm_id).toBe('CRM-LEAD-2025-00001');
    expect(lead.name).toBe('Rahul Sharma');
    expect(lead.email).toBe('rahul@example.com');
    expect(lead.phone).toBe('9876543210');
    expect(lead.company).toBe('TechCorp');
    expect(lead.industry).toBe('Website');
    expect(lead.notes).toBe('Interested in AI products');
    expect(lead.role).toBe('CRM Import');
    expect(lead.product).toBe('TechCorp');
  });

  test('returns null when email_id is missing', () => {
    const record = { ...fullRecord, email_id: undefined };
    expect(mapCrmLead(record)).toBeNull();
  });

  test('returns null when email_id is empty string', () => {
    const record = { ...fullRecord, email_id: '' };
    expect(mapCrmLead(record)).toBeNull();
  });

  test('returns null when lead_name is missing', () => {
    const record = { ...fullRecord, lead_name: undefined };
    expect(mapCrmLead(record)).toBeNull();
  });

  test('returns null when lead_name is empty string', () => {
    const record = { ...fullRecord, lead_name: '' };
    expect(mapCrmLead(record)).toBeNull();
  });

  test('returns null for null input', () => {
    expect(mapCrmLead(null)).toBeNull();
  });

  test('optional fields default to null when absent', () => {
    const minimal = { name: 'CRM-001', lead_name: 'Jane Doe', email_id: 'jane@example.com' };
    const lead = mapCrmLead(minimal);
    expect(lead.phone).toBeNull();
    expect(lead.company).toBeNull();
    expect(lead.industry).toBeNull();
    expect(lead.notes).toBeNull();
    expect(lead.product).toBeNull();
  });
});

// ── Helpers ───────────────────────────────────────────────

/** Build a minimal mock pg Pool */
function makePool(existingEmails = []) {
  const rows = [];
  return {
    _rows: rows,
    query: jest.fn(async (sql, params) => {
      // SELECT dedup check
      if (sql.includes('SELECT id FROM leads WHERE email')) {
        const email = params[0];
        const found = existingEmails.includes(email);
        return { rows: found ? [{ id: 999 }] : [] };
      }
      // INSERT
      if (sql.includes('INSERT INTO leads')) {
        const inserted = {
          id: rows.length + 1,
          name: params[0], email: params[1], phone: params[2],
          role: params[3], company: params[4], product: params[5],
          industry: params[6], notes: params[7],
          login_count: params[8], lead_status: params[9],
        };
        rows.push(inserted);
        return { rows: [inserted] };
      }
      return { rows: [] };
    }),
  };
}

/** Build a mock fetch that returns a CRM list response */
function mockFetchOk(records) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: records }),
  });
}

/** Build a mock fetch that returns a non-200 response */
function mockFetchStatus(status, statusText) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  });
}

const sampleRecord = {
  name:         'CRM-LEAD-2025-00010',
  lead_name:    'Test User',
  email_id:     'test@example.com',
  mobile_no:    '9999999999',
  status:       'New',
  organization: 'Acme',
  source:       'Website',
  notes:        'Test note',
};

// ── checkCrmHealth() ──────────────────────────────────────

describe('checkCrmHealth()', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test('returns ok:false when CRM_BASE_URL is missing', async () => {
    process.env = { ...origEnv, CRM_SID: 'abc' };
    delete process.env.CRM_BASE_URL;
    const result = await checkCrmHealth();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/i);
  });

  test('returns ok:false when CRM_SID is missing', async () => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000' };
    delete process.env.CRM_SID;
    const result = await checkCrmHealth();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/i);
  });

  test('returns ok:true when CRM responds 200', async () => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'valid-sid' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const result = await checkCrmHealth();
    expect(result.ok).toBe(true);
    expect(result.crm).toBe('http://localhost:8000');
  });

  test('returns ok:false with status message when CRM responds non-200', async () => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'bad-sid' };
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const result = await checkCrmHealth();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
  });

  test('returns ok:false on network error', async () => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'sid' };
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkCrmHealth();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });
});

// ── pollCrmLeads() ────────────────────────────────────────

describe('pollCrmLeads()', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, CRM_BASE_URL: 'http://localhost:8000', CRM_SID: 'test-sid' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = undefined;
  });

  test('returns zeros without throwing when env vars are missing', async () => {
    delete process.env.CRM_BASE_URL;
    delete process.env.CRM_SID;
    const pool = makePool();
    const result = await pollCrmLeads(pool);
    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('processes a new lead: inserts into DB and calls dispatchAlerts', async () => {
    global.fetch = mockFetchOk([sampleRecord]);
    const pool = makePool();
    const result = await pollCrmLeads(pool);
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO leads'),
      expect.arrayContaining(['Test User', 'test@example.com'])
    );
    expect(dispatchAlerts).toHaveBeenCalledTimes(1);
    expect(scheduleFollowups).toHaveBeenCalledTimes(1);
  });

  test('deduplication: same email twice → second skipped, no extra DB row', async () => {
    global.fetch = mockFetchOk([sampleRecord]);
    // Pre-seed the email as already existing
    const pool = makePool(['test@example.com']);
    const result = await pollCrmLeads(pool);
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    // INSERT should never have been called
    const insertCalls = pool.query.mock.calls.filter(c => c[0].includes('INSERT INTO leads'));
    expect(insertCalls).toHaveLength(0);
    expect(dispatchAlerts).not.toHaveBeenCalled();
  });

  test('CRM 401 response → returns errors:1', async () => {
    global.fetch = mockFetchStatus(401, 'Unauthorized');
    const pool = makePool();
    const result = await pollCrmLeads(pool);
    expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });
  });

  test('empty CRM list → returns zeros', async () => {
    global.fetch = mockFetchOk([]);
    const pool = makePool();
    const result = await pollCrmLeads(pool);
    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
  });

  test('record missing email_id is skipped', async () => {
    const badRecord = { ...sampleRecord, email_id: '' };
    global.fetch = mockFetchOk([badRecord]);
    const pool = makePool();
    const result = await pollCrmLeads(pool);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
  });
});
