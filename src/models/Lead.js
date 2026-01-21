const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');

class Lead {
  constructor(data = {}) {
    this.id = data.id || null;
    this.crm_user_id = data.crm_user_id || null;
    this.organization_id = data.organization_id || null;
    this.product_id = data.product_id || null;
    this.stage = data.stage || 'User';
    this.engagement_score = data.engagement_score || 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.last_login_at = data.last_login_at || null;
    this.contact_info = data.contact_info || {};
    this.demographics = data.demographics || {};
    this.product_context = data.product_context || {};
  }

  // Validation methods
  static validateStage(stage) {
    const validStages = ['User', 'Engaged_Lead', 'Qualified_Lead', 'Customer'];
    return validStages.includes(stage);
  }

  static validateEngagementScore(score) {
    return typeof score === 'number' && score >= 0 && Number.isInteger(score);
  }

  static validateContactInfo(contactInfo) {
    if (!contactInfo || typeof contactInfo !== 'object') {
      return false;
    }
    
    // Email is required
    if (!contactInfo.email || typeof contactInfo.email !== 'string') {
      return false;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactInfo.email)) {
      return false;
    }
    
    // Validate preferred_channel if provided (must not be empty string)
    if (contactInfo.preferred_channel !== undefined && contactInfo.preferred_channel !== null) {
      const validChannels = ['email', 'whatsapp', 'chatbot'];
      if (typeof contactInfo.preferred_channel !== 'string' || 
          contactInfo.preferred_channel.trim() === '' ||
          !validChannels.includes(contactInfo.preferred_channel)) {
        return false;
      }
    }
    
