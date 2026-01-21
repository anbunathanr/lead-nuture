const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');

class EngagementEvent {
  constructor(data = {}) {
    this.id = data.id || null;
    this.lead_id = data.lead_id || null;
    this.event_type = data.event_type || null;
    this.channel = data.channel || null;
    this.timestamp = data.timestamp || new Date();
    this.metadata = data.metadata || {};
    this.score_impact = data.score_impact || 0;
  }

  // Validation methods
  static validateEventType(eventType) {
    const validTypes = ['email_open', 'email_click', 'whatsapp_reply', 'chatbot_interaction', 'login'];
    return validTypes.includes(eventType);
  }

  static validateChannel(channel) {
    const validChannels = ['email', 'whatsapp', 'chatbot', 'product'];
    return validChannels.includes(channel);
  }

  static validateScoreImpact(scoreImpact) {
    return typeof scoreImpact === 'number' && Number.isInteger(scoreImpact);
  }

  static validateMetadata(metadata) {
    return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata);
  }

  static validateRequiredFields(data) {
    const requiredFields = ['lead_id', 'event_type', 'channel'];
    
    for (const field of requiredFields) {
      if (!data[field]) {
        return { valid: false, field, message: `${field} is required` };
      }
    }
    
    // Validate lead_id is a valid UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (data.lead_id && !uuidRegex.test(data.lead_id)) {
      return { valid: false, field: 'lead_id', message: 'lead_id must be a valid UUID' };
    }
    
    return { valid: true };
  }

  // Validate the entire engagement event object
  validate() {
    const errors = [];

    // Check required fields
    const requiredValidation = EngagementEvent.validateRequiredFields(this);
    if (!requiredValidation.valid) {
      errors.push(requiredValidation.message);
    }

    // Validate event type
    if (!EngagementEvent.validateEventType(this.event_type)) {
      errors.push('Event type must be one of: email_open, email_click, whatsapp_reply, chatbot_interaction, login');
    }

    // Validate channel
    if (!EngagementEvent.validateChannel(this.channel)) {
      errors.push('Channel must be one of: email, whatsapp, chatbot, product');
    }

    // Validate score impact
    if (!EngagementEvent.validateScoreImpact(this.score_impact)) {
      errors.push('Score impact must be an integer');
    }

    // Validate metadata
    if (!EngagementEvent.validateMetadata(this.metadata)) {
      errors.push('Metadata must be a valid object');
    }

    // Validate timestamp
    if (this.timestamp && !(this.timestamp instanceof Date) && isNaN(Date.parse(this.timestamp))) {
      errors.push('Timestamp must be a valid date');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Calculate score impact based on event type and rules
  static calculateScoreImpact(eventType, channel, scoringRules = {}, metadata = {}) {
    const defaultRules = {
      login_points: 10,
      email_open_points: 5,
      email_click_points: 15,
      whatsapp_reply_points: 20,
      chatbot_interaction_points: 10,
      email_engagement_multiplier: 1.0,
      time_decay_factor: 1.0
    };

    const rules = { ...defaultRules, ...scoringRules };
    let basePoints = 0;

    // Calculate base points by event type
    switch (eventType) {
      case 'login':
        basePoints = rules.login_points;
        break;
      case 'email_open':
        basePoints = rules.email_open_points;
        break;
      case 'email_click':
        basePoints = rules.email_click_points;
        break;
      case 'whatsapp_reply':
        basePoints = rules.whatsapp_reply_points;
        break;
      case 'chatbot_interaction':
        basePoints = rules.chatbot_interaction_points;
        break;
      default:
        basePoints = 0;
    }

    // Apply channel-specific multipliers
    if (channel === 'email') {
      const multiplier = isNaN(rules.email_engagement_multiplier) ? 1.0 : rules.email_engagement_multiplier;
      basePoints *= multiplier;
    }

    // Apply time decay if timestamp is provided in metadata
    if (metadata.timestamp && rules.time_decay_factor !== 1.0) {
      const eventTime = new Date(metadata.timestamp);
      const now = new Date();
      const hoursSinceEvent = (now - eventTime) / (1000 * 60 * 60);
      
      // Apply decay for events older than 24 hours
      if (hoursSinceEvent > 24) {
        const decayFactor = Math.pow(rules.time_decay_factor, Math.floor(hoursSinceEvent / 24));
        basePoints *= decayFactor;
      }
    }

    // Apply metadata-based bonuses
    if (metadata.high_value_action) {
      // Ensure minimum increase of 1 point for high value actions
      const bonus = Math.max(1, Math.round(basePoints * 0.5));
      basePoints += bonus;
    }

    if (metadata.repeat_engagement && metadata.engagement_count > 1) {
      // Diminishing returns for repeat engagements
      const repeatMultiplier = 1 / Math.sqrt(metadata.engagement_count);
      basePoints *= repeatMultiplier;
    }

    return Math.round(Math.max(0, basePoints));
  }

  // Update score impact based on rules
  updateScoreImpact(scoringRules = {}) {
    this.score_impact = EngagementEvent.calculateScoreImpact(
      this.event_type,
      this.channel,
      scoringRules,
      this.metadata
    );
  }

  // Save engagement event to database
  async save() {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    try {
      if (this.id) {
        // Update existing event
        const result = await query(
          `UPDATE engagement_events SET 
           lead_id = $1, event_type = $2, channel = $3, timestamp = $4,
           metadata = $5, score_impact = $6
           WHERE id = $7 RETURNING *`,
          [
            this.lead_id, this.event_type, this.channel, this.timestamp,
            JSON.stringify(this.metadata), this.score_impact, this.id
          ]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Engagement event not found');
        }
        
        Object.assign(this, result.rows[0]);
        logger.info(`Updated engagement event ${this.id}`);
      } else {
        // Create new event
        const result = await query(
          `INSERT INTO engagement_events (lead_id, event_type, channel, timestamp, metadata, score_impact)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            this.lead_id, this.event_type, this.channel, this.timestamp,
            JSON.stringify(this.metadata), this.score_impact
          ]
        );
        
        Object.assign(this, result.rows[0]);
        logger.info(`Created new engagement event ${this.id} for lead ${this.lead_id}`);
      }
      
      return this;
    } catch (error) {
      logger.error('Failed to save engagement event:', error);
      throw error;
    }
  }

  // Process engagement event and update lead score
  async processAndUpdateLeadScore(scoringRules = {}) {
    try {
      await transaction(async (client) => {
        // Save the engagement event
        if (!this.id) {
          const result = await client.query(
            `INSERT INTO engagement_events (lead_id, event_type, channel, timestamp, metadata, score_impact)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
              this.lead_id, this.event_type, this.channel, this.timestamp,
              JSON.stringify(this.metadata), this.score_impact
            ]
          );
          Object.assign(this, result.rows[0]);
        }

        // Get current lead
        const leadResult = await client.query('SELECT * FROM leads WHERE id = $1', [this.lead_id]);
        if (leadResult.rows.length === 0) {
          throw new Error('Lead not found');
        }

        const lead = leadResult.rows[0];
        const newScore = lead.engagement_score + this.score_impact;

        // Update lead engagement score
        await client.query(
          'UPDATE leads SET engagement_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newScore, this.lead_id]
        );

        // Record score history
        await client.query(
          'INSERT INTO lead_scores (lead_id, score, calculation_reason) VALUES ($1, $2, $3)',
          [this.lead_id, newScore, `Engagement event: ${this.event_type}`]
        );

        logger.info(`Processed engagement event ${this.id}, updated lead ${this.lead_id} score: ${lead.engagement_score} -> ${newScore}`);
      });
    } catch (error) {
      logger.error(`Failed to process engagement event for lead ${this.lead_id}:`, error);
      throw error;
    }
  }

  // Static methods for database operations
  static async findById(id) {
    try {
      const result = await query('SELECT * FROM engagement_events WHERE id = $1', [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new EngagementEvent(result.rows[0]);
    } catch (error) {
      logger.error(`Failed to find engagement event by id ${id}:`, error);
      throw error;
    }
  }

  static async findByLeadId(leadId, limit = 100, offset = 0) {
    try {
      const result = await query(
        'SELECT * FROM engagement_events WHERE lead_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3',
        [leadId, limit, offset]
      );
      
      return result.rows.map(row => new EngagementEvent(row));
    } catch (error) {
      logger.error(`Failed to find engagement events for lead ${leadId}:`, error);
      throw error;
    }
  }

  static async findByEventType(eventType, limit = 100, offset = 0) {
    try {
      const result = await query(
        'SELECT * FROM engagement_events WHERE event_type = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3',
        [eventType, limit, offset]
      );
      
      return result.rows.map(row => new EngagementEvent(row));
    } catch (error) {
      logger.error(`Failed to find engagement events by type ${eventType}:`, error);
      throw error;
    }
  }

  static async findByChannel(channel, limit = 100, offset = 0) {
    try {
      const result = await query(
        'SELECT * FROM engagement_events WHERE channel = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3',
        [channel, limit, offset]
      );
      
      return result.rows.map(row => new EngagementEvent(row));
    } catch (error) {
      logger.error(`Failed to find engagement events by channel ${channel}:`, error);
      throw error;
    }
  }

  static async findByDateRange(startDate, endDate, limit = 100, offset = 0) {
    try {
      const result = await query(
        'SELECT * FROM engagement_events WHERE timestamp >= $1 AND timestamp <= $2 ORDER BY timestamp DESC LIMIT $3 OFFSET $4',
        [startDate, endDate, limit, offset]
      );
      
      return result.rows.map(row => new EngagementEvent(row));
    } catch (error) {
      logger.error(`Failed to find engagement events by date range:`, error);
      throw error;
    }
  }

  static async getEngagementSummary(leadId) {
    try {
      const result = await query(
        `SELECT 
           event_type,
           channel,
           COUNT(*) as event_count,
           SUM(score_impact) as total_score_impact,
           MAX(timestamp) as last_event_time
         FROM engagement_events 
         WHERE lead_id = $1 
         GROUP BY event_type, channel
         ORDER BY total_score_impact DESC`,
        [leadId]
      );
      
      return result.rows;
    } catch (error) {
      logger.error(`Failed to get engagement summary for lead ${leadId}:`, error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const result = await query('DELETE FROM engagement_events WHERE id = $1 RETURNING id', [id]);
      
      if (result.rows.length === 0) {
        throw new Error('Engagement event not found');
      }
      
      logger.info(`Deleted engagement event ${id}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete engagement event ${id}:`, error);
      throw error;
    }
  }

  // Convert to JSON (for API responses)
  toJSON() {
    return {
      id: this.id,
      lead_id: this.lead_id,
      event_type: this.event_type,
      channel: this.channel,
      timestamp: this.timestamp,
      metadata: this.metadata,
      score_impact: this.score_impact
    };
  }
}

module.exports = EngagementEvent;