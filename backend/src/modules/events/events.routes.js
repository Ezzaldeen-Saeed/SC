/**
 * @fileoverview Real-time event stream (Server-Sent Events).
 * Dashboards connect with an EventSource to receive live notifications.
 * @module modules/events/events.routes
 */

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/authenticate');
const events = require('../../services/events.service');

/**
 * @route GET /api/events?token=<jwt>
 * @desc  Open an SSE stream of notifications scoped to the authenticated user.
 * @access Authenticated (token via query — EventSource can't set headers)
 */
router.get('/', authenticate, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  const client = events.addClient(res, req.user);

  // Heartbeat keeps the connection alive through proxies/idle timeouts.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* dropped */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    events.removeClient(client);
  });
});

module.exports = router;
