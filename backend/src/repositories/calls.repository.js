/**
 * @module repositories/calls.repository
 * @description Data access layer for the calls table.
 * All operations use supabaseAdmin (service role) for full access.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * The select string for call queries that join related user and customer data.
 * Matches the exact shape expected by admin/manager dashboard endpoints.
 * @constant {string}
 */
const CALLS_WITH_RELATIONS_SELECT =
  '*, users(full_name, role), customers(name, phone_number), ' +
  'performance_scores(script_compliance, empathy_score, resolution_score, total_score)';

/**
 * Expanded select for a single call's detail view (and PDF): includes the
 * agent's and customer's identifying fields and the full score breakdown.
 * @constant {string}
 */
const CALL_DETAIL_SELECT =
  '*, users(user_id, full_name, role, email), customers(customer_id, name, phone_number, email), ' +
  'performance_scores(script_compliance, empathy_score, resolution_score, total_score, customer_satisfaction_score)';

/**
 * Retrieve a single call by id with agent, customer and score relations.
 * @param {string} callId - The call's UUID (call_id)
 * @returns {Promise<Object|null>} The call with relations, or null if not found
 * @throws {ApiError} On database error
 */
async function findByIdWithRelations(callId) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(CALL_DETAIL_SELECT)
    .eq('call_id', callId)
    .maybeSingle();

  if (error) {
    logger.error('CallsRepository.findByIdWithRelations failed', { callId, error: error.message });
    throw ApiError.internal('Failed to fetch call');
  }

  return data;
}

/**
 * Retrieve all calls with joined user and customer data, ordered by call_start descending.
 * @returns {Promise<Array<Object>>} Array of call objects with nested users/customers data
 * @throws {ApiError} On database error
 */
async function findAllWithRelations() {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(CALLS_WITH_RELATIONS_SELECT)
    .order('call_start', { ascending: false });

  if (error) {
    logger.error('CallsRepository.findAllWithRelations failed', { error: error.message });
    throw ApiError.internal('Failed to fetch calls');
  }

  return data;
}

/**
 * Retrieve calls for specific user IDs with joined user and customer data.
 * Used by the manager dashboard to fetch calls belonging to their supervisors.
 * @param {Array<string>} userIds - Array of user UUIDs to filter by
 * @returns {Promise<Array<Object>>} Array of call objects with nested users/customers data
 * @throws {ApiError} On database error
 */
async function findByUserIdsWithRelations(userIds) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(CALLS_WITH_RELATIONS_SELECT)
    .in('user_id', userIds)
    .order('call_start', { ascending: false });

  if (error) {
    logger.error('CallsRepository.findByUserIdsWithRelations failed', { userIds, error: error.message });
    throw ApiError.internal('Failed to fetch calls by user IDs');
  }

  return data;
}

/**
 * Retrieve calls owned by a single user, with joined customer data.
 * Used by the agent dashboard to show the agent's own call history.
 * @param {string} userId - The owning user's UUID
 * @returns {Promise<Array<Object>>} Array of call objects ordered by call_start desc
 * @throws {ApiError} On database error
 */
async function findByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(CALLS_WITH_RELATIONS_SELECT)
    .eq('user_id', userId)
    .order('call_start', { ascending: false });

  if (error) {
    logger.error('CallsRepository.findByUserId failed', { userId, error: error.message });
    throw ApiError.internal('Failed to fetch user calls');
  }

  return data;
}

/**
 * Retrieve all calls for a single customer, with joined agent/customer/score data,
 * most recent first. Powers the agent console's "customer context" panel — the
 * caller's history across the team so the agent has context before speaking.
 * @param {string} customerId - The customer's UUID
 * @returns {Promise<Array<Object>>} Array of call objects ordered by call_start desc
 * @throws {ApiError} On database error
 */
async function findByCustomerId(customerId) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(CALLS_WITH_RELATIONS_SELECT)
    .eq('customer_id', customerId)
    .order('call_start', { ascending: false });

  if (error) {
    logger.error('CallsRepository.findByCustomerId failed', { customerId, error: error.message });
    throw ApiError.internal('Failed to fetch customer calls');
  }

  return data;
}

/**
 * Insert a new call row and return it with joined relations.
 * @param {Object} callData - Column/value pairs for the new call row
 * @returns {Promise<Object>} The created call with nested users/customers data
 * @throws {ApiError} On database error
 */
async function insertCall(callData) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .insert(callData)
    .select(CALLS_WITH_RELATIONS_SELECT)
    .single();

  if (error) {
    logger.error('CallsRepository.insertCall failed', { error: error.message });
    throw ApiError.internal('Failed to create call');
  }

  return data;
}

/**
 * Update a call by its public call_id, scoped to its owner (ownership guard).
 * @param {string} callId - The public call UUID (call_id)
 * @param {string} userId - The owning user's UUID — only their own call is updated
 * @param {Object} fields - Column/value pairs to update
 * @returns {Promise<Object|null>} The updated call, or null if not found/owned
 * @throws {ApiError} On database error
 */
async function updateByCallIdForUser(callId, userId, fields) {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .update(fields)
    .eq('call_id', callId)
    .eq('user_id', userId)
    .select(CALLS_WITH_RELATIONS_SELECT)
    .maybeSingle();

  if (error) {
    logger.error('CallsRepository.updateByCallIdForUser failed', { callId, userId, error: error.message });
    throw ApiError.internal('Failed to update call');
  }

  return data;
}

/**
 * Count all calls in the calls table using an efficient head-only query.
 * @returns {Promise<number>} Total call count
 * @throws {ApiError} On database error
 */
async function countAll() {
  const { count, error } = await supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact', head: true });

  if (error) {
    logger.error('CallsRepository.countAll failed', { error: error.message });
    throw ApiError.internal('Failed to count calls');
  }

  return count;
}

/**
 * Count calls for specific user IDs using an efficient head-only query.
 * @param {Array<string>} userIds - Array of user UUIDs to filter by
 * @returns {Promise<number>} Filtered call count
 * @throws {ApiError} On database error
 */
async function countByUserIds(userIds) {
  const { count, error } = await supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .in('user_id', userIds);

  if (error) {
    logger.error('CallsRepository.countByUserIds failed', { userIds, error: error.message });
    throw ApiError.internal('Failed to count calls by user IDs');
  }

  return count;
}

module.exports = {
  findAllWithRelations,
  findByIdWithRelations,
  findByUserIdsWithRelations,
  findByUserId,
  findByCustomerId,
  insertCall,
  updateByCallIdForUser,
  countAll,
  countByUserIds,
};
