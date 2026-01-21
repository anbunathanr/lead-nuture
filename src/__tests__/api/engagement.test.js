const request = require('supertest');
const Lead = require('../../models/Lead');
const EngagementEvent = require('../../models/EngagementEvent');

// Mock the database and models
jest.mock('../../config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(true),
  query: jest.fn()
}));

jest.mock('../../models/Lead');
jest.mock('../../models/EngagementEvent');

// Import app after mocking
const app = require('../../index');

describe('Engagement API Endpoints', () => {
  const mockLeadId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
  const mockLead = {
    id: mockLeadId,
    crm_user_id: 'test-user-123',
    organization_id: 'test-org-456',
    product_id: 'test-product-789',
    stage: 'User',
    engagement_score: 10,
    contact_info: {
      email: 'test@example.com',
      preferred_channel: 'email'
    },
    toJSON: () => mockLead
  };

  const mockEvent = {
    id: 'event-123',
    lead_id: mockLeadId,
    event_type: 'email_open',
    channel: 'email',
    score_impact: 5,
    toJSON: () => mockEvent
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/leads/:id/events', () => {
    test('should record engagement event and update lead score', async () => {
      const eventData = {
        event_type: 'email_open',
        channel: 'email',
        metadata: {
          message_id: 'msg-123',
          campaign_id: 'camp-456'
        }
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      
      const mockEngagementEvent = {
        ...mockEvent,
        updateScoreImpact: jest.fn(),
        processAndUpdateLeadScore: jest.fn().mockResolvedValue(),
        toJSON: () => mockEvent
      };
      
      EngagementEvent.mockImplementation(() => mockEngagementEvent);

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/events`)
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.event_type).toBe('email_open');
      expect(response.body.data.channel).toBe('email');
      expect(response.body.data.lead_id).toBe(mockLeadId);
      expect(mockEngagementEvent.processAndUpdateLeadScore).toHaveBeenCalled();
    });

    test('should return 404 for non-existent lead', async () => {
      const fakeId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
      const eventData = {
        event_type: 'email_open',
        channel: 'email'
      };

      Lead.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/leads/${fakeId}/events`)
        .send(eventData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Not Found');
    });

    test('should return 400 for invalid event data', async () => {
      const invalidEventData = {
        event_type: 'invalid_type',
        channel: 'email'
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      
      const mockEngagementEvent = {
        updateScoreImpact: jest.fn(),
        processAndUpdateLeadScore: jest.fn().mockRejectedValue(new Error('Validation failed: Event type must be one of: email_open, email_click, whatsapp_reply, chatbot_interaction, login'))
      };
      
      EngagementEvent.mockImplementation(() => mockEngagementEvent);

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/events`)
        .send(invalidEventData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });

    test('should handle custom score impact', async () => {
      const eventData = {
        event_type: 'chatbot_interaction',
        channel: 'chatbot',
        score_impact: 25,
        metadata: {
          interaction_type: 'product_inquiry'
        }
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      
      // Mock the EngagementEvent constructor to return an object with the custom score_impact
      EngagementEvent.mockImplementation((data) => ({
        ...mockEvent,
        ...data, // This will include the score_impact: 25 from eventData
        updateScoreImpact: jest.fn(),
        processAndUpdateLeadScore: jest.fn().mockResolvedValue(),
        toJSON: () => ({ ...mockEvent, ...data })
      }));

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/events`)
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.score_impact).toBe(25);
    });
  });

  describe('GET /api/leads/:id/score', () => {
    test('should retrieve current engagement score', async () => {
      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      EngagementEvent.getEngagementSummary = jest.fn().mockResolvedValue([
        { event_type: 'email_open', channel: 'email', event_count: 3, total_score_impact: 15 }
      ]);

      const response = await request(app)
        .get(`/api/leads/${mockLeadId}/score`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lead_id).toBe(mockLeadId);
      expect(response.body.data.current_score).toBe(10);
      expect(response.body.data.stage).toBe('User');
      expect(Array.isArray(response.body.data.engagement_breakdown)).toBe(true);
    });

    test('should return 404 for non-existent lead', async () => {
      const fakeId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
      Lead.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/leads/${fakeId}/score`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Not Found');
    });

    test('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .get('/api/leads/invalid-id/score')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid ID');
    });
  });

  describe('POST /api/leads/:id/stage', () => {
    test('should update lead stage', async () => {
      const stageData = {
        stage: 'Engaged_Lead',
        reason: 'High engagement activity'
      };

      const mockLeadWithProgress = {
        ...mockLead,
        stage: 'User',
        progressStage: jest.fn().mockResolvedValue(),
        updated_at: new Date()
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLeadWithProgress);
      Lead.validateStage = jest.fn().mockReturnValue(true);

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/stage`)
        .send(stageData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.previous_stage).toBe('User');
      expect(response.body.data.current_stage).toBe('Engaged_Lead');
      expect(response.body.data.reason).toBe('High engagement activity');
      expect(mockLeadWithProgress.progressStage).toHaveBeenCalledWith('Engaged_Lead', 'High engagement activity');
    });

    test('should return 400 for invalid stage', async () => {
      const stageData = {
        stage: 'InvalidStage'
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      Lead.validateStage = jest.fn().mockReturnValue(false);

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/stage`)
        .send(stageData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });

    test('should return 400 for missing stage', async () => {
      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/stage`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toBe('Stage is required');
    });

    test('should use default reason when not provided', async () => {
      const stageData = {
        stage: 'Qualified_Lead'
      };

      const mockLeadWithProgress = {
        ...mockLead,
        stage: 'User',
        progressStage: jest.fn().mockResolvedValue(),
        updated_at: new Date()
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLeadWithProgress);
      Lead.validateStage = jest.fn().mockReturnValue(true);

      const response = await request(app)
        .post(`/api/leads/${mockLeadId}/stage`)
        .send(stageData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reason).toBe('Manual stage update');
    });
  });

  describe('GET /api/leads/:id/events', () => {
    test('should retrieve engagement events for lead', async () => {
      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      EngagementEvent.findByLeadId = jest.fn().mockResolvedValue([mockEvent, { ...mockEvent, id: 'event-456' }]);

      const response = await request(app)
        .get(`/api/leads/${mockLeadId}/events`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.pagination).toBeDefined();
    });

    test('should filter events by type', async () => {
      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      const { query } = require('../../config/database');
      query.mockResolvedValue({
        rows: [mockEvent]
      });

      const response = await request(app)
        .get(`/api/leads/${mockLeadId}/events?event_type=email_open`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].event_type).toBe('email_open');
    });

    test('should filter events by channel', async () => {
      Lead.findById = jest.fn().mockResolvedValue(mockLead);
      const { query } = require('../../config/database');
      query.mockResolvedValue({
        rows: [mockEvent, { ...mockEvent, id: 'event-456' }]
      });

      const response = await request(app)
        .get(`/api/leads/${mockLeadId}/events?channel=email`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.data.every(event => event.channel === 'email')).toBe(true);
    });
  });

  describe('PUT /api/leads/:id/score', () => {
    test('should manually update engagement score', async () => {
      const scoreData = {
        score: 100,
        reason: 'Manual adjustment for testing'
      };

      const mockLeadWithUpdate = {
        ...mockLead,
        engagement_score: 10,
        updateEngagementScore: jest.fn().mockResolvedValue(),
        updated_at: new Date()
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLeadWithUpdate);
      Lead.validateEngagementScore = jest.fn().mockReturnValue(true);

      const response = await request(app)
        .put(`/api/leads/${mockLeadId}/score`)
        .send(scoreData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.previous_score).toBe(10);
      expect(response.body.data.current_score).toBe(100);
      expect(response.body.data.reason).toBe('Manual adjustment for testing');
      expect(mockLeadWithUpdate.updateEngagementScore).toHaveBeenCalledWith(100, 'Manual adjustment for testing');
    });

    test('should return 400 for invalid score', async () => {
      const scoreData = {
        score: -10 // Negative score is invalid
      };

      Lead.validateEngagementScore = jest.fn().mockReturnValue(false);

      const response = await request(app)
        .put(`/api/leads/${mockLeadId}/score`)
        .send(scoreData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });

    test('should return 400 for missing score', async () => {
      const response = await request(app)
        .put(`/api/leads/${mockLeadId}/score`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toBe('Score is required');
    });

    test('should use default reason when not provided', async () => {
      const scoreData = {
        score: 75
      };

      const mockLeadWithUpdate = {
        ...mockLead,
        engagement_score: 10,
        updateEngagementScore: jest.fn().mockResolvedValue(),
        updated_at: new Date()
      };

      Lead.findById = jest.fn().mockResolvedValue(mockLeadWithUpdate);
      Lead.validateEngagementScore = jest.fn().mockReturnValue(true);

      const response = await request(app)
        .put(`/api/leads/${mockLeadId}/score`)
        .send(scoreData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reason).toBe('Manual score update');
    });
  });
});