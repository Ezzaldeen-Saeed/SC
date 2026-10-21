/**
 * @fileoverview Manager module routes.
 * All routes require authentication and MANAGER role authorization.
 * Write operations include audit logging.
 * @module modules/manager/manager.routes
 */

const express = require('express');
const router = express.Router();

const managerController = require('./manager.controller');
const { createSupervisorSchema, updateStatusSchema } = require('./manager.validation');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const auditLog = require('../../middleware/auditLogger');
const { ROLES } = require('../../utils/constants');

// Apply authentication and manager authorization to all routes in this router
router.use(authenticate, authorize(ROLES.MANAGER));

/**
 * @route GET /api/manager/supervisors
 * @desc Get all supervisors under the current manager
 * @access Manager
 */
router.get('/supervisors', managerController.getSupervisors);

/**
 * @route POST /api/manager/supervisors
 * @desc Create a new supervisor under the current manager
 * @access Manager
 */
router.post(
  '/supervisors',
  validate(createSupervisorSchema),
  auditLog('ASSIGN_SUPERVISOR', 'supervisor'),
  managerController.createSupervisor
);

/**
 * @route PUT /api/manager/supervisors/:id/status
 * @desc Update a supervisor's active status
 * @access Manager
 */
router.put(
  '/supervisors/:id/status',
  validate(updateStatusSchema),
  auditLog('UPDATE_USER', 'supervisor'),
  managerController.updateSupervisorStatus
);

/**
 * @route DELETE /api/manager/supervisors/:id
 * @desc Delete a supervisor
 * @access Manager
 */
router.delete(
  '/supervisors/:id',
  auditLog('DELETE_USER', 'supervisor'),
  managerController.deleteSupervisor
);

/**
 * @route GET /api/manager/agents
 * @desc Get all agents in the manager's unit
 * @access Manager
 */
router.get('/agents', managerController.getAgents);

/**
 * @route GET /api/manager/calls
 * @desc Get all calls for the manager's unit (agents under their supervisors)
 * @access Manager
 */
router.get('/calls', managerController.getCalls);

/**
 * @route GET /api/manager/calls/:id
 * @desc Full detail for a single call in the manager's unit (404 if out of scope)
 * @access Manager
 */
router.get('/calls/:id', managerController.getCallDetail);

/**
 * @route GET /api/manager/customers
 * @desc Get all customers for the manager's supervisors
 * @access Manager
 */
router.get('/customers', managerController.getCustomers);

/**
 * @route GET /api/manager/stats
 * @desc Get manager dashboard statistics
 * @access Manager
 */
router.get('/stats', managerController.getStats);

/**
 * @route GET /api/manager/supervisor-kpis
 * @desc Per-supervisor KPIs (leaderboard): #agents, #calls, avg score
 * @access Manager
 */
router.get('/supervisor-kpis', managerController.getSupervisorKpis);

module.exports = router;
