/**
 * @fileoverview Manager controller - handles manager-level supervisor,
 * call, customer, and dashboard operations.
 * All operations are scoped to the authenticated manager's domain.
 * @module modules/manager/manager.controller
 */

const asyncHandler = require('../../utils/asyncHandler');
const usersService = require('../../services/users.service');
const callsService = require('../../services/calls.service');
const customersService = require('../../services/customers.service');
const dashboardService = require('../../services/dashboard.service');

/**
 * Get all supervisors under the current manager.
 * @route GET /api/manager/supervisors
 * @returns {{ success: boolean, supervisors: object[] }}
 */
const getSupervisors = asyncHandler(async (req, res) => {
  const supervisors = await usersService.getSupervisorsByManager(req.user.id);
  res.status(200).json({ success: true, supervisors });
});

/**
 * Create a new supervisor under the current manager.
 * @route POST /api/manager/supervisors
 * @returns {{ success: boolean, supervisor: object }}
 */
const createSupervisor = asyncHandler(async (req, res) => {
  const supervisor = await usersService.createSupervisor(req.user.id, req.body);
  res.status(201).json({ success: true, supervisor });
});

/**
 * Update a supervisor's active status.
 * @route PUT /api/manager/supervisors/:id/status
 * @returns {{ success: boolean }}
 */
const updateSupervisorStatus = asyncHandler(async (req, res) => {
  await usersService.updateSupervisorStatus(req.user.id, req.params.id, req.body.is_active);
  res.status(200).json({ success: true });
});

/**
 * Delete a supervisor.
 * @route DELETE /api/manager/supervisors/:id
 * @returns {{ success: boolean }}
 */
const deleteSupervisor = asyncHandler(async (req, res) => {
  await usersService.deleteSupervisor(req.user.id, req.params.id);
  res.status(200).json({ success: true });
});

/**
 * Get all AGENTS in the manager's unit (agents under their supervisors).
 * @route GET /api/manager/agents
 * @returns {{ success: boolean, agents: object[] }}
 */
const getAgents = asyncHandler(async (req, res) => {
  const agents = await usersService.getAgentsForUser(req.user);
  res.status(200).json({ success: true, agents });
});

/**
 * Get all calls for the manager's whole unit (agents under their supervisors),
 * with customer + evaluation embedded — doubles as the unit reports feed.
 * @route GET /api/manager/calls
 * @returns {{ success: boolean, calls: object[] }}
 */
const getCalls = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user);
  const calls = await callsService.getCallsByUserIds(agentIds);
  res.status(200).json({ success: true, calls });
});

/**
 * Get a single call's full detail (agent, customer, scores, transcript),
 * scoped to the manager's unit so out-of-unit calls return 404.
 * @route GET /api/manager/calls/:id
 * @returns {{ success: boolean, call: object }}
 */
const getCallDetail = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user);
  const call = await callsService.getScopedCallDetail(req.params.id, agentIds);
  res.status(200).json({ success: true, call });
});

/**
 * Get customers (the customers table is shared — not scoped per user).
 * @route GET /api/manager/customers
 * @returns {{ success: boolean, customers: object[] }}
 */
const getCustomers = asyncHandler(async (req, res) => {
  const agentIds = await usersService.getVisibleAgentIds(req.user); // the manager's unit
  const customers = await customersService.getScopedCustomers(agentIds);
  res.status(200).json({ success: true, customers });
});

/**
 * Get manager dashboard statistics.
 * Returns stats directly without a success wrapper for backward compatibility.
 * @route GET /api/manager/stats
 * @returns {{ supervisorsCount: number, agentsCount: number, callsCount: number }}
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await dashboardService.getManagerStats(req.user.id);
  res.status(200).json(stats);
});

/**
 * Per-supervisor KPIs (leaderboard): #agents, #calls, avg score per supervisor.
 * @route GET /api/manager/supervisor-kpis
 * @returns {{ success: boolean, supervisors: object[] }}
 */
const getSupervisorKpis = asyncHandler(async (req, res) => {
  const supervisors = await dashboardService.getSupervisorKpis(req.user.id);
  res.status(200).json({ success: true, supervisors });
});

module.exports = {
  getSupervisors,
  createSupervisor,
  updateSupervisorStatus,
  deleteSupervisor,
  getAgents,
  getCalls,
  getCallDetail,
  getCustomers,
  getStats,
  getSupervisorKpis,
};
