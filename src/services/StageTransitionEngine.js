const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const Lead = require('../models/Lead');

class StageTransitionEngine {
  constructor() {
    // Define valid stage transitions
    this.validTransitions = {
      'User': ['Engaged_Lead'],
      'Engaged_Lead': ['Qualified_Lead', 'User'], // Can regress if engagement drops
      'Qualified_Lead': ['Customer', 'Engaged_Lead'], // Can regress if not converting
      'Customer': [] // Terminal state
    };

    // Default progression rules
    this.defaultRules = {
      'User': {
        to: 'Engaged_Lead',
        conditions: {
          min_engagement_score: 50,
          min_events: 3,
          time_window_hours: 168 // 7 days
        }
      },
      'Engaged_Lead': {
        to: 'Qualified_Lead',
        conditions: {
          min_engagement_score: 150,
          min_events: 8,
          time_window_hours: 336 // 14 days
        }
      },
      'Qualified_Lead': {
        to: 'Customer',
        conditions: {
          min_engagement_score: 300,
          conversion_event: true
        }
      }
    };
  }

  /**
   * Validate if a stage transition is allowed
   */
  isValidTransition(fromStage, toStage) {
    if (!this.validTransitions[fromStage]) {
      return false;
    }
    return this.validTransitions[fromStage].includes(toStage);
  }

  /**
   * Get next possible stages for a given stage
   */
  getNextStages(currentStage) {
    return this.validTransitions[currentStage] || [];
  }

  /**
   * Evaluate if a lead meets progression criteria
   */
  async evaluateProgression(leadId, productConfig = null) {
    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error('Lead not found');
      }

      // Get lead's engagement events
      const events = await this.getLeadEvents(leadId);
      
      // Use product-specific rules if available, otherwise use defaults
      const rules = productConfig?.progression_rules || this.defaultRules;
      const currentStageRule = rules[lead.stage];

      if (!currentStageRule) {
        logger.info(`No progression rule defined for stage: ${lead.stage}`);
        return { canProgress: false, reason: 'No progression rule defined' };
      }

      const evaluation = await this.evaluateConditions(lead, events, currentStageRule.conditions);
      
