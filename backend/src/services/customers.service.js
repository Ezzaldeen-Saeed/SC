/**
 * @module services/customers.service
 * @description Business logic for customer management.
 * Delegates data access to the customers repository.
 */

const customersRepository = require('../repositories/customers.repository');
const callsRepository = require('../repositories/calls.repository');

/**
 * Retrieve all customers.
 *
 * @returns {Promise<Array<Object>>} Array of customer objects
 */
async function getAllCustomers() {
  return customersRepository.findAll();
}

/**
 * Customers scoped to a set of agents, each enriched with the handling
 * employee(s) — derived through the calls table (no owner column needed).
 *   • agentIds = null  → ALL customers (admin view)
 *   • agentIds = [...]  → only customers reached in those agents' calls
 * Each result gets: handling_agent (most-recent agent), agents (all who spoke
 * to them), call_count, last_call_at.
 *
 * @param {Array<string>|null} agentIds
 * @returns {Promise<Array<Object>>}
 */
async function getScopedCustomers(agentIds) {
  let customers;
  let calls;
  if (!agentIds) {
    [customers, calls] = await Promise.all([
      customersRepository.findAll(),
      callsRepository.findAllWithRelations(),
    ]);
  } else {
    if (!agentIds.length) return [];
    calls = await callsRepository.findByUserIdsWithRelations(agentIds);
    const ids = [...new Set(calls.map((c) => c.customer_id).filter(Boolean))];
    customers = await customersRepository.findByIds(ids);
  }

  // Build customer_id → handling-agent info from the calls.
  const info = {};
  calls.forEach((c) => {
    if (!c.customer_id) return;
    const e = info[c.customer_id] || (info[c.customer_id] = { agents: {}, callCount: 0, lastAgent: null, lastCallAt: null, _t: 0 });
    e.callCount++;
    const name = c.users ? c.users.full_name : null;
    if (name) e.agents[name] = (e.agents[name] || 0) + 1;
    const t = c.call_start ? new Date(c.call_start).getTime() : 0;
    if (t >= e._t) { e._t = t; e.lastAgent = name; e.lastCallAt = c.call_start; }
  });

  return customers.map((c) => {
    const e = info[c.customer_id] || { agents: {}, callCount: 0, lastAgent: null, lastCallAt: null };
    return {
      ...c,
      handling_agent: e.lastAgent,
      agents: Object.keys(e.agents),
      call_count: e.callCount,
      last_call_at: e.lastCallAt,
    };
  });
}

/**
 * Retrieve the customers handled by a set of users (agents).
 * The customers table has no owner column, so the relationship is derived
 * through the calls table: the customers that appear in those users' calls.
 *
 * @param {Array<string>} userIds - Array of user (agent) UUIDs
 * @returns {Promise<Array<Object>>} Array of customer objects
 */
async function getCustomersByUserIds(userIds) {
  if (!userIds || userIds.length === 0) {
    return [];
  }

  const calls = await callsRepository.findByUserIdsWithRelations(userIds);
  const customerIds = [...new Set(calls.map((c) => c.customer_id).filter(Boolean))];

  return customersRepository.findByIds(customerIds);
}

/**
 * Create a customer. The customers table is shared (no user_id column),
 * so only the real columns are written: name, phone_number, email.
 *
 * @param {Object} data - Validated customer fields (name, phone_number, email)
 * @returns {Promise<Object>} The created customer
 */
async function createCustomer(data) {
  const row = {
    name: data.name,
    phone_number: data.phone_number,
    email: data.email || null,
  };

  return customersRepository.insertCustomer(row);
}

/**
 * Build the "customer context" shown in the agent console when a caller's phone
 * is recognised: who they are plus a derived summary of their history so the
 * agent has context before/while speaking. Returns { found:false } for an
 * unknown number so the UI can show a clean "new customer" state.
 *
 * @param {string} phone - The customer's phone number (natural key)
 * @returns {Promise<Object>} { found, customer?, stats?, recentCalls? }
 */
async function getContextByPhone(phone) {
  const clean = (phone || '').trim();
  if (!clean) return { found: false };

  const customer = await customersRepository.findByPhone(clean);
  if (!customer) return { found: false };

  const calls = await callsRepository.findByCustomerId(customer.customer_id);

  const sentimentClass = (s) => {
    const v = (s || '').trim();
    if (['غاضب', 'محبط', 'سلبي', 'negative'].includes(v)) return 'negative';
    if (['سعيد', 'راضي', 'إيجابي', 'positive'].includes(v)) return 'positive';
    return 'neutral';
  };
  const scoreOf = (c) => {
    const ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    return ps && ps.total_score != null ? Number(ps.total_score) : null;
  };

  const total = calls.length;
  const negative = calls.filter((c) => sentimentClass(c.sentiment) === 'negative').length;
  const scores = calls.map(scoreOf).filter((v) => v != null);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const last = calls[0] || null;

  // Recurring issue: the most frequent non-empty issues_category across their calls.
  const issueCounts = {};
  calls.forEach((c) => {
    const k = (c.issues_category || '').trim();
    if (k) issueCounts[k] = (issueCounts[k] || 0) + 1;
  });
  const topIssue = Object.keys(issueCounts).sort((a, b) => issueCounts[b] - issueCounts[a])[0] || null;

  // At-risk: half-or-more of a repeat caller's calls were negative.
  const atRisk = total >= 2 && negative / total >= 0.5;

  const stats = {
    total_calls: total,
    negative_calls: negative,
    avg_score: avgScore,
    last_sentiment: last ? last.sentiment : null,
    last_call_at: last ? last.call_start : null,
    last_summary: last ? last.summary : null,
    top_issue: topIssue,
    at_risk: atRisk,
    is_new: total === 0,
  };

  // A compact, render-ready recent history (no heavy nested blobs).
  const recentCalls = calls.slice(0, 5).map((c) => ({
    call_id: c.call_id,
    call_start: c.call_start,
    call_type: c.call_type,
    issues_category: c.issues_category,
    sentiment: c.sentiment,
    summary: c.summary,
    agent: c.users ? c.users.full_name : null,
    score: scoreOf(c),
  }));

  return { found: true, customer, stats, recentCalls };
}

/**
 * Find an existing customer by phone, or create one. Used when a call is saved
 * with an inline customer (the customer is persisted alongside the call).
 * phone_number is the natural key (UNIQUE), so it's required to resolve.
 *
 * @param {{ name: string, phone_number: string, email?: string }} data
 * @returns {Promise<Object>} The existing or newly-created customer
 */
async function findOrCreateByPhone(data) {
  const phone = (data.phone_number || '').trim();
  if (!phone) {
    return createCustomer(data);
  }

  const existing = await customersRepository.findByPhone(phone);
  if (existing) return existing;

  return createCustomer({ name: data.name, phone_number: phone, email: data.email });
}

module.exports = {
  getAllCustomers,
  getScopedCustomers,
  getCustomersByUserIds,
  getContextByPhone,
  createCustomer,
  findOrCreateByPhone,
};
