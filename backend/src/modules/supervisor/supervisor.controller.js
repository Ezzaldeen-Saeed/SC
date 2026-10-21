/**
 * @fileoverview Supervisor controller — read-only views scoped to the
 * supervisor's own agents (calls / reports / evaluations / performance).
 * @module modules/supervisor/supervisor.controller
 */

const asyncHandler = require('../../utils/asyncHandler');
const usersService = require('../../services/users.service');
const callsService = require('../../services/calls.service');
const customersService = require('../../services/customers.service');

/**
 * List the agents directly under this supervisor.
 * @route GET /api/supervisor/agents
 * @returns {{ success: boolean, agents: object[] }}
 */
const getAgents = asyncHandler(async (req, res) => {
  const agents = await usersService.getAgentsForUser(req.user);
  res.status(200).json({ success: true, agents });
});

/**
 * All calls (with customer + evaluation) for this supervisor's agents.
 * Doubles as the "reports/evaluations" feed.
 * @route GET /api/supervisor/calls
 * @returns {{ success: boolean, calls: object[] }}
 */
const getCalls = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user);
  const calls = await callsService.getCallsByUserIds(agentIds);
  res.status(200).json({ success: true, calls });
});

/**
 * A single call's full detail (agent, customer, scores, transcript), scoped to
 * this supervisor's agents so out-of-scope calls return 404.
 * @route GET /api/supervisor/calls/:id
 * @returns {{ success: boolean, call: object }}
 */
const getCallDetail = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user);
  const call = await callsService.getScopedCallDetail(req.params.id, agentIds);
  res.status(200).json({ success: true, call });
});

/**
 * Dashboard stats for the supervisor (their agents + their calls).
 * @route GET /api/supervisor/stats
 * @returns {{ success: boolean, stats: object }}
 */
const getStats = asyncHandler(async (req, res) => {
  const agents = await usersService.getAgentsForUser(req.user);
  const agentIds = agents.map((a) => a.user_id);
  const calls = await callsService.getCallsByUserIds(agentIds);

  res.status(200).json({
    success: true,
    stats: {
      agentsCount: agents.length,
      activeAgents: agents.filter((a) => a.is_active).length,
      callsCount: calls.length,
    },
  });
});

/**
 * Customers handled by this supervisor's agents (scoped), each with the
 * handling employee. @route GET /api/supervisor/customers
 * @returns {{ success: boolean, customers: object[] }}
 */
const getCustomers = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user);
  const customers = await customersService.getScopedCustomers(agentIds);
  res.status(200).json({ success: true, customers });
});

module.exports = {
  getAgents,
  getCalls,
  getCallDetail,
  getStats,
  getCustomers,
};
