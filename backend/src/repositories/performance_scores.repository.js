/**
 * @module repositories/performance_scores.repository
 * @description Data access for the performance_scores table (per-call evaluation).
 * All operations use supabaseAdmin (service role).
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Insert an evaluation row for a call.
 * @param {string} callId - The call's UUID (call_id)
 * @param {Object} scores - { script_compliance, empathy_score, resolution_score, total_score } (0..100)
 * @returns {Promise<Object>} The created performance_scores row
 * @throws {ApiError} On database error
 */
async function insertForCall(callId, scores) {
  const { data, error } = await supabaseAdmin
    .from('performance_scores')
    .insert({ call_id: callId, ...scores })
    .select('*')
    .single();

  if (error) {
    logger.error('PerformanceScoresRepository.insertForCall failed', { callId, error: error.message });
    throw ApiError.internal('Failed to save performance scores');
  }

  return data;
}

module.exports = { insertForCall };
