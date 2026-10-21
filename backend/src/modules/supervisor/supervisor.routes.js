/**
 * @fileoverview Supervisor module routes.
 * All routes require authentication and the SUPERVISOR role, and are
 * scoped to the supervisor's own agents.
 * @module modules/supervisor/supervisor.routes
 */

const express = require('express');
const router = express.Router();

const supervisorController = require('./supervisor.controller');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { ROLES } = require('../../utils/constants');

router.use(authenticate, authorize(ROLES.SUPERVISOR));

/**
 * @route GET /api/supervisor/agents
 * @desc  Agents under this supervisor
 * @access Supervisor
 */
router.get('/agents', supervisorController.getAgents);

/**
 * @route GET /api/supervisor/calls
 * @desc  Calls (with customer + evaluation) for this supervisor's agents
 * @access Supervisor
 */
router.get('/calls', supervisorController.getCalls);

/**
 * @route GET /api/supervisor/calls/:id
 * @desc  Full detail for a single call by one of this supervisor's agents
 * @access Supervisor
 */
router.get('/calls/:id', supervisorController.getCallDetail);

/**
 * @route GET /api/supervisor/stats
 * @desc  Supervisor dashboard statistics
 * @access Supervisor
 */
router.get('/stats', supervisorController.getStats);

/**
 * @route GET /api/supervisor/customers
 * @desc  Customers handled by this supervisor's agents (+ handling employee)
 * @access Supervisor
 */
router.get('/customers', supervisorController.getCustomers);

module.exports = router;
