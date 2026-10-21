/**
 * @fileoverview Live-call routes. A shared snapshot endpoint (role-scoped) plus
 * agent-only signaling for start/heartbeat/end of an in-progress call.
 * @module modules/live/live.routes
 */

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { ROLES } = require('../../utils/constants');
const liveController = require('./live.controller');

router.use(authenticate);

/**
 * @route GET /api/live/calls
 * @desc  Role-scoped snapshot of in-progress calls
 * @access Authenticated (admin / manager / supervisor / agent)
 */
router.get('/calls', liveController.getLiveCalls);

/**
 * @route POST /api/live/start | /ping | /end
 * @desc  Agent signals the lifecycle of their own live call
 * @access Agent
 */
router.post('/start', authorize(ROLES.AGENT), liveController.startLive);
router.post('/ping', authorize(ROLES.AGENT), liveController.pingLive);
router.post('/end', authorize(ROLES.AGENT), liveController.endLive);

module.exports = router;
