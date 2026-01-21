const fc = require('fast-check');
const Lead = require('../../models/Lead');

/**
 * Property-Based Tests for Lead Data Model
 * Feature: lead-nurturing-automation, Property 7: Data Independence and Consistency
 * **Validates: Requirements 7.1, 7.2**
 */

describe('Lead Data Model Property Tests', () => {
  // Generators for test data
  const validStageGen = fc.constantFrom('User', 'Engaged_Lead', 'Qualified_Lead', 'Customer');
  const validChannelGen = fc.constantFrom('email', 'whatsapp', 'chatbot');
  const validEmailGen = fc.emailAddress();
  const validEngagementScoreGen = fc.integer({ min: 0, max: 10000 });
  
  const validContactInfoGen = fc.record({
    email: validEmailGen,
    phone: fc.option(fc.string({ minLength: 10, maxLength: 15 })),
    preferred_channel: fc.option(validChannelGen)
  });

  const validLeadDataGen = fc.record({
    crm_user_id: fc.string({ minLength: 1, maxLength: 255 }),
    organization_id: fc.string({ minLength: 1, maxLength: 255 }),
    product_id: fc.string({ minLength: 1, maxLength: 255 }),
    stage: validStageGen,
    engagement_score: validEngagementScoreGen,
    contact_info: validContactInfoGen,
    demographics: fc.object(),
    product_context: fc.object()
  });

  const engagementEventGen = fc.record({
    event_type: fc.constantFrom('login', 'email_open', 'email_click', 'whatsapp_reply', 'chatbot_interaction'),
    score_impact: fc.integer({ min: 0, max: 50 })
  });

  test('Property 7: Data Independence and Consistency - Lead validation consistency', () => {
    fc.assert(fc.property(validLeadDataGen, (leadData) => {
      // Create a lead with valid data
      const lead = new Lead(leadData);
      
      // Validation should always pass for valid data
      const validation = lead.validate();
      
      // Property: Valid lead data should always pass validation
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      
      // Property: Lead should maintain data consistency after creation
      expect(lead.crm_user_id).toBe(leadData.crm_user_id);
      expect(lead.organization_id).toBe(leadData.organization_id);
      expect(lead.product_id).toBe(leadData.product_id);
      expect(lead.stage).toBe(leadData.stage);
      expect(lead.engagement_score).toBe(leadData.engagement_score);
      expect(lead.contact_info).toEqual(leadData.contact_info);
    }), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Stage validation consistency', () => {
    fc.assert(fc.property(fc.string(), (invalidStage) => {
      // Skip valid stages to test only invalid ones
      fc.pre(!['User', 'Engaged_Lead', 'Qualified_Lead', 'Customer'].includes(invalidStage));
      
      // Property: Invalid stages should always fail validation
      const isValid = Lead.validateStage(invalidStage);
      expect(isValid).toBe(false);
    }), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Engagement score calculation consistency', () => {
    fc.assert(fc.property(
      fc.array(engagementEventGen, { minLength: 0, maxLength: 20 }),
      fc.record({
        login_points: fc.integer({ min: 1, max: 50 }),
        email_open_points: fc.integer({ min: 1, max: 20 }),
        email_click_points: fc.integer({ min: 1, max: 30 }),
        whatsapp_reply_points: fc.integer({ min: 1, max: 40 }),
        chatbot_interaction_points: fc.integer({ min: 1, max: 25 })
      }),
      (events, scoringRules) => {
        // Calculate score with the same events and rules multiple times
        const score1 = Lead.calculateEngagementScore(events, scoringRules);
        const score2 = Lead.calculateEngagementScore(events, scoringRules);
        
        // Property: Score calculation should be deterministic
        expect(score1).toBe(score2);
        
        // Property: Score should never be negative
        expect(score1).toBeGreaterThanOrEqual(0);
        
        // Property: Score should be an integer
        expect(Number.isInteger(score1)).toBe(true);
        
        // Property: Empty events should result in zero score
        if (events.length === 0) {
          expect(score1).toBe(0);
        }
      }
    ), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Contact info validation consistency', () => {
    fc.assert(fc.property(validContactInfoGen, (contactInfo) => {
      // Property: Valid contact info should always pass validation
      const isValid = Lead.validateContactInfo(contactInfo);
      expect(isValid).toBe(true);
      
      // Property: Contact info with valid email should be accepted
      expect(contactInfo.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Invalid contact info rejection', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constant({}), // Missing email
        fc.record({ email: fc.string().filter(s => !s.includes('@')) }), // Invalid email
        fc.record({ 
          email: validEmailGen,
          preferred_channel: fc.oneof(
            fc.constant(''), // Empty string
            fc.string().filter(s => !['email', 'whatsapp', 'chatbot'].includes(s) && s !== '') // Invalid but non-empty
          )
        }) // Invalid channel
      ),
      (invalidContactInfo) => {
        // Property: Invalid contact info should always fail validation
        const isValid = Lead.validateContactInfo(invalidContactInfo);
        expect(isValid).toBe(false);
      }
    ), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Required fields validation', () => {
    fc.assert(fc.property(
      fc.record({
        crm_user_id: fc.option(fc.string(), { nil: undefined }),
        organization_id: fc.option(fc.string(), { nil: undefined }),
        product_id: fc.option(fc.string(), { nil: undefined })
      }),
      (partialData) => {
        const validation = Lead.validateRequiredFields(partialData);
        
        // Property: If any required field is missing or empty, validation should fail
        const hasAllRequired = partialData.crm_user_id !== undefined && 
                              partialData.organization_id !== undefined && 
                              partialData.product_id !== undefined &&
                              typeof partialData.crm_user_id === 'string' &&
                              typeof partialData.organization_id === 'string' &&
                              typeof partialData.product_id === 'string' &&
                              partialData.crm_user_id.trim() !== '' &&
                              partialData.organization_id.trim() !== '' &&
                              partialData.product_id.trim() !== '';
        
        expect(validation.valid).toBe(hasAllRequired);
        
        if (!hasAllRequired) {
          expect(validation.field).toBeDefined();
          expect(validation.message).toBeDefined();
        }
      }
    ), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - JSON serialization round-trip', () => {
    fc.assert(fc.property(validLeadDataGen, (leadData) => {
      // Create lead and convert to JSON
      const originalLead = new Lead(leadData);
      const jsonData = originalLead.toJSON();
      const reconstructedLead = new Lead(jsonData);
      
      // Property: JSON round-trip should preserve all data
      expect(reconstructedLead.crm_user_id).toBe(originalLead.crm_user_id);
      expect(reconstructedLead.organization_id).toBe(originalLead.organization_id);
      expect(reconstructedLead.product_id).toBe(originalLead.product_id);
      expect(reconstructedLead.stage).toBe(originalLead.stage);
      expect(reconstructedLead.engagement_score).toBe(originalLead.engagement_score);
      expect(reconstructedLead.contact_info).toEqual(originalLead.contact_info);
      expect(reconstructedLead.demographics).toEqual(originalLead.demographics);
      expect(reconstructedLead.product_context).toEqual(originalLead.product_context);
    }), { numRuns: 100 });
  });

  test('Property 7: Data Independence and Consistency - Engagement score validation consistency', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.float(), // Non-integer numbers
        fc.integer({ max: -1 }), // Negative numbers
        fc.constant('not a number'),
        fc.constant(null),
        fc.constant(undefined)
      ),
      (invalidScore) => {
        // Skip valid scores
        fc.pre(!(Number.isInteger(invalidScore) && invalidScore >= 0));
        
        // Property: Invalid engagement scores should always fail validation
        const isValid = Lead.validateEngagementScore(invalidScore);
        expect(isValid).toBe(false);
      }
    ), { numRuns: 100 });
  });
});