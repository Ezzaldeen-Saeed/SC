/**
 * @fileoverview Admin module routes.
 * All routes require authentication and ADMIN role authorization.
 * Write operations include audit logging.
 * @module modules/admin/admin.routes
 */

const express = require('express');
const router = express.Router();

const adminController = require('./admin.controller');
const { createUserSchema, updateRoleSchema, updateStatusSchema, assignManagerSchema, paramsIdSchema } = require('./admin.validation');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const auditLog = require('../../middleware/auditLogger');
const { ROLES } = require('../../utils/constants');

// Apply authentication and admin authorization to all routes in this router
router.use(authenticate, authorize(ROLES.ADMIN));

/**
 * @route GET /api/admin/overview
 * @desc Full dashboard payload (stats + users + calls + customers) in one request
 * @access Admin
 */
router.get('/overview', adminController.getOverview);

/**
 * @route GET /api/admin/users
 * @desc Get all users in the system
 * @access Admin
 */
router.get('/users', adminController.getUsers);

/**
 * @route GET /api/admin/users/:id
 * @desc Get a single user's full profile (details, parent, calls, KPIs)
 * @access Admin
 */
router.get('/users/:id', validate(paramsIdSchema, 'params'), adminController.getUserDetail);

/**
 * @route POST /api/admin/users
 * @desc Create a new user
 * @access Admin
 */
router.post(
  '/users',
  validate(createUserSchema),
  auditLog('CREATE_USER', 'user'),
  adminController.createUser
);

/**
 * @route PUT /api/admin/users/:id/role
 * @desc Update a user's role
 * @access Admin
 */
router.put(
  '/users/:id/role',
  validate(updateRoleSchema),
  auditLog('UPDATE_USER', 'user'),
  adminController.updateRole
);

/**
 * @route PUT /api/admin/users/:id/status
 * @desc Update a user's active status
 * @access Admin
 */
router.put(
  '/users/:id/status',
  validate(updateStatusSchema),
  auditLog('UPDATE_USER', 'user'),
  adminController.updateStatus
);

/**
 * @route PUT /api/admin/users/:id/manager
 * @desc Assign/change a user's parent in the hierarchy (manager_id)
 * @access Admin
 */
router.put(
  '/users/:id/parent',
  validate(assignManagerSchema),
  // Audit is recorded inside the controller (ASSIGN_AGENT vs ASSIGN_SUPERVISOR
  // depends on the target user's role, known only after the update).
  adminController.assignManager
);

/**
 * @route DELETE /api/admin/users/:id
 * @desc Delete a user
 * @access Admin
 */
router.delete(
  '/users/:id',
  auditLog('DELETE_USER', 'user'),
  adminController.deleteUser
);

/**
 * @route GET /api/admin/calls
 * @desc Get all calls
 * @access Admin
 */
router.get('/calls', adminController.getCalls);

/**
 * @route GET /api/admin/calls/:id
 * @desc Get a single call's full detail (agent, customer, scores, transcript)
 * @access Admin
 */
router.get('/calls/:id', validate(paramsIdSchema, 'params'), adminController.getCallDetail);

/**
 * @route GET /api/admin/customers
 * @desc Get all customers
 * @access Admin
 */
router.get('/customers', adminController.getCustomers);

/**
 * @route GET /api/admin/stats
 * @desc Get admin dashboard statistics
 * @access Admin
 */
router.get('/stats', adminController.getStats);

/**
 * @route GET /api/admin/audit-logs
 * @desc Recent audit-trail entries (with the acting user joined) for the
 *       admin Audit Logs dashboard.
 * @access Admin
 */
router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;
