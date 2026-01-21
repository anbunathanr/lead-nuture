const express = require('express');
const Lead = require('../models/Lead');
const EngagementEvent = require('../models/EngagementEvent');
const logger = require('../utils/logger');

const router = express.Router();

// POST /leads/:id/events - Record engagement event
router.post('/:id/events', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const eventData = req.body;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Check if lead exists
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    // Create engagement event
    const engagementEvent = new EngagementEvent({
      ...eventData,
      lead_id: leadId
    });
    
    // Calculate score impact if not provided
    if (engagementEvent.score_impact === 0 && eventData.score_impact === undefined) {
      engagementEvent.updateScoreImpact();
    }
    
    // Process event and update lead score
    await engagementEvent.processAndUpdateLeadScore();
    
    logger.info(`Recorded engagement event ${engagementEvent.id} for lead ${leadId}`);
    res.status(201).json({
      success: true,
      data: engagementEvent.toJSON(),
      message: 'Engagement event recorded successfully'
    });
  } catch (error) {
    logger.error('Error recording engagement event:', error);
    
    if (error.message.includes('Validation failed')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to record engagement event'
    });
  }
});

// GET /leads/:id/score - Get current engagement score
router.get('/:id/score', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Find lead
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    // Get engagement summary for additional context
    const engagementSummary = await EngagementEvent.getEngagementSummary(leadId);
    
    logger.info(`Retrieved engagement score for lead ${leadId}: ${lead.engagement_score}`);
    res.json({
      success: true,
      data: {
        lead_id: leadId,
        current_score: lead.engagement_score,
        stage: lead.stage,
        last_updated: lead.updated_at,
        engagement_breakdown: engagementSummary
      }
    });
  } catch (error) {
    logger.error('Error retrieving engagement score:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to retrieve engagement score'
    });
  }
});

// POST /leads/:id/stage - Update lead stage
router.post('/:id/stage', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { stage, reason } = req.body;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Validate required fields
    if (!stage) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Stage is required'
      });
    }
    
    // Find lead
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    // Validate stage transition
    if (!Lead.validateStage(stage)) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Invalid stage. Must be one of: User, Engaged_Lead, Qualified_Lead, Customer'
      });
    }
    
    const oldStage = lead.stage;
    
    // Progress stage
    await lead.progressStage(stage, reason || 'Manual stage update');
    
    logger.info(`Updated lead ${leadId} stage from ${oldStage} to ${stage}`);
    res.json({
      success: true,
      data: {
        lead_id: leadId,
        previous_stage: oldStage,
        current_stage: stage,
        updated_at: lead.updated_at,
        reason: reason || 'Manual stage update'
      },
      message: 'Lead stage updated successfully'
    });
  } catch (error) {
    logger.error('Error updating lead stage:', error);
    
    if (error.message.includes('Invalid stage')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to update lead stage'
    });
  }
});

// GET /leads/:id/events - Get engagement events for a lead (bonus endpoint)
router.get('/:id/events', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { limit = 50, offset = 0, event_type, channel } = req.query;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Check if lead exists
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    // Get engagement events with optional filtering
    let events;
    if (event_type || channel) {
      const { query } = require('../config/database');
      let queryText = 'SELECT * FROM engagement_events WHERE lead_id = $1';
      let params = [leadId];
      
      if (event_type) {
        queryText += ' AND event_type = $' + (params.length + 1);
        params.push(event_type);
      }
      
      if (channel) {
        queryText += ' AND channel = $' + (params.length + 1);
        params.push(channel);
      }
      
      queryText += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(parseInt(limit), parseInt(offset));
      
      const result = await query(queryText, params);
      events = result.rows.map(row => new EngagementEvent(row));
    } else {
      events = await EngagementEvent.findByLeadId(leadId, parseInt(limit), parseInt(offset));
    }
    
    res.json({
      success: true,
      data: events.map(event => event.toJSON()),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: events.length
      }
    });
  } catch (error) {
    logger.error('Error retrieving engagement events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to retrieve engagement events'
    });
  }
});

// PUT /leads/:id/score - Manually update engagement score (admin endpoint)
router.put('/:id/score', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { score, reason } = req.body;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Validate required fields
    if (score === undefined || score === null) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Score is required'
      });
    }
    
    if (!Lead.validateEngagementScore(score)) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Score must be a non-negative integer'
      });
    }
    
    // Find lead
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    const oldScore = lead.engagement_score;
    
    // Update score
    await lead.updateEngagementScore(score, reason || 'Manual score update');
    
    logger.info(`Manually updated lead ${leadId} score from ${oldScore} to ${score}`);
    res.json({
      success: true,
      data: {
        lead_id: leadId,
        previous_score: oldScore,
        current_score: score,
        updated_at: lead.updated_at,
        reason: reason || 'Manual score update'
      },
      message: 'Engagement score updated successfully'
    });
  } catch (error) {
    logger.error('Error updating engagement score:', error);
    
    if (error.message.includes('Invalid engagement score')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to update engagement score'
    });
  }
});

module.exports = router;