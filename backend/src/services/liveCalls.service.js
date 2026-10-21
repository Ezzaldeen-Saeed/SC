/**
 * @module services/liveCalls.service
 * @description In-memory registry of in-progress ("live") calls, keyed by the
 * agent's userId. The live agent console signals start/heartbeat/end; dashboards
 * read a role-scoped snapshot (via the live controller) and are pushed updates
 * over SSE so the "live calls" counter stays correct in real time.
 *
 * Entries self-expire if an agent stops sending heartbeats (crash / closed tab),
 * so the count never gets stuck. There is at most one live call per agent.
 */

const events = require('./events.service');
const logger = require('../utils/logger');

const TTL_MS = 75 * 1000;    // drop an entry with no heartbeat within this window
const SWEEP_MS = 20 * 1000;  // how often to prune expired entries

/** @type {Map<string, { user_id:string, full_name:string, customer_name:string|null, started_at:number, last_seen:number }>} */
const live = new Map();

function snapshot(e) {
  return {
    user_id: e.user_id,
    full_name: e.full_name,
    customer_name: e.customer_name || null,
    started_at: new Date(e.started_at).toISOString(),
    duration_sec: Math.max(0, Math.round((Date.now() - e.started_at) / 1000)),
  };
}

/** Tell every admin/manager/supervisor dashboard to re-fetch its scoped list. */
function broadcast() {
  // No title → no toast; dashboards react to the 'live.update' type and refetch.
  events.emit({ type: 'live.update', roles: ['admin', 'manager', 'supervisor'] });
}

/** Register (or refresh) the agent's live call. Broadcasts only on a NEW call. */
function start(user, data = {}) {
  const id = user.id;
  const existing = live.get(id);
  live.set(id, {
    user_id: id,
    full_name: user.fullName || (existing && existing.full_name) || 'الموظف',
    customer_name: data.customer_name || (existing && existing.customer_name) || null,
    started_at: existing ? existing.started_at : Date.now(),
    last_seen: Date.now(),
  });
  if (!existing) { logger.debug('liveCalls.start', { id, total: live.size }); broadcast(); }
  return snapshot(live.get(id));
}

/** Keep an existing live call alive; falls back to start() if none registered. */
function heartbeat(user, data = {}) {
  const e = live.get(user.id);
  if (!e) return start(user, data);
  e.last_seen = Date.now();
  if (data.customer_name) e.customer_name = data.customer_name;
  return snapshot(e);
}

/** End the agent's live call. Broadcasts if anything was removed. */
function end(user) {
  if (live.delete(user.id)) { logger.debug('liveCalls.end', { id: user.id, total: live.size }); broadcast(); }
}

/**
 * Snapshot of live calls, optionally filtered to a set of agent ids.
 * @param {string[]|null} agentIds - null = all (admin)
 */
function list(agentIds) {
  const out = [];
  for (const e of live.values()) {
    if (agentIds && !agentIds.includes(e.user_id)) continue;
    out.push(snapshot(e));
  }
  return out.sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
}

// Prune dead entries (agent crashed / closed tab without sending end).
const sweeper = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, e] of live) {
    if (now - e.last_seen > TTL_MS) { live.delete(id); changed = true; }
  }
  if (changed) { logger.debug('liveCalls.sweep pruned', { total: live.size }); broadcast(); }
}, SWEEP_MS);
if (sweeper.unref) sweeper.unref();

module.exports = { start, heartbeat, end, list };
