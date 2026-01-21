const express = require('express');
const Lead = require('../models/Lead');
const logger = require('../utils/logger');

const router = express.Router();

// POST /leads - Create new lead
router.post('/', async (req, res) => {
  try {
    const leadData = req.body;
    
    // Create new lead instance
    const lead = new Lead(leadData);
    
    // Validate and save
    await lead.save();
    
    logger.info(`Created new lead: ${lead.id}`);
    res.status(201).json({
      success: true,
      data: lead.toJSON(),
      message: 'Lead created successfully'
    });
  } catch (error) {
    logger.error('Error creating lead:', error);
    
    if (error.message.includes('Validation failed')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    if (error.code === '23505') { // PostgreSQL unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: 'Lead with this CRM user ID and product already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to create lead'
    });
  }
});

// GET /leads/:id - Retrieve lead details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    const lead = await Lead.findById(id);
    
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    logger.info(`Retrieved lead: ${lead.id}`);
    res.json({
      success: true,
      data: lead.toJSON()
    });
  } catch (error) {
    logger.error('Error retrieving lead:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to retrieve lead'
    });
  }
});

// PUT /leads/:id - Update lead information
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    // Find existing lead
    const existingLead = await Lead.findById(id);
    if (!existingLead) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    // Update lead properties (excluding id and timestamps)
    const allowedUpdates = [
      'crm_user_id', 'organization_id', 'product_id', 'stage', 
      'engagement_score', 'last_login_at', 'contact_info', 
      'demographics', 'product_context'
    ];
    
    for (const field of allowedUpdates) {
      if (updateData[field] !== undefined) {
        existingLead[field] = updateData[field];
      }
    }
    
    // Validate and save
    await existingLead.save();
    
    logger.info(`Updated lead: ${existingLead.id}`);
    res.json({
      success: true,
      data: existingLead.toJSON(),
      message: 'Lead updated successfully'
    });
  } catch (error) {
    logger.error('Error updating lead:', error);
    
    if (error.message.includes('Validation failed')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    if (error.message === 'Lead not found') {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to update lead'
    });
  }
});

// DELETE /leads/:id - Delete lead (optional endpoint for cleanup)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Lead ID must be a valid UUID'
      });
    }
    
    await Lead.delete(id);
    
    logger.info(`Deleted lead: ${id}`);
    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting lead:', error);
    
    if (error.message === 'Lead not found') {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Lead not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to delete lead'
    });
  }
});

// GET /leads - List leads with filtering (bonus endpoint)
router.get('/', async (req, res) => {
  try {
    const { stage, product_id, limit = 50, offset = 0 } = req.query;
    
    let leads;
    if (stage) {
      leads = await Lead.findByStage(stage, product_id);
    } else {
      // If no specific filters, return recent leads
      const { query } = require('../config/database');
      let queryText = 'SELECT * FROM leads';
      let params = [];
      
      if (product_id) {
        queryText += ' WHERE product_id = $1';
        params.push(product_id);
      }
      
      queryText += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(parseInt(limit), parseInt(offset));
      
      const result = await query(queryText, params);
      leads = result.rows.map(row => new Lead(row));
    }
    
    res.json({
      success: true,
      data: leads.map(lead => lead.toJSON()),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: leads.length
      }
    });
  } catch (error) {
    logger.error('Error listing leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to retrieve leads'
    });
  }
});

module.exports = router;