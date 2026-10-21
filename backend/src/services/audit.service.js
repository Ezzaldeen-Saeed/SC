/**
 * @module services/audit.service
 * @description Central audit-trail writer/reader. Records significant actions
 * (LOGIN, CREATE_USER, …) into the audit_logs table and reads them back for the
 * admin Audit Logs dashboard.
 *
 * Writes are fire-and-forget — they never block or fail a request. If audit_logs
 * isn't provisioned, the writer warns once and disables itself (run
 * supabase/migrate.sql to enable). Sensitive fields are redacted before storage.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/** Canonical action names surfaced by the admin Audit Logs dashboard. */
const ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'CREATE_USER',
  'UPDATE_USER',
  'DELETE_USER',
  'CREATE_CALL',
  'ASSIGN_SUPERVISOR',
  'ASSIGN_AGENT',
  'GENERATE_REPORT',
  'PASSWORD_RESET_REQUEST',
  'PASSWORD_RESET',
];

/** Keys whose values must never be persisted into audit details.
 *  'code'/'code_hash' cover password-reset OTPs: auditLogger records whole request
 *  bodies, and admins can read audit_logs — a live code must never land there. */
const SENSITIVE = [
  'password',
  'new_password',
  'current_password',
  'token',
  'access_token',
  'refresh_token',
  'code',
  'code_hash',
];

let tableMissing = false;

/**
 * Deep-clone an object with sensitive values masked.
 * @param {*} obj
 * @returns {*}
 */
function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    if (SENSITIVE.includes(key)) clean[key] = '***';
    else if (obj[key] && typeof obj[key] === 'object') clean[key] = redact(obj[key]);
    else clean[key] = obj[key];
  }
  return clean;
}

/**
 * Record an audit entry (fire-and-forget).
 * @param {Object} entry
 * @param {string} [entry.userId]    - Acting user's UUID
 * @param {string} entry.action      - One of ACTIONS
 * @param {string} [entry.resource]  - Resource type (user, call, auth, …)
 * @param {string} [entry.resourceId]
 * @param {Object} [entry.details]
 * @param {string} [entry.ip]
 * @param {string} [entry.userAgent]
 */
function record(entry) {
  if (tableMissing || !entry || !entry.action) return;

  const row = {
    user_id: entry.userId || null,
    action: entry.action,
    resource: entry.resource || null,
    resource_id: entry.resourceId || null,
    details: redact(entry.details || {}),
    ip_address: entry.ip || null,
    user_agent: entry.userAgent || null,
    created_at: new Date().toISOString(),
  };

  supabaseAdmin
    .from('audit_logs')
    .insert(row)
    .then(({ error }) => {
      if (error) {
        if (error.code === 'PGRST205' || /could not find the table/i.test(error.message || '')) {
          tableMissing = true;
          logger.warn(
            'audit_logs table not found — audit logging disabled until it exists. Run supabase/migrate.sql to provision it.',
            { error: error.message }
          );
          return;
        }
        logger.error('Audit record failed', { action: entry.action, error: error.message });
      }
    })
    .catch((err) => logger.error('Audit record threw', { action: entry.action, error: err.message }));
}

/**
 * List recent audit entries, newest first, with the acting user joined.
 * Returns [] (not an error) when the table isn't provisioned yet.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<Object>>}
 */
async function list({ limit = 500 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*, users(full_name, email, role)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (error.code === 'PGRST205' || /could not find the table/i.test(error.message || '')) return [];
    logger.error('AuditService.list failed', { error: error.message });
    throw ApiError.internal('Failed to fetch audit logs');
  }
  return data || [];
}

module.exports = { record, list, redact, ACTIONS };
