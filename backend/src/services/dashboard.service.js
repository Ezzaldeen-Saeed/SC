/**
 * @module services/dashboard.service
 * @description Business logic for dashboard statistics.
 * Uses efficient count-only queries (head: true) and caching
 * to minimize database load for frequently-accessed stats.
 */

const usersRepository = require('../repositories/users.repository');
const callsRepository = require('../repositories/calls.repository');
const customersRepository = require('../repositories/customers.repository');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const { CACHE_KEYS, CACHE_TTL } = require('../utils/constants');

/**
 * Build the entire admin dashboard payload in a single shot.
 *
 * The dashboard previously issued ~5 sequential HTTP requests (stats, users,
 * calls, customers — some twice). This collapses them into ONE response whose
 * three underlying table reads run in parallel server-side (close to the DB),
 * with statistics derived in-memory (no extra COUNT round-trips). A short cache
 * makes repeat loads and the live auto-refresh effectively instant.
 *
 * @returns {Promise<{ stats: Object, users: Object[], calls: Object[], customers: Object[] }>}
 */
async function getAdminOverview() {
  const cached = cache.get(CACHE_KEYS.ADMIN_OVERVIEW);
  if (cached) {
    logger.debug('DashboardService.getAdminOverview cache hit');
    return cached;
  }

  const [users, calls, customers] = await Promise.all([
    usersRepository.findAll(),
    callsRepository.findAllWithRelations(),
    customersRepository.findAll(),
  ]);

  const stats = {
    users: users.length,
    calls: calls.length,
    active_users: users.filter((u) => u.is_active).length,
    customers: customers.length,
  };

  const overview = { stats, users, calls, customers };
  cache.set(CACHE_KEYS.ADMIN_OVERVIEW, overview, CACHE_TTL.REALTIME);

  logger.debug('DashboardService.getAdminOverview computed', stats);
  return overview;
}

/**
 * Get aggregated statistics for the admin dashboard.
 * Returns cached data when available (TTL: 30 seconds).
 *
 * Response shape (backward compatible):
 * { users: number, calls: number, active_users: number }
 *
 * @returns {Promise<Object>} Admin dashboard stats
 */
async function getAdminStats() {
  // Step 1: Check cache
  const cached = cache.get(CACHE_KEYS.ADMIN_STATS);
  if (cached) {
    logger.debug('DashboardService.getAdminStats cache hit');
    return cached;
  }

  // Step 2: Run parallel count queries for efficiency
  const [usersCount, callsCount, activeUsersCount] = await Promise.all([
    usersRepository.countAll(),
    callsRepository.countAll(),
    usersRepository.countByFilter({ is_active: true }),
  ]);

  const stats = {
    users: usersCount,
    calls: callsCount,
    active_users: activeUsersCount,
  };

  // Step 3: Cache the result
  cache.set(CACHE_KEYS.ADMIN_STATS, stats, CACHE_TTL.SHORT);

  logger.debug('DashboardService.getAdminStats computed', stats);
  return stats;
}

/**
 * Get aggregated statistics for a manager's dashboard.
 * Returns cached data when available (TTL: 30 seconds).
 * Scoped to the manager's supervisors and their data.
 *
 * Response shape (backward compatible):
 * { supervisorsCount: number, callsCount: number, customersCount: number }
 *
 * @param {string} managerId - UUID of the manager
 * @returns {Promise<Object>} Manager dashboard stats
 */
async function getManagerStats(managerId) {
  // Step 1: Check cache
  const cacheKey = CACHE_KEYS.MANAGER_STATS + managerId;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug('DashboardService.getManagerStats cache hit', { managerId });
    return cached;
  }

  // Step 2: Supervisors under this manager → agents under those supervisors
  const supervisors = await usersRepository.findByManagerId(managerId, 'supervisor');
  const supervisorIds = supervisors.map((s) => s.user_id);
  const supervisorsCount = supervisorIds.length;

  const agents = supervisorIds.length
    ? await usersRepository.findByManagerIds(supervisorIds, 'agent')
    : [];
  const agentIds = agents.map((a) => a.user_id);

  // Step 3: Count the unit's calls (made by its agents)
  const callsCount = agentIds.length ? await callsRepository.countByUserIds(agentIds) : 0;

  const stats = {
    supervisorsCount,
    agentsCount: agents.length,
    callsCount,
  };

  // Step 5: Cache the result
  cache.set(cacheKey, stats, CACHE_TTL.SHORT);

  logger.debug('DashboardService.getManagerStats computed', { managerId, stats });
  return stats;
}

/**
 * Per-supervisor KPIs for a manager's dashboard (leaderboard):
 * for each supervisor under the manager → #agents, #calls, avg performance score.
 * Sorted by avgScore desc (ranking).
 * @param {string} managerId
 * @returns {Promise<Array<{supervisor:object, agentsCount:number, callsCount:number, avgScore:number|null}>>}
 */
