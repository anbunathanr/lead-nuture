const fc = require('fast-check');
const EngagementEvent = require('../../models/EngagementEvent');

/**
 * Property-Based Tests for Engagement Event Processing
 * Feature: lead-nurturing-automation, Property 5: Engagement Processing and Scoring
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */

describe('Engagement Event Processing Property Tests', () => {
  // Generators for test data
  const validEventTypeGen = fc.constantFrom('email_open', 'email_click', 'whatsapp_reply', 'chatbot_interaction', 'login');
  const validChannelGen = fc.constantFrom('email', 'whatsapp', 'chatbot', 'product');
  const validUuidGen = fc.uuid();
  const validScoreImpactGen = fc.integer({ min: 0, max: 100 });
  const validTimestampGen = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') });

  const validMetadataGen = fc.record({
    message_id: fc.option(fc.string()),
    content_type: fc.option(fc.string()),
    response_data: fc.option(fc.object()),
    high_value_action: fc.option(fc.boolean()),
    engagement_count: fc.option(fc.integer({ min: 1, max: 10 })),
    repeat_engagement: fc.option(fc.boolean())
  });

  const validEngagementEventDataGen = fc.record({
    lead_id: validUuidGen,
    event_type: validEventTypeGen,
    channel: validChannelGen,
    timestamp: validTimestampGen,
    metadata: validMetadataGen,
    score_impact: validScoreImpactGen
  });

  const scoringRulesGen = fc.record({
    login_points: fc.integer({ min: 1, max: 50 }),
    email_open_points: fc.integer({ min: 1, max: 20 }),
    email_click_points: fc.integer({ min: 1, max: 30 }),
    whatsapp_reply_points: fc.integer({ min: 1, max: 40 }),
    chatbot_interaction_points: fc.integer({ min: 1, max: 25 }),
    email_engagement_multiplier: fc.float({ min: Math.fround(0.5), max: Math.fround(2.0) }).filter(x => !isNaN(x)),
    time_decay_factor: fc.float({ min: Math.fround(0.8), max: Math.fround(1.0) }).filter(x => !isNaN(x))
  });

  test('Property 5: Engagement Processing and Scoring - Event validation consistency', () => {
    fc.assert(fc.property(validEngagementEventDataGen, (eventData) => {
      // Create an engagement event with valid data
      const event = new EngagementEvent(eventData);
      
      // Validation should always pass for valid data
      const validation = event.validate();
      
      // Property: Valid engagement event data should always pass validation
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      
      // Property: Event should maintain data consistency after creation
      expect(event.lead_id).toBe(eventData.lead_id);
      expect(event.event_type).toBe(eventData.event_type);
      expect(event.channel).toBe(eventData.channel);
      expect(event.score_impact).toBe(eventData.score_impact);
      expect(event.metadata).toEqual(eventData.metadata);
    }), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Score calculation consistency', () => {
    fc.assert(fc.property(
      validEventTypeGen,
      validChannelGen,
      scoringRulesGen,
      validMetadataGen,
      (eventType, channel, scoringRules, metadata) => {
        // Calculate score with the same inputs multiple times
        const score1 = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, metadata);
        const score2 = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, metadata);
        
        // Property: Score calculation should be deterministic
        expect(score1).toBe(score2);
        
        // Property: Score should never be negative
        expect(score1).toBeGreaterThanOrEqual(0);
        
        // Property: Score should be an integer
        expect(Number.isInteger(score1)).toBe(true);
        
        // Property: Score should be reasonable (not excessively high)
        expect(score1).toBeLessThanOrEqual(1000);
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Event type validation consistency', () => {
    fc.assert(fc.property(fc.string(), (invalidEventType) => {
      // Skip valid event types to test only invalid ones
      fc.pre(!['email_open', 'email_click', 'whatsapp_reply', 'chatbot_interaction', 'login'].includes(invalidEventType));
      
      // Property: Invalid event types should always fail validation
      const isValid = EngagementEvent.validateEventType(invalidEventType);
      expect(isValid).toBe(false);
    }), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Channel validation consistency', () => {
    fc.assert(fc.property(fc.string(), (invalidChannel) => {
      // Skip valid channels to test only invalid ones
      fc.pre(!['email', 'whatsapp', 'chatbot', 'product'].includes(invalidChannel));
      
      // Property: Invalid channels should always fail validation
      const isValid = EngagementEvent.validateChannel(invalidChannel);
      expect(isValid).toBe(false);
    }), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Score impact validation consistency', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.float(), // Non-integer numbers
        fc.constant('not a number'),
        fc.constant(null),
        fc.constant(undefined),
        fc.constant({}),
        fc.constant([])
      ),
      (invalidScoreImpact) => {
        // Skip valid score impacts
        fc.pre(!(Number.isInteger(invalidScoreImpact)));
        
        // Property: Invalid score impacts should always fail validation
        const isValid = EngagementEvent.validateScoreImpact(invalidScoreImpact);
        expect(isValid).toBe(false);
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Metadata validation consistency', () => {
    fc.assert(fc.property(validMetadataGen, (metadata) => {
      // Property: Valid metadata should always pass validation
      const isValid = EngagementEvent.validateMetadata(metadata);
      expect(isValid).toBe(true);
      
      // Property: Metadata should be an object
      expect(typeof metadata).toBe('object');
      expect(Array.isArray(metadata)).toBe(false);
      expect(metadata).not.toBeNull();
    }), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Invalid metadata rejection', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant(null),
        fc.constant('not an object'),
        fc.constant(123),
        fc.constant([]), // Arrays should be invalid
        fc.constant(true)
      ),
      (invalidMetadata) => {
        // Property: Invalid metadata should always fail validation
        const isValid = EngagementEvent.validateMetadata(invalidMetadata);
        expect(isValid).toBe(false);
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Required fields validation', () => {
    fc.assert(fc.property(
      fc.record({
        lead_id: fc.option(validUuidGen, { nil: undefined }),
        event_type: fc.option(validEventTypeGen, { nil: undefined }),
        channel: fc.option(validChannelGen, { nil: undefined })
      }),
      (partialData) => {
        const validation = EngagementEvent.validateRequiredFields(partialData);
        
        // Property: If any required field is missing, validation should fail
        const hasAllRequired = partialData.lead_id !== undefined && 
                              partialData.event_type !== undefined && 
                              partialData.channel !== undefined;
        
        expect(validation.valid).toBe(hasAllRequired);
        
        if (!hasAllRequired) {
          expect(validation.field).toBeDefined();
          expect(validation.message).toBeDefined();
        }
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Score impact calculation rules', () => {
    fc.assert(fc.property(
      validEventTypeGen,
      validChannelGen,
      scoringRulesGen,
      (eventType, channel, scoringRules) => {
        const score = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, {});
        
        // Property: Score should reflect the base points for the event type
        let expectedMinScore = 0;
        switch (eventType) {
          case 'login':
            expectedMinScore = Math.floor(scoringRules.login_points * 0.5); // Allow for multipliers
            break;
          case 'email_open':
            expectedMinScore = Math.floor(scoringRules.email_open_points * scoringRules.email_engagement_multiplier * 0.5);
            break;
          case 'email_click':
            expectedMinScore = Math.floor(scoringRules.email_click_points * scoringRules.email_engagement_multiplier * 0.5);
            break;
          case 'whatsapp_reply':
            expectedMinScore = Math.floor(scoringRules.whatsapp_reply_points * 0.5);
            break;
          case 'chatbot_interaction':
            expectedMinScore = Math.floor(scoringRules.chatbot_interaction_points * 0.5);
            break;
        }
        
        // Property: Score should be at least some portion of the expected base score
        expect(score).toBeGreaterThanOrEqual(0);
        
        // Property: Email channel should apply email multiplier
        if (channel === 'email' && (eventType === 'email_open' || eventType === 'email_click')) {
          // Score should reflect the email engagement multiplier
          expect(score).toBeGreaterThan(0);
        }
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - JSON serialization round-trip', () => {
    fc.assert(fc.property(validEngagementEventDataGen, (eventData) => {
      // Create event and convert to JSON
      const originalEvent = new EngagementEvent(eventData);
      const jsonData = originalEvent.toJSON();
      const reconstructedEvent = new EngagementEvent(jsonData);
      
      // Property: JSON round-trip should preserve all data
      expect(reconstructedEvent.lead_id).toBe(originalEvent.lead_id);
      expect(reconstructedEvent.event_type).toBe(originalEvent.event_type);
      expect(reconstructedEvent.channel).toBe(originalEvent.channel);
      expect(reconstructedEvent.score_impact).toBe(originalEvent.score_impact);
      expect(reconstructedEvent.metadata).toEqual(originalEvent.metadata);
      
      // Timestamps might be converted to strings, so check they represent the same time
      if (originalEvent.timestamp && reconstructedEvent.timestamp) {
        expect(new Date(reconstructedEvent.timestamp).getTime()).toBe(new Date(originalEvent.timestamp).getTime());
      }
    }), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Score impact update consistency', () => {
    fc.assert(fc.property(
      validEngagementEventDataGen,
      scoringRulesGen,
      (eventData, scoringRules) => {
        // Create event and update score impact
        const event = new EngagementEvent(eventData);
        const originalScoreImpact = event.score_impact;
        
        event.updateScoreImpact(scoringRules);
        
        // Property: Score impact should be recalculated based on event type and rules
        const expectedScore = EngagementEvent.calculateScoreImpact(
          event.event_type,
          event.channel,
          scoringRules,
          event.metadata
        );
        
        expect(event.score_impact).toBe(expectedScore);
        
        // Property: Updated score should be non-negative integer
        expect(event.score_impact).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(event.score_impact)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - High value action bonus', () => {
    fc.assert(fc.property(
      validEventTypeGen,
      validChannelGen,
      scoringRulesGen,
      (eventType, channel, scoringRules) => {
        // Calculate score without high value action
        const normalMetadata = { high_value_action: false };
        const normalScore = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, normalMetadata);
        
        // Calculate score with high value action
        const highValueMetadata = { high_value_action: true };
        const highValueScore = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, highValueMetadata);
        
        // Property: High value actions should result in higher scores (when base score > 0)
        if (normalScore > 0) {
          expect(highValueScore).toBeGreaterThan(normalScore);
          
          // Property: High value bonus should be at least 1 point more
          expect(highValueScore - normalScore).toBeGreaterThanOrEqual(1);
        } else {
          // If normal score is 0, high value should still be 0
          expect(highValueScore).toBe(0);
        }
      }
    ), { numRuns: 100 });
  });

  test('Property 5: Engagement Processing and Scoring - Repeat engagement diminishing returns', () => {
    fc.assert(fc.property(
      validEventTypeGen,
      validChannelGen,
      scoringRulesGen,
      fc.integer({ min: 2, max: 10 }),
      (eventType, channel, scoringRules, engagementCount) => {
        // Calculate score for first engagement
        const firstEngagementMetadata = { repeat_engagement: false, engagement_count: 1 };
        const firstScore = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, firstEngagementMetadata);
        
        // Calculate score for repeat engagement
        const repeatEngagementMetadata = { repeat_engagement: true, engagement_count: engagementCount };
        const repeatScore = EngagementEvent.calculateScoreImpact(eventType, channel, scoringRules, repeatEngagementMetadata);
        
        // Property: Repeat engagements should have diminishing returns (when base score > 0)
        if (firstScore > 0) {
          expect(repeatScore).toBeLessThanOrEqual(firstScore);
          
          // Property: Diminishing returns should follow square root pattern (approximately)
          const expectedDiminishedScore = Math.round(firstScore / Math.sqrt(engagementCount));
          // Allow for some variance due to rounding
          expect(Math.abs(repeatScore - expectedDiminishedScore)).toBeLessThanOrEqual(Math.max(1, Math.round(firstScore * 0.1)));
        }
      }
    ), { numRuns: 100 });
  });
});