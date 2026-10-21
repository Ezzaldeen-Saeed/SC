/**
 * @fileoverview Agent module routes.
 * All routes require authentication and the AGENT role.
 * The agent only ever reads/writes their own calls and customers.
 * @module modules/agent/agent.routes
 */

const express = require('express');
const router = express.Router();

const agentController = require('./agent.controller');
const {
  createCallSchema,
  updateCallSchema,
  callIdParamSchema,
  createCustomerSchema,
} = require('./agent.validation');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const auditLog = require('../../middleware/auditLogger');
const { ROLES } = require('../../utils/constants');

// All routes here require an authenticated agent.
router.use(authenticate, authorize(ROLES.AGENT));

/**
 * @route GET /api/agent/calls
 * @desc  List the agent's own calls
 * @access Agent
 */
router.get('/calls', agentController.getMyCalls);

/**
 * @route POST /api/agent/calls
 * @desc  Persist a finished call (user_id taken from the session)
 * @access Agent
 */
router.post('/calls', validate(createCallSchema), auditLog('CREATE_CALL', 'call'), agentController.createCall);

/**
 * @route PATCH /api/agent/calls/:callId
 * @desc  Update customer/type/category on one of the agent's own calls
 * @access Agent
 */
router.patch(
  '/calls/:callId',
  validate(callIdParamSchema, 'params'),
  validate(updateCallSchema),
  agentController.updateCall
);

/**
 * @route GET /api/agent/customers
 * @desc  List the agent's own customers (for the call's customer picker)
 * @access Agent
 */
router.get('/customers', agentController.getMyCustomers);

/**
 * @route GET /api/agent/customers/lookup?phone=...
 * @desc  Customer context (identity + history summary) for the live console
 * @access Agent
 */
router.get('/customers/lookup', agentController.lookupCustomer);

/**
 * @route POST /api/agent/customers
 * @desc  Quick-create a customer owned by the agent
 * @access Agent
 */
router.post('/customers', validate(createCustomerSchema), agentController.createCustomer);

module.exports = router;
