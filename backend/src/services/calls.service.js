/**
 * @module services/calls.service
 * @description Business logic for call management.
 * Delegates data access to the calls repository.
 */

const callsRepository = require('../repositories/calls.repository');
const performanceRepository = require('../repositories/performance_scores.repository');
const transcriptsRepository = require('../repositories/transcripts.repository');
const suggestionsRepository = require('../repositories/suggestions.repository');
const customersService = require('./customers.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Format a Date as a "HH:MM:SS" clock string (UTC) for the transcripts.timestamp
 * column (Postgres `time without time zone`).
 * @param {Date} d
 * @returns {string}
 */
function toClockTime(d) {
  return d.toISOString().substring(11, 19);
}

/**
 * Normalize client transcript lines into transcript rows.
 * Accepts `{ speaker, text, ts?, summary? }`; derives a per-line clock time
 * from `ts` (ISO) when present, else spreads one second per line from the
 * call start. Lines without text are dropped (text is NOT NULL).
 * @param {Array<Object>} lines
 * @param {string|Date} callStart
 * @returns {Array<{speaker: string, text: string, timestamp: string, summary: string|null}>}
 */
function normalizeTranscript(lines, callStart) {
  if (!Array.isArray(lines)) return [];
  const baseMs = callStart ? new Date(callStart).getTime() : Date.now();

  return lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l, i) => {
      const when = l.ts ? new Date(l.ts) : new Date(baseMs + i * 1000);
      const time = isNaN(when) ? toClockTime(new Date(baseMs + i * 1000)) : toClockTime(when);
      return {
        speaker: (l.speaker && String(l.speaker).trim()) || 'غير معروف',
        text: l.text.trim(),
        timestamp: time,
        summary: l.summary || null,
      };
    });
}

/**
 * Retrieve all calls with joined user and customer data.
 * Returns the full dataset ordered by call_start descending.
 *
 * @returns {Promise<Array<Object>>} Array of call objects with nested users/customers data
 */
async function getAllCalls() {
  return callsRepository.findAllWithRelations();
}

/**
 * Retrieve calls for specific user IDs with joined user and customer data.
 * Returns an empty array immediately if no user IDs are provided.
 *
 * @param {Array<string>} userIds - Array of user UUIDs to filter by
 * @returns {Promise<Array<Object>>} Array of call objects with nested users/customers data
 */
async function getCallsByUserIds(userIds) {
  if (!userIds || userIds.length === 0) {
    return [];
  }

  return callsRepository.findByUserIdsWithRelations(userIds);
}

/**
 * Retrieve the calls owned by a single user (the agent's own history).
 *
 * @param {string} userId - The owning user's UUID
 * @returns {Promise<Array<Object>>} Array of call objects with nested relations
 */
async function getCallsForUser(userId) {
  return callsRepository.findByUserId(userId);
}

/**
 * Resolve a call's duration in seconds.
 * Prefers the authoritative start/end timestamps; falls back to parsing the
 * Postgres `interval` column ("HH:MM:SS" or "N seconds") when end is missing.
 *
 * @param {Object} call - A raw call row
 * @returns {number|null} Duration in whole seconds, or null if unknown
 */
