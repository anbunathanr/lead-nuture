-- Lead Nurturing Automation Database Schema
-- Migration 001: Create core tables for leads, events, scores, and product configs

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_user_id VARCHAR(255) NOT NULL,
    organization_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    stage VARCHAR(50) NOT NULL CHECK (stage IN ('User', 'Engaged_Lead', 'Qualified_Lead', 'Customer')),
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- Contact information (JSON)
    contact_info JSONB NOT NULL DEFAULT '{}',
    
    -- Demographics (JSON)
    demographics JSONB DEFAULT '{}',
    
    -- Product context (JSON)
    product_context JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(crm_user_id, product_id),
    
    -- Indexes for performance
    CONSTRAINT valid_engagement_score CHECK (engagement_score >= 0)
);

-- Create engagement_events table
CREATE TABLE IF NOT EXISTS engagement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL CHECK (event_type IN ('email_open', 'email_click', 'whatsapp_reply', 'chatbot_interaction', 'login')),
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'whatsapp', 'chatbot', 'product')),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    score_impact INTEGER DEFAULT 0
);

-- Create lead_scores table for historical scoring data
CREATE TABLE IF NOT EXISTS lead_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    calculation_reason VARCHAR(255),
    
    -- Constraints
    CONSTRAINT valid_score CHECK (score >= 0)
);

-- Create product_configs table
CREATE TABLE IF NOT EXISTS product_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    nurturing_sequences JSONB NOT NULL DEFAULT '[]',
    scoring_rules JSONB NOT NULL DEFAULT '{}',
    conversion_goals JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create stage_transitions table for audit trail
CREATE TABLE IF NOT EXISTS stage_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    from_stage VARCHAR(50),
    to_stage VARCHAR(50) NOT NULL,
    transition_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trigger_reason VARCHAR(255),
    metadata JSONB DEFAULT '{}'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_crm_user_id ON leads(crm_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_organization_id ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_product_id ON leads(product_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_engagement_score ON leads(engagement_score);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_last_login_at ON leads(last_login_at);

CREATE INDEX IF NOT EXISTS idx_engagement_events_lead_id ON engagement_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_engagement_events_event_type ON engagement_events(event_type);
CREATE INDEX IF NOT EXISTS idx_engagement_events_channel ON engagement_events(channel);
CREATE INDEX IF NOT EXISTS idx_engagement_events_timestamp ON engagement_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id ON lead_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_calculated_at ON lead_scores(calculated_at);

CREATE INDEX IF NOT EXISTS idx_product_configs_product_id ON product_configs(product_id);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead_id ON stage_transitions(lead_id);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_transition_at ON stage_transitions(transition_at);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_leads_product_stage ON leads(product_id, stage);
CREATE INDEX IF NOT EXISTS idx_engagement_events_lead_timestamp ON engagement_events(lead_id, timestamp);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_product_configs_updated_at BEFORE UPDATE ON product_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();