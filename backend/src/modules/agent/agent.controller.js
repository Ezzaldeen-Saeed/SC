/**
 * @fileoverview Agent controller — the authenticated agent persists and reads
 * their own calls, and manages their own customers.
 * All operations are scoped to req.user.id (the agent), never a client-supplied id.
 * @module modules/agent/agent.controller
 */

const asyncHandler = require('../../utils/asyncHandler');
const callsService = require('../../services/calls.service');
const customersService = require('../../services/customers.service');
const usersService = require('../../services/users.service');
const events = require('../../services/events.service');

/**
 * List the authenticated agent's own calls (most recent first).
 * @route GET /api/agent/calls
 * @returns {{ success: boolean, calls: object[] }}
 */
const getMyCalls = asyncHandler(async (req, res) => {
  const calls = await callsService.getCallsForUser(req.user.id);
  res.status(200).json({ success: true, calls });
});

/**
 * Persist a finished call for the authenticated agent.
 * @route POST /api/agent/calls
 * @returns {{ success: boolean, call: object }}
 */
const createCall = asyncHandler(async (req, res) => {
  const call = await callsService.createCall(req.user.id, req.body);

  // Real-time: notify admins + the agent's supervisor + manager that a call landed.
  try {
    const supId = req.user.managerId || null;
    let mgrId = null;
    if (supId) {
      const sup = await usersService.getUserById(supId).catch(() => null);
      mgrId = sup ? sup.parent_id : null;
    }
    const customerName = call.customers ? call.customers.name : null;
    events.emit({
      type: 'call.created',
      title: 'مكالمة جديدة',
      body: `سجّل ${req.user.fullName || 'الموظف'} مكالمة${customerName ? ' مع ' + customerName : ''}`,
      notifType: 'success',
      roles: ['admin'],
      userIds: [supId, mgrId].filter(Boolean),
      exceptUserId: req.user.id,
    });
  } catch (e) { /* notifications are non-critical */ }

  res.status(201).json({ success: true, call });
});

/**
 * Update editable fields (customer/type/category) on one of the agent's calls.
 * @route PATCH /api/agent/calls/:callId
 * @returns {{ success: boolean, call: object }}
 */
const updateCall = asyncHandler(async (req, res) => {
  const call = await callsService.updateCall(req.user.id, req.params.callId, req.body);
  res.status(200).json({ success: true, call });
});

/**
 * List customers for the call's customer picker.
 * (The customers table is shared — not scoped per agent.)
 * @route GET /api/agent/customers
 * @returns {{ success: boolean, customers: object[] }}
 */
const getMyCustomers = asyncHandler(async (req, res) => {
  const customers = await customersService.getScopedCustomers([req.user.id]); // only the agent's own clients
  res.status(200).json({ success: true, customers });
});

/**
 * Quick-create a customer (name, phone_number, email).
 * @route POST /api/agent/customers
 * @returns {{ success: boolean, customer: object }}
 */
const createCustomer = asyncHandler(async (req, res) => {
  const customer = await customersService.createCustomer(req.body);
  res.status(201).json({ success: true, customer });
});

/**
 * Look up a caller by phone and return their context (who they are + history
 * summary) for the live console's "customer context" panel.
 * @route GET /api/agent/customers/lookup?phone=...
 * @returns {{ success: boolean, found: boolean, customer?, stats?, recentCalls? }}
 */
const lookupCustomer = asyncHandler(async (req, res) => {
  const context = await customersService.getContextByPhone(req.query.phone);
  res.status(200).json({ success: true, ...context });
});

module.exports = {
  getMyCalls,
  createCall,
  updateCall,
  getMyCustomers,
  createCustomer,
  lookupCustomer,
};
