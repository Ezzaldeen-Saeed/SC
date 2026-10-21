/**
 * @module repositories/transcripts.repository
 * @description Data access for the transcripts table (per-call conversation lines).
 * All operations use supabaseAdmin (service role).
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Bulk-insert transcript lines for a call.
 * @param {string} callId - The call's UUID (call_id)
 * @param {Array<{speaker: string, text: string, timestamp: string, summary?: string}>} lines
 * @returns {Promise<number>} The number of lines inserted
 * @throws {ApiError} On database error
 */
async function insertManyForCall(callId, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 0;

  const rows = lines.map((l) => ({
    call_id: callId,
    speaker: l.speaker,
    text: l.text,
    timestamp: l.timestamp,
    summary: l.summary || null,
  }));

  const { error } = await supabaseAdmin.from('transcripts').insert(rows);

  if (error) {
    logger.error('TranscriptsRepository.insertManyForCall failed', { callId, error: error.message });
    throw ApiError.internal('Failed to save transcript');
  }

  return rows.length;
}

/**
 * Fetch all transcript lines for a call, ordered chronologically.
 * @param {string} callId - The call's UUID (call_id)
 * @returns {Promise<Array<Object>>} Array of transcript rows
 * @throws {ApiError} On database error
 */
async function findByCallId(callId) {
  const { data, error } = await supabaseAdmin
    .from('transcripts')
    .select('*')
    .eq('call_id', callId)
    .order('timestamp', { ascending: true });

  if (error) {
    logger.error('TranscriptsRepository.findByCallId failed', { callId, error: error.message });
    throw ApiError.internal('Failed to fetch transcript');
  }

  return data;
}

module.exports = {
  insertManyForCall,
  findByCallId,
};