async function getSupervisorKpis(managerId) {
  const supervisors = await usersRepository.findByManagerId(managerId, 'supervisor');
  if (!supervisors.length) return [];

  const supIds = supervisors.map((s) => s.user_id);
  const agents = await usersRepository.findByManagerIds(supIds, 'agent');
  const agentIds = agents.map((a) => a.user_id);
  const calls = agentIds.length ? await callsRepository.findByUserIdsWithRelations(agentIds) : [];

  // agent → his supervisor (manager_id)
  const agentToSup = {};
  agents.forEach((a) => { agentToSup[a.user_id] = a.parent_id; });

  const bySup = {};
  supervisors.forEach((s) => {
    bySup[s.user_id] = {
      supervisor: { user_id: s.user_id, full_name: s.full_name, email: s.email, is_active: s.is_active },
      agentsCount: 0, callsCount: 0, scoreSum: 0, scoreCount: 0,
    };
  });
  agents.forEach((a) => { if (bySup[a.parent_id]) bySup[a.parent_id].agentsCount++; });
  calls.forEach((c) => {
    const sup = agentToSup[c.user_id];
    if (!sup || !bySup[sup]) return;
    bySup[sup].callsCount++;
    const ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    if (ps && ps.total_score != null) { bySup[sup].scoreSum += Number(ps.total_score); bySup[sup].scoreCount++; }
  });

  return Object.values(bySup)
    .map((x) => ({
      supervisor: x.supervisor,
      agentsCount: x.agentsCount,
      callsCount: x.callsCount,
      avgScore: x.scoreCount ? Math.round(x.scoreSum / x.scoreCount) : null,
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/**
 * Per-agent KPIs for a supervisor: for each agent → #calls + avg performance score.
 * Sorted by avgScore desc.
 * @param {string} supervisorId
 * @returns {Promise<Array<{user_id, full_name, email, role, is_active, callsCount, avgScore}>>}
 */
async function getAgentKpis(supervisorId) {
  const agents = await usersRepository.findByManagerId(supervisorId, 'agent');
  if (!agents.length) return [];

  const agentIds = agents.map((a) => a.user_id);
  const calls = await callsRepository.findByUserIdsWithRelations(agentIds);

  const byAgent = {};
  agents.forEach((a) => {
    byAgent[a.user_id] = {
      user_id: a.user_id, full_name: a.full_name, email: a.email, role: 'agent', is_active: a.is_active,
      callsCount: 0, scoreSum: 0, scoreCount: 0,
    };
  });
  calls.forEach((c) => {
    const b = byAgent[c.user_id];
    if (!b) return;
    b.callsCount++;
    const ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    if (ps && ps.total_score != null) { b.scoreSum += Number(ps.total_score); b.scoreCount++; }
  });

  return Object.values(byAgent)
    .map((x) => ({
      user_id: x.user_id, full_name: x.full_name, email: x.email, role: 'agent', is_active: x.is_active,
      callsCount: x.callsCount, avgScore: x.scoreCount ? Math.round(x.scoreSum / x.scoreCount) : null,
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/**
 * Aggregate rating summary across a set of agents (true average over their scored calls).
 * @param {Array<string>} agentIds
 * @returns {Promise<{membersCount:number, callsCount:number, avgScore:number|null}>}
 */
async function unitSummary(agentIds) {
  if (!agentIds || !agentIds.length) return { membersCount: 0, callsCount: 0, avgScore: null };
  const calls = await callsRepository.findByUserIdsWithRelations(agentIds);
  let scoreSum = 0, scoreCount = 0;
  calls.forEach((c) => {
    const ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    if (ps && ps.total_score != null) { scoreSum += Number(ps.total_score); scoreCount++; }
  });
  return { membersCount: agentIds.length, callsCount: calls.length, avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null };
}

/**
 * Team ratings for a manager or supervisor profile:
 *   • manager    → each supervisor's rating (+ their agent count) + whole-unit summary
 *   • supervisor → each agent's rating + summary
 * The leader's own "rating" is the unit average (leaders don't take calls themselves).
 * @param {{ user_id: string, role: string }} user
 * @returns {Promise<{ role:string, members:object[], summary:object } | null>}
 */
async function getTeamRatings(user) {
  if (user.role === 'manager') {
    const kpis = await getSupervisorKpis(user.user_id);
    const members = kpis.map((m) => ({
      user_id: m.supervisor.user_id, full_name: m.supervisor.full_name, email: m.supervisor.email,
      role: 'supervisor', is_active: m.supervisor.is_active,
      agentsCount: m.agentsCount, callsCount: m.callsCount, avgScore: m.avgScore,
    }));
    const supervisors = await usersRepository.findByManagerId(user.user_id, 'supervisor');
    const agents = supervisors.length
      ? await usersRepository.findByManagerIds(supervisors.map((s) => s.user_id), 'agent')
      : [];
    const summary = await unitSummary(agents.map((a) => a.user_id));
    return { role: 'manager', members, summary };
  }
  if (user.role === 'supervisor') {
    const members = await getAgentKpis(user.user_id);
    const summary = await unitSummary(members.map((m) => m.user_id));
    return { role: 'supervisor', members, summary };
  }
  return null;
}

module.exports = {
  getAdminOverview,
  getAdminStats,
  getManagerStats,
  getSupervisorKpis,
  getAgentKpis,
  getTeamRatings,
};
