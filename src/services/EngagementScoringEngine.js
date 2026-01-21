const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const Lead = require('../models/Lead');
const EngagementEvent = require('../models/EngagementEvent');

class EngagementScoringEngine {
  constructor() {
    // Default scoring rules - can be overridden per product
    this.defaultScoringRules = {
      // Base points for different event types
      login_points: 10,
      email_open_points: 5,
      email_click_points: 15,
      whatsapp_reply_points: 20,
      chatbot_interaction_points: 10,
      
      // Multipliers
      email_engagement_multiplier: 1.0,
      repeat_engagement_decay: 0.8, // Diminishing returns for repeat actions
      time_decay_factor: 0.95, // Daily decay for old events
      
      // Qualification thresholds
      engaged_lead_threshold: 50,
      qualified_lead_threshold: 150,
      customer_threshold: 300,
      
      // Bonus modifiers
      high_value_action_bonus: 0.5, // 50% bonus for high-value actions
      first_time_bonus: 1.2, // 20% bonus for first-time actions
      consecutive_days_bonus: 0.1, // 10% bonus per consecutive day
      
      // Time windows (in hours)
      recent_activity_window: 24, // Consider events in last 24 hours as "recent"
      engagement_window: 168, // 7 days for engagement calculations
      decay_start_hours: 72 // Start applying time decay after 3 days
    };

    // Product-specific configurations cache
    this.productConfigs = new Map();
  }

  /**
   * Get scoring rules for a specific product
   */
  async getScoringRules(productId) {
    // Check cache first
    if (this.productConfigs.has(productId)) {
      return this.productConfigs.get(productId);
    }

    try {
      const result = await query(
        'SELECT scoring_rules FROM product_configs WHERE product_id = $1',
        [productId]
      );

      let rules = this.defaultScoringRules;
      if (result.rows.length > 0 && result.rows[0].scoring_rules) {
        // Merge product-specific rules with defaults
        rules = {
          ...this.defaultScoringRules,
          ...result.rows[0].scoring_rules
        };
      }

      // Cache the rules
      this.productConfigs.set(productId, rules);
      return rules;
    } catch (error) {
      logger.error(`Failed to get scoring rules for product ${productId}:`, error);
      return this.defaultScoringRules;
    }
  }

  /**
   * Calculate base score for an engagement event
   */
  calculateEventScore(event, scoringRules) {
    let baseScore = 0;

    // Get base points for event type
    switch (event.event_type) {
      case 'login':
        baseScore = scoringRules.login_points;
        break;
      case 'email_open':
        baseScore = scoringRules.email_open_points;
        break;
      case 'email_click':
        baseScore = scoringRules.email_click_points;
        break;
      case 'whatsapp_reply':
        baseScore = scoringRules.whatsapp_reply_points;
        break;
      case 'chatbot_interaction':
        baseScore = scoringRules.chatbot_interaction_points;
        break;
      default:
        baseScore = event.score_impact || 0;
    }

    // Apply channel-specific multipliers
    if (event.channel === 'email') {
      baseScore *= scoringRules.email_engagement_multiplier;
    }

    return Math.round(baseScore);
  }

  /**
   * Apply time-based decay to event scores
   */
  applyTimeDecay(eventScore, eventTimestamp, scoringRules) {
    const now = new Date();
    const eventTime = new Date(eventTimestamp);
    const hoursAgo = (now - eventTime) / (1000 * 60 * 60);

    // No decay for recent events
    if (hoursAgo <= scoringRules.decay_start_hours) {
      return eventScore;
    }

    // Apply exponential decay
    const daysOld = Math.floor(hoursAgo / 24);
    const decayFactor = Math.pow(scoringRules.time_decay_factor, daysOld);
    
    return Math.round(eventScore * decayFactor);
  }

  /**
   * Apply engagement pattern bonuses
   */
  applyEngagementBonuses(eventScore, event, eventHistory, scoringRules) {
    let bonusMultiplier = 1.0;

    // High-value action bonus
    if (event.metadata && event.metadata.high_value_action) {
      bonusMultiplier += scoringRules.high_value_action_bonus;
    }

    // First-time action bonus
    const previousSameTypeEvents = eventHistory.filter(e => 
      e.event_type === event.event_type && 
      new Date(e.timestamp) < new Date(event.timestamp)
    );
    
    if (previousSameTypeEvents.length === 0) {
      bonusMultiplier += (scoringRules.first_time_bonus - 1.0);
    }

    // Consecutive days bonus
    const consecutiveDays = this.calculateConsecutiveDays(event, eventHistory);
    if (consecutiveDays > 1) {
      const consecutiveBonus = Math.min(
        consecutiveDays * scoringRules.consecutive_days_bonus,
        1.0 // Cap at 100% bonus
      );
      bonusMultiplier += consecutiveBonus;
    }

    // Repeat engagement decay
    const sameTypeCount = eventHistory.filter(e => e.event_type === event.event_type).length;
    if (sameTypeCount > 1) {
      const decayFactor = Math.pow(scoringRules.repeat_engagement_decay, sameTypeCount - 1);
      bonusMultiplier *= decayFactor;
    }

    return Math.round(eventScore * bonusMultiplier);
  }

