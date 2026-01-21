const fs = require('fs').promises;
const path = require('path');
const { query } = require('../config/database');
const logger = require('../utils/logger');

// Create migrations table to track applied migrations
async function createMigrationsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  await query(createTableQuery);
  logger.info('Migrations table created or already exists');
}

// Get list of applied migrations
async function getAppliedMigrations() {
  const result = await query('SELECT filename FROM migrations ORDER BY id');
  return result.rows.map(row => row.filename);
}

// Apply a single migration
async function applyMigration(filename, sqlContent) {
  try {
    // Execute the migration SQL
    await query(sqlContent);
    
    // Record the migration as applied
    await query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
    
    logger.info(`Migration ${filename} applied successfully`);
  } catch (error) {
    logger.error(`Failed to apply migration ${filename}:`, error);
    throw error;
  }
}

// Run all pending migrations
async function runMigrations() {
  try {
    await createMigrationsTable();
    
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = await fs.readdir(migrationsDir);
    const sqlFiles = migrationFiles
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    const appliedMigrations = await getAppliedMigrations();
    
    for (const filename of sqlFiles) {
      if (!appliedMigrations.includes(filename)) {
        const filePath = path.join(migrationsDir, filename);
        const sqlContent = await fs.readFile(filePath, 'utf8');
        
        logger.info(`Applying migration: ${filename}`);
        await applyMigration(filename, sqlContent);
      } else {
        logger.debug(`Migration ${filename} already applied, skipping`);
      }
    }
    
    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

// Rollback functionality (for development)
async function rollbackLastMigration() {
  try {
    const result = await query(
      'SELECT filename FROM migrations ORDER BY id DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }
    
    const lastMigration = result.rows[0].filename;
    
    // Remove from migrations table
    await query('DELETE FROM migrations WHERE filename = $1', [lastMigration]);
    
    logger.warn(`Rolled back migration: ${lastMigration}`);
    logger.warn('Note: This only removes the migration record. Manual cleanup of schema changes may be required.');
  } catch (error) {
    logger.error('Rollback failed:', error);
    throw error;
  }
}

module.exports = {
  runMigrations,
  rollbackLastMigration
};