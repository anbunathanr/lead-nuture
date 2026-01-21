const request = require('supertest');
const Lead = require('../../models/Lead');

// Mock the database and models
jest.mock('../../config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(true),
  query: jest.fn()
}));

jest.mock('../../models/Lead');
jest.mock('../../models/EngagementEvent');

// Import app after mocking
const app = require('../../index');

describe('Leads API Endpoints', () => {
  const mockLeadId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
  const mockLead = {
    id: mockLeadId,
    crm_user_id: 'test-user-123',
    organization_id: 'test-org-456',
    product_id: 'test-product-789',
    stage: 'User',
    engagement_score: 0,
    contact_info: {
      email: 'test@example.com',
      preferred_channel: 'email'
    },
    demographics: {
      job_title: 'Developer',
      company_size: '50-100'
    },
    product_context: {
      login_frequency: 5,
      feature_usage: ['dashboard', 'reports']
    },
    toJSON: () => mockLead
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/leads', () => {
    test('should create a new lead with valid data', async () => {
      const leadData = {
        crm_user_id: 'new-user-123',
        organization_id: 'new-org-456',
        product_id: 'new-product-789',
        contact_info: {
          email: 'newuser@example.com',
          preferred_channel: 'email'
        }
      };

      // Mock Lead constructor and save method
      const mockSave = jest.fn().mockResolvedValue(mockLead);
      Lead.mockImplementation(() => ({
        ...mockLead,
        save: mockSave,
        toJSON: () => mockLead
      }));

      const response = await request(app)
        .post('/api/leads')
        .send(leadData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.crm_user_id).toBe(mockLead.crm_user_id);
      expect(response.body.data.stage).toBe('User');
      expect(mockSave).toHaveBeenCalled();
    });

    test('should return 400 for invalid lead data', async () => {
      const invalidData = {
        crm_user_id: '', // Empty required field
        organization_id: 'org-123',
        product_id: 'product-456'
      };

      // Mock Lead constructor to throw validation error
      Lead.mockImplementation(() => ({
        save: jest.fn().mockRejectedValue(new Error('Validation failed: crm_user_id is required and must be a non-empty string'))
      }));

      const response = await request(app)
        .post('/api/leads')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });

    test('should return 400 for missing contact info', async () => {
      const invalidData = {
        crm_user_id: 'user-123',
        organization_id: 'org-123',
        product_id: 'product-456'
        // Missing contact_info
      };

      // Mock Lead constructor to throw validation error
      Lead.mockImplementation(() => ({
        save: jest.fn().mockRejectedValue(new Error('Validation failed: Contact info must include a valid email address'))
      }));

      const response = await request(app)
        .post('/api/leads')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('GET /api/leads/:id', () => {
    test('should retrieve existing lead', async () => {
      Lead.findById = jest.fn().mockResolvedValue(mockLead);

      const response = await request(app)
        .get(`/api/leads/${mockLeadId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(mockLeadId);
      expect(response.body.data.crm_user_id).toBe('test-user-123');
      expect(Lead.findById).toHaveBeenCalledWith(mockLeadId);
    });

    test('should return 404 for non-existent lead', async () => {
      const fakeId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
      Lead.findById = jest.fn().mockResolvedValue(null);
      
      const response = await request(app)
        .get(`/api/leads/${fakeId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Not Found');
    });

    test('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .get('/api/leads/invalid-id')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid ID');
    });
  });

  describe('PUT /api/leads/:id', () => {
    test('should update existing lead', async () => {
      const updateData = {
        stage: 'Engaged_Lead',
        engagement_score: 50,
        demographics: {
          job_title: 'Senior Developer',
          company_size: '100-500'
        }
      };

      const updatedLead = { 
        ...mockLead, 
        stage: 'Engaged_Lead',
        engagement_score: 50,
        demographics: {
          job_title: 'Senior Developer',
          company_size: '100-500'
        },
        toJSON: () => ({ 
          ...mockLead, 
          stage: 'Engaged_Lead',
          engagement_score: 50,
          demographics: {
            job_title: 'Senior Developer',
            company_size: '100-500'
          }
        })
      };
      
      Lead.findById = jest.fn().mockResolvedValue({
        ...mockLead,
        save: jest.fn().mockResolvedValue(updatedLead),
        stage: 'User',
        engagement_score: 0
      });

      const response = await request(app)
        .put(`/api/leads/${mockLeadId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stage).toBe('Engaged_Lead');
      expect(response.body.data.engagement_score).toBe(50);
    });

    test('should return 404 for non-existent lead', async () => {
      const fakeId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
      const updateData = { stage: 'Engaged_Lead' };

      Lead.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .put(`/api/leads/${fakeId}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Not Found');
    });

    test('should return 400 for invalid stage', async () => {
      const updateData = { stage: 'InvalidStage' };

      Lead.findById = jest.fn().mockResolvedValue({
        ...mockLead,
        save: jest.fn().mockRejectedValue(new Error('Validation failed: Stage must be one of: User, Engaged_Lead, Qualified_Lead, Customer'))
      });

      const response = await request(app)
        .put(`/api/leads/${mockLeadId}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('DELETE /api/leads/:id', () => {
    test('should delete existing lead', async () => {
      Lead.delete = jest.fn().mockResolvedValue(true);

      const response = await request(app)
        .delete(`/api/leads/${mockLeadId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Lead deleted successfully');
      expect(Lead.delete).toHaveBeenCalledWith(mockLeadId);
    });

    test('should return 404 for non-existent lead', async () => {
      const fakeId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';

      Lead.delete = jest.fn().mockRejectedValue(new Error('Lead not found'));

      const response = await request(app)
        .delete(`/api/leads/${fakeId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Not Found');
    });
  });

  describe('GET /api/leads', () => {
    test('should list leads with pagination', async () => {
      const { query } = require('../../config/database');
      const mockLeadData = { ...mockLead, toJSON: () => mockLead };
      query.mockResolvedValue({
        rows: [mockLeadData, { ...mockLead, id: 'another-id', toJSON: () => ({ ...mockLead, id: 'another-id' }) }]
      });

      const response = await request(app)
        .get('/api/leads?limit=10&offset=0')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });

    test('should filter leads by stage', async () => {
      Lead.findByStage = jest.fn().mockResolvedValue([{ ...mockLead, stage: 'Engaged_Lead' }]);

      const response = await request(app)
        .get('/api/leads?stage=Engaged_Lead')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Lead.findByStage).toHaveBeenCalledWith('Engaged_Lead', undefined);
    });
  });
});