  /**
   * Calculate consecutive engagement days
   */
  calculateConsecutiveDays(currentEvent, eventHistory) {
    const currentDate = new Date(currentEvent.timestamp);
    currentDate.setHours(0, 0, 0, 0);
    
    let consecutiveDays = 1;
    let checkDate = new Date(currentDate);
    checkDate.setDate(checkDate.getDate() - 1);

    // Look backwards for consecutive days
    for (let i = 0; i < 30; i++) { // Check up to 30 days back
      const hasEventOnDate = eventHistory.some(event => {
        const eventDate = new Date(event.timestamp);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate.getTime() === checkDate.getTime();
      });

      if (hasEventOnDate) {
        consecutiveDays++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return consecutiveDays;
  }

  /**
   * Calculate comprehensive engagement score for a lead
   */
  async calculateLeadScore(leadId, productId) {
    try {
      const scoringRules = await this.getScoringRules(productId);
      
      // Get all engagement events for the lead within the engagement window
      const cutoffTime = new Date(Date.now() - (scoringRules.engagement_window * 60 * 60 * 1000));
      
      const result = await query(
        `SELECT * FROM engagement_events 
         WHERE lead_id = $1 AND timestamp >= $2 
         ORDER BY timestamp ASC`,
        [leadId, cutoffTime]
      );

      const events = result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));

      let totalScore = 0;
      const scoreBreakdown = {
        base_scores: [],
        time_decay_applied: [],
        bonus_applied: [],
        final_scores: []
      };

      // Calculate score for each event
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const eventHistory = events.slice(0, i); // Events before current one

        // Calculate base score
        const baseScore = this.calculateEventScore(event, scoringRules);
        scoreBreakdown.base_scores.push({ event_id: event.id, score: baseScore });

        // Apply time decay
        const decayedScore = this.applyTimeDecay(baseScore, event.timestamp, scoringRules);
        scoreBreakdown.time_decay_applied.push({ event_id: event.id, score: decayedScore });

        // Apply engagement bonuses
        const finalScore = this.applyEngagementBonuses(decayedScore, event, eventHistory, scoringRules);
        scoreBreakdown.bonus_applied.push({ event_id: event.id, score: finalScore });
        scoreBreakdown.final_scores.push({ event_id: event.id, score: finalScore });

        totalScore += finalScore;
      }

      // Apply recent activity boost
      const recentEvents = events.filter(event => {
        const eventTime = new Date(event.timestamp);
        const hoursAgo = (Date.now() - eventTime) / (1000 * 60 * 60);
        return hoursAgo <= scoringRules.recent_activity_window;
      });

      if (recentEvents.length > 0) {
        const recentActivityBonus = Math.min(recentEvents.length * 5, 50); // Max 50 point bonus
        totalScore += recentActivityBonus;
        scoreBreakdown.recent_activity_bonus = recentActivityBonus;
      }

      return {
        total_score: Math.max(0, Math.round(totalScore)),
        event_count: events.length,
        recent_events: recentEvents.length,
        scoring_rules_used: scoringRules,
        breakdown: scoreBreakdown,
        calculated_at: new Date()
      };
    } catch (error) {
      logger.error(`Failed to calculate lead score for ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Update lead's engagement score and record history
   */
  async updateLeadScore(leadId, reason = 'Scheduled recalculation') {
    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error('Lead not found');
      }

      const scoreCalculation = await this.calculateLeadScore(leadId, lead.product_id);
      const newScore = scoreCalculation.total_score;
      const oldScore = lead.engagement_score;

      if (newScore === oldScore) {
        logger.debug(`No score change for lead ${leadId}: ${oldScore}`);
        return {
          leadId,
          oldScore,
          newScore,
          changed: false,
          calculation: scoreCalculation
        };
      }

      // Update score in transaction
      await transaction(async (client) => {
        // Update lead record
        await client.query(
          'UPDATE leads SET engagement_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newScore, leadId]
        );

        // Record score history
        await client.query(
          'INSERT INTO lead_scores (lead_id, score, calculation_reason) VALUES ($1, $2, $3)',
          [leadId, newScore, reason]
        );
      });

      logger.info(`Updated engagement score for lead ${leadId}: ${oldScore} -> ${newScore}`);

      return {
        leadId,
        oldScore,
        newScore,
        changed: true,
        calculation: scoreCalculation
      };
    } catch (error) {
      logger.error(`Failed to update lead score for ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Process new engagement event and update lead score
   */
  async processEngagementEvent(leadId, eventData) {
    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error('Lead not found');
      }

      const scoringRules = await this.getScoringRules(lead.product_id);

      // Create engagement event
      const event = new EngagementEvent({
        lead_id: leadId,
        ...eventData
      });

      // Calculate score impact for this specific event
      const baseScore = this.calculateEventScore(event, scoringRules);
      event.score_impact = baseScore;

      // Save event and update lead score in transaction
      await transaction(async (client) => {
        // Save the engagement event
        const eventResult = await client.query(
          `INSERT INTO engagement_events (lead_id, event_type, channel, timestamp, metadata, score_impact)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            event.lead_id, event.event_type, event.channel, event.timestamp,
            JSON.stringify(event.metadata), event.score_impact
          ]
        );
        
        Object.assign(event, eventResult.rows[0]);

        // Recalculate total lead score
        const scoreCalculation = await this.calculateLeadScore(leadId, lead.product_id);
        const newScore = scoreCalculation.total_score;

        // Update lead engagement score
        await client.query(
          'UPDATE leads SET engagement_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newScore, leadId]
        );

        // Record score history
        await client.query(
          'INSERT INTO lead_scores (lead_id, score, calculation_reason) VALUES ($1, $2, $3)',
          [leadId, newScore, `Engagement event: ${event.event_type}`]
        );

        logger.info(`Processed engagement event ${event.id}, updated lead ${leadId} score to ${newScore}`);
      });

      return {
        event,
        scoreUpdate: await this.updateLeadScore(leadId, `Event: ${event.event_type}`)
      };
    } catch (error) {
      logger.error(`Failed to process engagement event for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Check if lead meets qualification threshold
   */
  async checkQualificationStatus(leadId, productId) {
    try {
      const scoringRules = await this.getScoringRules(productId);
      const lead = await Lead.findById(leadId);
      
      if (!lead) {
        throw new Error('Lead not found');
      }

      const currentScore = lead.engagement_score;
      
      return {
        leadId,
        currentScore,
        thresholds: {
          engaged_lead: scoringRules.engaged_lead_threshold,
          qualified_lead: scoringRules.qualified_lead_threshold,
          customer: scoringRules.customer_threshold
        },
        qualifications: {
          is_engaged: currentScore >= scoringRules.engaged_lead_threshold,
          is_qualified: currentScore >= scoringRules.qualified_lead_threshold,
          is_customer_ready: currentScore >= scoringRules.customer_threshold
        },
        current_stage: lead.stage,
        recommended_stage: this.getRecommendedStage(currentScore, scoringRules)
      };
    } catch (error) {
      logger.error(`Failed to check qualification status for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Get recommended stage based on engagement score
   */
  getRecommendedStage(score, scoringRules) {
    if (score >= scoringRules.customer_threshold) {
      return 'Customer';
    } else if (score >= scoringRules.qualified_lead_threshold) {
      return 'Qualified_Lead';
    } else if (score >= scoringRules.engaged_lead_threshold) {
      return 'Engaged_Lead';
    } else {
      return 'User';
    }
  }

  /**
   * Batch update scores for multiple leads
   */
  async batchUpdateScores(leadIds, reason = 'Batch score update') {
    const results = [];
    
    for (const leadId of leadIds) {
      try {
        const result = await this.updateLeadScore(leadId, reason);
        results.push(result);
      } catch (error) {
        results.push({
          leadId,
          error: error.message,
          changed: false
        });
      }
    }

    return results;
  }

  /**
   * Get scoring analytics for a product
   */
  async getScoringAnalytics(productId, timeWindow = 30) {
    try {
      const cutoffTime = new Date(Date.now() - (timeWindow * 24 * 60 * 60 * 1000));
      
      const result = await query(
        `SELECT 
           l.stage,
           COUNT(*) as lead_count,
           AVG(l.engagement_score) as avg_score,
           MIN(l.engagement_score) as min_score,
           MAX(l.engagement_score) as max_score,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l.engagement_score) as median_score
         FROM leads l
         WHERE l.product_id = $1 AND l.updated_at >= $2
         GROUP BY l.stage
         ORDER BY 
           CASE l.stage 
             WHEN 'User' THEN 1
             WHEN 'Engaged_Lead' THEN 2
             WHEN 'Qualified_Lead' THEN 3
             WHEN 'Customer' THEN 4
           END`,
        [productId, cutoffTime]
      );

      return {
        product_id: productId,
        time_window_days: timeWindow,
        stage_analytics: result.rows,
        generated_at: new Date()
      };
    } catch (error) {
      logger.error(`Failed to get scoring analytics for product ${productId}:`, error);
      throw error;
    }
  }

  /**
   * Clear product config cache
   */
  clearCache(productId = null) {
    if (productId) {
      this.productConfigs.delete(productId);
    } else {
      this.productConfigs.clear();
    }
  }
}

module.exports = EngagementScoringEngine;