    return true;
  }

  static validateRequiredFields(data) {
    const requiredFields = ['crm_user_id', 'organization_id', 'product_id'];
    
    for (const field of requiredFields) {
      if (!data[field] || typeof data[field] !== 'string' || data[field].trim() === '') {
        return { valid: false, field, message: `${field} is required and must be a non-empty string` };
      }
    }
    
    return { valid: true };
  }

  // Validate the entire lead object
  validate() {
    const errors = [];

    // Check required fields
    const requiredValidation = Lead.validateRequiredFields(this);
    if (!requiredValidation.valid) {
      errors.push(requiredValidation.message);
    }

    // Validate stage
    if (!Lead.validateStage(this.stage)) {
      errors.push('Stage must be one of: User, Engaged_Lead, Qualified_Lead, Customer');
    }

    // Validate engagement score
    if (!Lead.validateEngagementScore(this.engagement_score)) {
      errors.push('Engagement score must be a non-negative integer');
    }

    // Validate contact info
    if (!Lead.validateContactInfo(this.contact_info)) {
      errors.push('Contact info must include a valid email address');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Calculate engagement score based on events and rules
  static calculateEngagementScore(events, scoringRules = {}) {
    const defaultRules = {
      login_points: 10,
      email_open_points: 5,
      email_click_points: 15,
      whatsapp_reply_points: 20,
      chatbot_interaction_points: 10,
      email_engagement_multiplier: 1.0
    };

    const rules = { ...defaultRules, ...scoringRules };
    let totalScore = 0;

    for (const event of events) {
      let points = 0;
      
      switch (event.event_type) {
        case 'login':
          points = rules.login_points;
          break;
        case 'email_open':
          points = rules.email_open_points * rules.email_engagement_multiplier;
          break;
        case 'email_click':
          points = rules.email_click_points * rules.email_engagement_multiplier;
          break;
        case 'whatsapp_reply':
          points = rules.whatsapp_reply_points;
          break;
        case 'chatbot_interaction':
          points = rules.chatbot_interaction_points;
          break;
        default:
          points = event.score_impact || 0;
      }
      
      totalScore += Math.round(points);
    }

    return Math.max(0, totalScore);
  }

  // Update engagement score
  async updateEngagementScore(newScore, reason = 'Manual update') {
    if (!Lead.validateEngagementScore(newScore)) {
      throw new Error('Invalid engagement score');
    }

    const oldScore = this.engagement_score;
    this.engagement_score = newScore;

    try {
      await transaction(async (client) => {
        // Update lead record
        await client.query(
          'UPDATE leads SET engagement_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newScore, this.id]
        );

        // Record score history
        await client.query(
          'INSERT INTO lead_scores (lead_id, score, calculation_reason) VALUES ($1, $2, $3)',
          [this.id, newScore, reason]
        );
      });

      logger.info(`Updated engagement score for lead ${this.id}: ${oldScore} -> ${newScore}`);
    } catch (error) {
      this.engagement_score = oldScore; // Rollback local change
      logger.error(`Failed to update engagement score for lead ${this.id}:`, error);
      throw error;
    }
  }

  // Progress to next stage
  async progressStage(newStage, reason = 'Manual progression') {
    if (!Lead.validateStage(newStage)) {
      throw new Error('Invalid stage');
    }

    const oldStage = this.stage;
    this.stage = newStage;

    try {
      await transaction(async (client) => {
        // Update lead record
        await client.query(
          'UPDATE leads SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newStage, this.id]
        );

        // Record stage transition
        await client.query(
          'INSERT INTO stage_transitions (lead_id, from_stage, to_stage, trigger_reason) VALUES ($1, $2, $3, $4)',
          [this.id, oldStage, newStage, reason]
        );
      });

      logger.info(`Lead ${this.id} progressed from ${oldStage} to ${newStage}`);
    } catch (error) {
      this.stage = oldStage; // Rollback local change
      logger.error(`Failed to progress lead ${this.id} stage:`, error);
      throw error;
    }
  }

  // Save lead to database
  async save() {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    try {
      if (this.id) {
        // Update existing lead
        const result = await query(
          `UPDATE leads SET 
           crm_user_id = $1, organization_id = $2, product_id = $3, stage = $4,
           engagement_score = $5, last_login_at = $6, contact_info = $7,
           demographics = $8, product_context = $9, updated_at = CURRENT_TIMESTAMP
           WHERE id = $10 RETURNING *`,
          [
            this.crm_user_id, this.organization_id, this.product_id, this.stage,
            this.engagement_score, this.last_login_at, JSON.stringify(this.contact_info),
            JSON.stringify(this.demographics), JSON.stringify(this.product_context), this.id
          ]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Lead not found');
        }
        
        Object.assign(this, result.rows[0]);
        logger.info(`Updated lead ${this.id}`);
      } else {
        // Create new lead
        const result = await query(
          `INSERT INTO leads (crm_user_id, organization_id, product_id, stage, engagement_score,
           last_login_at, contact_info, demographics, product_context)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            this.crm_user_id, this.organization_id, this.product_id, this.stage,
            this.engagement_score, this.last_login_at, JSON.stringify(this.contact_info),
            JSON.stringify(this.demographics), JSON.stringify(this.product_context)
          ]
        );
        
        Object.assign(this, result.rows[0]);
        logger.info(`Created new lead ${this.id}`);
      }
      
      return this;
    } catch (error) {
      logger.error('Failed to save lead:', error);
      throw error;
    }
  }

  // Static methods for database operations
  static async findById(id) {
    try {
      const result = await query('SELECT * FROM leads WHERE id = $1', [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new Lead(result.rows[0]);
    } catch (error) {
      logger.error(`Failed to find lead by id ${id}:`, error);
      throw error;
    }
  }

  static async findByCrmUserId(crmUserId, productId) {
    try {
      const result = await query(
        'SELECT * FROM leads WHERE crm_user_id = $1 AND product_id = $2',
        [crmUserId, productId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new Lead(result.rows[0]);
    } catch (error) {
      logger.error(`Failed to find lead by CRM user ID ${crmUserId}:`, error);
      throw error;
    }
  }

  static async findByStage(stage, productId = null) {
    try {
      let queryText = 'SELECT * FROM leads WHERE stage = $1';
      let params = [stage];
      
      if (productId) {
        queryText += ' AND product_id = $2';
        params.push(productId);
      }
      
      queryText += ' ORDER BY created_at DESC';
      
      const result = await query(queryText, params);
      
      return result.rows.map(row => new Lead(row));
    } catch (error) {
      logger.error(`Failed to find leads by stage ${stage}:`, error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const result = await query('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
      
      if (result.rows.length === 0) {
        throw new Error('Lead not found');
      }
      
      logger.info(`Deleted lead ${id}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete lead ${id}:`, error);
      throw error;
    }
  }

  // Convert to JSON (for API responses)
  toJSON() {
    return {
      id: this.id,
      crm_user_id: this.crm_user_id,
      organization_id: this.organization_id,
      product_id: this.product_id,
      stage: this.stage,
      engagement_score: this.engagement_score,
      created_at: this.created_at,
      updated_at: this.updated_at,
      last_login_at: this.last_login_at,
      contact_info: this.contact_info,
      demographics: this.demographics,
      product_context: this.product_context
    };
  }
}

module.exports = Lead;