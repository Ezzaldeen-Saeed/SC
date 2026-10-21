/**
 * @module services/events.service
 * @description In-memory real-time event broadcaster (Server-Sent Events).
 * Connected dashboards subscribe via GET /api/events; mutations across the app
 * call emit() to push live notifications to the relevant users.
 *
 * Scoping: a client receives an event if its role is in `roles` OR its userId
 * is in `userIds`. The originating user (`exceptUserId`) is skipped — they
 * already get inline feedback for their own action.
 */

const logger = require('../utils/logger');

/** @type {Set<{ res: import('express').Response, userId: string, role: string }>} */
const clients = new Set();

/**
 * Register a connected SSE client.
 * @param {import('express').Response} res
 * @param {{ id: string, role: string }} user
 * @returns {Object} the client handle (pass to removeClient)
 */
function addClient(res, user) {
  const client = { res, userId: user.id, role: user.role };
  clients.add(client);
  logger.debug('SSE client connected', { userId: user.id, role: user.role, total: clients.size });
  return client;
}

/**
 * Remove a client (on disconnect).
 * @param {Object} client
 */
function removeClient(client) {
  clients.delete(client);
}

/**
 * Broadcast an event to matching clients.
 * @param {Object} event
 * @param {string} event.type - machine type, e.g. 'call.created'
 * @param {string} [event.title]
 * @param {string} [event.body]
 * @param {string} [event.notifType] - success|error|warn|info
 * @param {string[]} [event.roles] - roles that should receive it
 * @param {string[]} [event.userIds] - specific users that should receive it
 * @param {string} [event.exceptUserId] - the actor, who is skipped
 * @returns {number} how many clients received it
 */
function emit(event) {
  const data = `data: ${JSON.stringify({
    type: event.type,
    title: event.title || '',
    body: event.body || '',
    notifType: event.notifType || 'info',
    ts: Date.now(),
  })}\n\n`;

  const roles = event.roles || null;
  const userIds = event.userIds || null;
  let sent = 0;

  for (const c of clients) {
    if (event.exceptUserId && c.userId === event.exceptUserId) continue;
    const match = (!roles && !userIds) || (roles && roles.includes(c.role)) || (userIds && userIds.includes(c.userId));
    if (!match) continue;
    try {
      c.res.write(data);
      sent += 1;
    } catch (e) {
      clients.delete(c);
    }
  }
  return sent;
}

/** @returns {number} number of connected clients */
function clientCount() {
  return clients.size;
}

module.exports = { addClient, removeClient, emit, clientCount };
