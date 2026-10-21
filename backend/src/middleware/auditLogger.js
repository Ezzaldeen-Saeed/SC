/**
 * @module middleware/auditLogger
 * @description Audit trail middleware factory for write operations.
 * Creates middleware that records successful mutations (POST, PUT, PATCH, DELETE)
 * into the audit_logs table via the central audit service.
 *
 * Audit entries are written fire-and-forget — they never block the HTTP response,
 * sensitive fields are redacted, and a missing table never breaks the request.
 *
 * @example
 * const auditLog = require('../middleware/auditLogger');
 * router.post('/users', authenticate, auditLog('CREATE_USER', 'user'), handler);
 */

const audit = require('../services/audit.service');

/**
 * Creates an audit logging middleware for a specific action and resource.
 * @param {string} action - Canonical action (e.g. 'CREATE_USER', 'DELETE_USER').
 * @param {string} resource - Resource type (e.g. 'user', 'call', 'supervisor').
 * @returns {import('express').RequestHandler}
 */
function auditLog(action, resource) {
  return (req, res, next) => {
    res.on('finish', () => {
      // Only record successful operations (status < 400).
      if (res.statusCode >= 400) return;
      audit.record({
        userId: req.user && req.user.id ? req.user.id : null,
        action,
        resource,
        resourceId: req.params.id || null,
        details: { body: req.body, params: req.params },
        ip: req.ip,
        userAgent: req.get('User-Agent') || null,
      });
    });
    next();
  };
}

module.exports = auditLog;
