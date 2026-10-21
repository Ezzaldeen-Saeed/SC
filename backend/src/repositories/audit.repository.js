/**
 * @module repositories/audit.repository
 * @description Data access layer for the audit_logs table.
 * All operations use supabaseAdmin (service role) for full access.
 * Audit log writes are fire-and-forget — errors are logged but never thrown.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

// Set once if the audit_logs table is missing, to avoid repeated error logs.
let tableMissing = false;

/**
 * Create a new audit log entry.
 * This is a fire-and-forget operation: errors are logged but not thrown,
 * ensuring audit logging never disrupts the main application flow.
 *
 * @param {Object} logData - Audit log data to insert
 * @param {string} logData.user_id - UUID of the user who performed the action
 * @param {string} logData.action - Action performed (e.g. 'CREATE', 'UPDATE', 'DELETE')
 * @param {string} logData.resource - Resource type (e.g. 'user', 'call', 'customer')
 * @param {string} [logData.resource_id] - ID of the affected resource
 * @param {Object} [logData.details] - Additional JSONB details
 * @param {string} [logData.ip_address] - Client IP address
 * @param {string} [logData.user_agent] - Client user agent string
 * @returns {Promise<void>}
 */
async function create(logData) {
  if (tableMissing) return;
  try {
    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert(logData);

    if (error) {
      if (error.code === 'PGRST205' || /could not find the table/i.test(error.message || '')) {
        tableMissing = true;
        logger.warn('audit_logs table not found — audit logging disabled. Run supabase/migrate.sql to provision it.', {
          error: error.message,
        });
        return;
      }
      logger.error('AuditRepository.create failed', {
        error: error.message,
        logData,
      });
    }
  } catch (err) {
    logger.error('AuditRepository.create unexpected error', {
      error: err.message,
      logData,
    });
  }
}

module.exports = {
  create,
};
