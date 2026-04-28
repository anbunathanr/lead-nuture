-- Lead Nurturing Database Setup
-- Run: psql -U postgres -f database/setup.sql

CREATE DATABASE lead_nurturing;
\c lead_nurturing;

CREATE TABLE leads (
    id           SERIAL PRIMARY KEY,
    name         TEXT        NOT NULL,
    email        TEXT        NOT NULL UNIQUE,
    phone        TEXT,
    role         TEXT,
    company      TEXT,
    company_size TEXT,
    product      TEXT,
    industry     TEXT,
    goal         TEXT,
    notes        TEXT,
    login_count  INT         DEFAULT 0,
    lead_status  TEXT        DEFAULT 'COLD',
    created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lead_status ON leads(lead_status);
CREATE INDEX idx_created_at  ON leads(created_at);

CREATE TABLE IF NOT EXISTS followups (
    id           SERIAL PRIMARY KEY,
    lead_id      INT REFERENCES leads(id) ON DELETE CASCADE,
    channel      TEXT        NOT NULL,
    message_type TEXT        NOT NULL,
    scheduled_at TIMESTAMP   NOT NULL,
    sent_at      TIMESTAMP,
    status       TEXT        DEFAULT 'pending',
    created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON followups(scheduled_at) WHERE status = 'pending';

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data
INSERT INTO leads (name, email, phone, role, company, company_size, product, industry, login_count, lead_status) VALUES
('Rahul',  'rahul@gmail.com',  '9876543210', 'Developer / Engineer', 'TechCorp',    '11–50',  'Free Trial',    'SaaS / Software', 0, 'COLD'),
('Priya',  'priya@gmail.com',  '9876543211', 'Marketing Manager',   'GrowthCo',   '1–10',   'Starter Plan',  'Marketing Agency', 2, 'WARM'),
('Arjun',  'arjun@gmail.com',  '9876543212', 'Founder / CEO',       'StartupXYZ', '1–10',   'Growth Plan',   'Fintech',          5, 'HOT'),
('Sneha',  'sneha@gmail.com',  '9876543213', 'Product Manager',     'ProductCo',  '51–200', 'Free Trial',    'E-commerce',       1, 'COLD'),
('Vikram', 'vikram@gmail.com', '9876543214', 'Founder / CEO',       'VikramInc',  '1–10',   'Pro Plan',      'SaaS / Software',  7, 'HOT'),
('Ananya', 'ananya@gmail.com', '9876543215', 'Sales Manager',       'SalesForce', '201–500','Enterprise',    'Consulting',       3, 'WARM');

SELECT id, name, email, login_count, lead_status FROM leads;
