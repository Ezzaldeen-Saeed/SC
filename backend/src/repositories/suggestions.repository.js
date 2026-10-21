/**
 * @module repositories/suggestions.repository
 * @description Data access for the suggestions table (live-coaching tips shown
 * to the agent during a call, persisted with it). Uses supabaseAdmin.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Bulk-insert the coaching suggestions captured during a call.
 * @param {string} callId - The call's UUID (call_id)
 * @param {Array<{suggest_text: string, agent_action?: string, priority?: string, problem_type?: string, suggestion_type?: string}>} items
 * @returns {Promise<number>} The number of suggestions inserted
 * @throws {ApiError} On database error
 */
async function insertManyForCall(callId, items) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const clean = (v) => (v && String(v).trim()) || null;
  const rows = items
    .filter((s) => s && typeof s.suggest_text === 'string' && s.suggest_text.trim())
    .map((s) => ({
      call_id: callId,
      suggest_text: s.suggest_text.trim(),
      agent_action: clean(s.agent_action),
      priority: ['low', 'medium', 'high'].includes(s.priority) ? s.priority : 'medium',
      problem_type: clean(s.problem_type),
      suggestion_type: clean(s.suggestion_type),
    }));

  if (!rows.length) return 0;

  const { error } = await supabaseAdmin.from('suggestions').insert(rows);

  if (error) {
    logger.error('SuggestionsRepository.insertManyForCall failed', { callId, error: error.message });
    throw ApiError.internal('Failed to save suggestions');
  }

  return rows.length;
}

/**
 * Fetch all suggestions for a call (chronological).
 * @param {string} callId
 * @returns {Promise<Array<Object>>}
 */
async function findByCallId(callId) {
  const { data, error } = await supabaseAdmin
    .from('suggestions')
    .select('*')
    .eq('call_id', callId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('SuggestionsRepository.findByCallId failed', { callId, error: error.message });
    throw ApiError.internal('Failed to fetch suggestions');
  }

  return data;
}

module.exports = {
  insertManyForCall,
  findByCallId,
};
