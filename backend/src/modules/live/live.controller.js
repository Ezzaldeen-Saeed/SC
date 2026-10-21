/**
 * @fileoverview Live-call controller. Agents signal start/heartbeat/end of an
 * in-progress call; admins/managers/supervisors read a role-scoped snapshot of
 * who is currently on a live call.
 * @module modules/live/live.controller
 */

const asyncHandler = require('../../utils/asyncHandler');
const liveCalls = require('../../services/liveCalls.service');
const usersService = require('../../services/users.service');

/**
 * Role-scoped snapshot of in-progress calls.
 *   admin       → every live call
 *   manager     → live calls of agents in their unit
 *   supervisor  → live calls of their own agents
 *   agent       → only their own live call
 * @route GET /api/live/calls
 * @returns {{ success: boolean, liveCalls: object[], count: number }}
 */
const getLiveCalls = asyncHandler(async (req, res) => {
  const role = req.user.role;
  let calls;
  if (role === 'admin') {
    calls = liveCalls.list(null);
  } else if (role === 'agent') {
    calls = liveCalls.list([req.user.id]);
  } else {
    const agentIds = await usersService.getVisibleAgentIds(req.user); // manager / supervisor scope
    calls = liveCalls.list(agentIds);
  }
  res.status(200).json({ success: true, liveCalls: calls, count: calls.length });
});

/**
 * Mark the agent as being on a live call (called when transcription starts).
 * @route POST /api/live/start
 * @returns {{ success: boolean, live: object }}
 */
const startLive = asyncHandler(async (req, res) => {
  const live = liveCalls.start(req.user, { customer_name: req.body && req.body.customer_name });
  res.status(200).json({ success: true, live });
});

/**
 * Keep the agent's live call alive (periodic heartbeat from the console).
 * @route POST /api/live/ping
 * @returns {{ success: boolean, live: object }}
 */
const pingLive = asyncHandler(async (req, res) => {
  const live = liveCalls.heartbeat(req.user, { customer_name: req.body && req.body.customer_name });
  res.status(200).json({ success: true, live });
});

/**
 * End the agent's live call (call finished / disconnected).
 * @route POST /api/live/end
 * @returns {{ success: boolean }}
 */
const endLive = asyncHandler(async (req, res) => {
  liveCalls.end(req.user);
  res.status(200).json({ success: true });
});

module.exports = { getLiveCalls, startLive, pingLive, endLive };