function resolveDurationSec(call) {
  if (call.call_start && call.call_end) {
    const secs = Math.round((new Date(call.call_end) - new Date(call.call_start)) / 1000);
    return secs >= 0 ? secs : null;
  }
  if (typeof call.duration === 'string') {
    const hms = call.duration.match(/(\d+):(\d{2}):(\d{2})/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const secs = call.duration.match(/(\d+)\s*sec/);
    if (secs) return Number(secs[1]);
  }
  return null;
}

/**
 * Build a per-user call report: the user's calls in a flat, render-ready shape
 * plus aggregate KPIs (total calls, average duration, average performance score).
 * Used by the admin user-profile view so the numbers are computed server-side
 * from the real schema rather than guessed on the client.
 *
 * @param {string} userId - The user (agent) whose calls to report on
 * @returns {Promise<{ calls: Array<Object>, stats: Object }>}
 */
async function getUserCallReport(userId) {
  const raw = await callsRepository.findByUserId(userId);

  const calls = raw.map((c) => {
    const ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    return {
      call_id: c.call_id,
      call_start: c.call_start,
      call_end: c.call_end,
      duration_sec: resolveDurationSec(c),
      call_type: c.call_type,
      issues_category: c.issues_category,
      sentiment: c.sentiment,
      summary: c.summary,
      total_score: ps && ps.total_score != null ? ps.total_score : null,
      customer_name: c.customers ? c.customers.name : null,
      customer_phone: c.customers ? c.customers.phone_number : null,
    };
  });

  const durations = calls.map((c) => c.duration_sec).filter((v) => v != null);
  const scores = calls.map((c) => c.total_score).filter((v) => v != null);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const stats = {
    totalCalls: calls.length,
    avgDurationSec: durations.length ? Math.round(sum(durations) / durations.length) : 0,
    avgScore: scores.length ? Math.round(sum(scores) / scores.length) : null,
    scoredCalls: scores.length,
  };

  return { calls, stats };
}

/**
 * Create a call record on behalf of an agent.
 * The agent's `user_id` is taken from the authenticated session (never the client),
 * and `duration` is left to the database (a GENERATED column from start/end).
 *
 * @param {string} userId - The authenticated agent's UUID (owner of the call)
 * @param {Object} payload - Validated call fields from the request body
 * @returns {Promise<Object>} The created call with nested relations
 */
async function createCall(userId, payload) {
  // العميل مطلوب: يُؤخذ من إدخال الموظف (اسم + رقم) أو من customer_id مختار.
  //    "بيانات العميل لا يمكن أن توجد بدون عميل" — لا تُحفظ مكالمة بلا عميل.
  let customerId = payload.customer_id || null;
  if (!customerId) {
    const pc = payload.customer || {};
    const name = (pc.name || '').toString().trim();
    const phone = (pc.phone_number || '').toString().trim();
    if (!name || !phone) {
      throw ApiError.badRequest('بيانات العميل (الاسم ورقم الهاتف) مطلوبة لحفظ المكالمة');
    }
    const customer = await customersService.findOrCreateByPhone({ name, phone_number: phone, email: pc.email });
    customerId = customer.customer_id;
  }

  // التفريغ يُحفظ كما هو (خام) كما أرسله الموظف.
  const transcriptInput = Array.isArray(payload.transcripts) ? payload.transcripts : [];

  // duration عمود INTERVAL — نحسبه من البداية/النهاية ونرسله كنص يحوّله Postgres
  let duration = null;
  if (payload.call_start && payload.call_end) {
    const secs = Math.max(0, Math.round((new Date(payload.call_end) - new Date(payload.call_start)) / 1000));
    duration = `${secs} seconds`;
  }

  // الأعمدة تطابق سكيمة calls الحقيقية تماماً (لا أعمدة زائدة).
  const row = {
    user_id: userId,
    customer_id: customerId,
    call_start: payload.call_start,
    call_end: payload.call_end || null,
    duration,
    call_type: payload.call_type || null,
    issues_category: payload.issues_category || null,
    recording_path: payload.recording_path || null,
    sentiment: payload.sentiment || null,
    summary: payload.summary || null,
    analysis: payload.analysis || null,
  };

  const call = await callsRepository.insertCall(row);

  // تفريغ المكالمة (transcripts) — يُحفظ مع المكالمة. غير حاسم: لو فشل تظل المكالمة محفوظة.
  const transcriptRows = normalizeTranscript(transcriptInput, payload.call_start);
  if (transcriptRows.length) {
    try {
      await transcriptsRepository.insertManyForCall(call.call_id, transcriptRows);
    } catch (e) {
      logger.warn('createCall: saved call but failed to save transcript', { callId: call.call_id, error: e.message });
    }
  }

  // تقييم الأداء (من تقرير الـ AI) — يُخزّن في performance_scores. غير حاسم:
  // لو فشل، المكالمة تظل محفوظة.
  if (payload.scores && Object.keys(payload.scores).length > 0) {
    try {
      await performanceRepository.insertForCall(call.call_id, payload.scores);
    } catch (e) {
      logger.warn('createCall: saved call but failed to save scores', { callId: call.call_id, error: e.message });
    }
  }

  // اقتراحات المدرّب اللحظي (live coaching) — تُحفظ في suggestions مع المكالمة،
  // فتُخزَّن المكالمة *كاملة* لا جزئياً. غير حاسم: لو فشل تظل المكالمة محفوظة.
  if (Array.isArray(payload.suggestions) && payload.suggestions.length) {
    try {
      await suggestionsRepository.insertManyForCall(call.call_id, payload.suggestions);
    } catch (e) {
      logger.warn('createCall: saved call but failed to save suggestions', { callId: call.call_id, error: e.message });
    }
  }

  return call;
}

/**
 * Full detail for a single call: the call row with agent, customer and scores,
 * plus its complete transcript. Powers the admin call-detail view and PDF.
 *
 * @param {string} callId - The call's UUID
 * @returns {Promise<Object>} { ...call, users, customers, performance_scores, transcripts }
 * @throws {ApiError} NotFound if the call does not exist
 */
async function getCallDetail(callId) {
  const call = await callsRepository.findByIdWithRelations(callId);
  if (!call) {
    throw ApiError.notFound('Call not found');
  }
  const transcripts = await transcriptsRepository.findByCallId(callId);
  const suggestions = await suggestionsRepository.findByCallId(callId).catch(() => []);
  return { ...call, transcripts, suggestions };
}

/**
 * Full detail for a single call, scoped to a set of visible agents.
 * Used by the manager/supervisor call-detail views so a user can only open
 * calls belonging to agents within their own unit. Returns the same shape as
 * {@link getCallDetail} and raises NotFound (not Forbidden) for out-of-scope
 * calls, so the existence of other units' calls is never disclosed.
 *
 * @param {string} callId - The call's UUID
 * @param {Array<string>} agentIds - UUIDs of agents the caller may view
 * @returns {Promise<Object>} { ...call, users, customers, performance_scores, transcripts }
 * @throws {ApiError} NotFound if the call does not exist or is out of scope
 */
async function getScopedCallDetail(callId, agentIds) {
  const call = await getCallDetail(callId);
  if (!agentIds || agentIds.indexOf(call.user_id) === -1) {
    throw ApiError.notFound('Call not found');
  }
  return call;
}

/**
 * Update a call's editable fields, scoped to its owner.
 * Only customer_id / call_type / issues_category may be changed by the agent.
 *
 * @param {string} userId - The authenticated agent's UUID (must own the call)
 * @param {string} callId - The public call UUID (call_id)
 * @param {Object} fields - Validated fields to update
 * @returns {Promise<Object>} The updated call with nested relations
 * @throws {ApiError} If the call does not exist or is not owned by the user
 */
async function updateCall(userId, callId, fields) {
  const clean = {};
  if ('customer_id' in fields) clean.customer_id = fields.customer_id || null;
  if ('call_type' in fields) clean.call_type = fields.call_type || null;
  if ('issues_category' in fields) clean.issues_category = fields.issues_category || null;

  const updated = await callsRepository.updateByCallIdForUser(callId, userId, clean);
  if (!updated) {
    throw ApiError.notFound('Call not found');
  }
  return updated;
}

module.exports = {
  getAllCalls,
  getCallsByUserIds,
  getCallsForUser,
  getUserCallReport,
  getCallDetail,
  getScopedCallDetail,
  createCall,
  updateCall,
};