      return {
        canProgress: evaluation.met,
        nextStage: currentStageRule.to,
        currentStage: lead.stage,
        evaluation: evaluation,
        leadId: leadId
      };
    } catch (error) {
      logger.error(`Failed to evaluate progression for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Evaluate specific conditions for stage progression
   */
  async evaluateConditions(lead, events, conditions) {
    const evaluation = {
      met: true,
      details: {},
      failedConditions: []
    };

    // Check minimum engagement score
    if (conditions.min_engagement_score !== undefined) {
      const scoreMet = lead.engagement_score >= conditions.min_engagement_score;
      evaluation.details.engagement_score = {
        required: conditions.min_engagement_score,
        actual: lead.engagement_score,
        met: scoreMet
      };
      if (!scoreMet) {
        evaluation.met = false;
        evaluation.failedConditions.push('min_engagement_score');
      }
    }

    // Check minimum number of events
    if (conditions.min_events !== undefined) {
      const eventsMet = events.length >= conditions.min_events;
      evaluation.details.event_count = {
        required: conditions.min_events,
        actual: events.length,
        met: eventsMet
      };
      if (!eventsMet) {
        evaluation.met = false;
        evaluation.failedConditions.push('min_events');
      }
    }

    // Check time window (events within specified hours)
    if (conditions.time_window_hours !== undefined) {
      const cutoffTime = new Date(Date.now() - (conditions.time_window_hours * 60 * 60 * 1000));
      const recentEvents = events.filter(event => new Date(event.timestamp) >= cutoffTime);
      const timeWindowMet = recentEvents.length >= (conditions.min_events || 1);
      
      evaluation.details.time_window = {
        required_hours: conditions.time_window_hours,
        recent_events: recentEvents.length,
        cutoff_time: cutoffTime,
        met: timeWindowMet
      };
      if (!timeWindowMet) {
        evaluation.met = false;
        evaluation.failedConditions.push('time_window_hours');
      }
    }

    // Check for conversion event (for Customer stage)
    if (conditions.conversion_event) {
      const hasConversionEvent = events.some(event => 
        event.metadata && event.metadata.conversion === true
      );
      evaluation.details.conversion_event = {
        required: true,
        found: hasConversionEvent,
        met: hasConversionEvent
      };
      if (!hasConversionEvent) {
        evaluation.met = false;
        evaluation.failedConditions.push('conversion_event');
      }
    }

    // Check specific event types if required
    if (conditions.required_event_types) {
      const eventTypes = new Set(events.map(e => e.event_type));
      const missingTypes = conditions.required_event_types.filter(type => !eventTypes.has(type));
      const eventTypesMet = missingTypes.length === 0;
      
      evaluation.details.required_event_types = {
        required: conditions.required_event_types,
        found: Array.from(eventTypes),
        missing: missingTypes,
        met: eventTypesMet
      };
      if (!eventTypesMet) {
        evaluation.met = false;
        evaluation.failedConditions.push('required_event_types');
      }
    }

    return evaluation;
  }

  /**
   * Execute stage transition with full audit trail
   */
  async executeTransition(leadId, newStage, reason, metadata = {}) {
    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error('Lead not found');
      }

      const oldStage = lead.stage;

      // Validate transition
      if (!this.isValidTransition(oldStage, newStage)) {
        throw new Error(`Invalid transition from ${oldStage} to ${newStage}`);
      }

      // Execute transition in transaction
      await transaction(async (client) => {
        // Update lead stage
        await client.query(
          'UPDATE leads SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newStage, leadId]
        );

        // Record stage transition with audit trail
        await client.query(
          `INSERT INTO stage_transitions 
           (lead_id, from_stage, to_stage, trigger_reason, metadata) 
           VALUES ($1, $2, $3, $4, $5)`,
          [leadId, oldStage, newStage, reason, JSON.stringify(metadata)]
        );

        logger.info(`Stage transition executed: Lead ${leadId} from ${oldStage} to ${newStage}`, {
          leadId,
          oldStage,
          newStage,
          reason,
          metadata
        });
      });

      // Update local lead object
      lead.stage = newStage;
      
      return {
        success: true,
        leadId,
        oldStage,
        newStage,
        reason,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Failed to execute stage transition for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Auto-progress leads based on their current state and rules
   */
  async autoProgressLead(leadId, productConfig = null) {
    try {
      const evaluation = await this.evaluateProgression(leadId, productConfig);
      
      if (!evaluation.canProgress) {
        logger.debug(`Lead ${leadId} does not meet progression criteria:`, evaluation.evaluation);
        return {
          progressed: false,
          reason: 'Conditions not met',
          evaluation: evaluation.evaluation
        };
      }

      // Execute the transition
      const result = await this.executeTransition(
        leadId,
        evaluation.nextStage,
        'Auto-progression based on engagement criteria',
        {
          evaluation: evaluation.evaluation,
          auto_progression: true
        }
      );

      return {
        progressed: true,
        ...result,
        evaluation: evaluation.evaluation
      };
    } catch (error) {
      logger.error(`Failed to auto-progress lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Batch process multiple leads for auto-progression
   */
  async batchAutoProgress(leadIds, productConfig = null) {
    const results = [];
    
    for (const leadId of leadIds) {
      try {
        const result = await this.autoProgressLead(leadId, productConfig);
        results.push({ leadId, ...result });
      } catch (error) {
        results.push({
          leadId,
          progressed: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get stage transition history for a lead
   */
  async getTransitionHistory(leadId) {
    try {
      const result = await query(
        `SELECT * FROM stage_transitions 
         WHERE lead_id = $1 
         ORDER BY transition_at DESC`,
        [leadId]
      );

      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      logger.error(`Failed to get transition history for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Get leads eligible for progression by stage
   */
  async getEligibleLeads(stage, productId = null, limit = 100) {
    try {
      let queryText = `
        SELECT l.* FROM leads l
        WHERE l.stage = $1
      `;
      let params = [stage];

      if (productId) {
        queryText += ' AND l.product_id = $2';
        params.push(productId);
      }

      queryText += ' ORDER BY l.engagement_score DESC, l.updated_at ASC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await query(queryText, params);
      return result.rows.map(row => new Lead(row));
    } catch (error) {
      logger.error(`Failed to get eligible leads for stage ${stage}:`, error);
      throw error;
    }
  }

  /**
   * Get engagement events for a lead
   */
  async getLeadEvents(leadId, limit = 1000) {
    try {
      const result = await query(
        `SELECT * FROM engagement_events 
         WHERE lead_id = $1 
         ORDER BY timestamp DESC 
         LIMIT $2`,
        [leadId, limit]
      );

      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      logger.error(`Failed to get events for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Force stage transition (bypass validation for manual overrides)
   */
  async forceTransition(leadId, newStage, reason, metadata = {}) {
    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error('Lead not found');
      }

      const oldStage = lead.stage;

      // Execute transition in transaction (without validation)
      await transaction(async (client) => {
        // Update lead stage
        await client.query(
          'UPDATE leads SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newStage, leadId]
        );

        // Record stage transition with audit trail
        await client.query(
          `INSERT INTO stage_transitions 
           (lead_id, from_stage, to_stage, trigger_reason, metadata) 
           VALUES ($1, $2, $3, $4, $5)`,
          [leadId, oldStage, newStage, reason, JSON.stringify({
            ...metadata,
            forced_transition: true
          })]
        );

        logger.warn(`Forced stage transition: Lead ${leadId} from ${oldStage} to ${newStage}`, {
          leadId,
          oldStage,
          newStage,
          reason,
          metadata
        });
      });

      // Update local lead object
      lead.stage = newStage;
      
      return {
        success: true,
        leadId,
        oldStage,
        newStage,
        reason,
        forced: true,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Failed to force stage transition for lead ${leadId}:`, error);
      throw error;
    }
  }
}

module.exports = StageTransitionEngine;