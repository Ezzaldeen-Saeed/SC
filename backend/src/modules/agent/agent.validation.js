/**
 * @fileoverview Agent module validation schemas (Joi).
 * Covers persisting a finished call and managing the agent's own customers.
 * @module modules/agent/agent.validation
 */

const Joi = require('joi');

/**
 * Allowed call_type values (nature of the call).
 * @type {string[]}
 */
const CALL_TYPES = ['inquiry', 'complaint', 'support', 'sales', 'follow_up', 'other'];

/**
 * Schema for creating a call record from the agent dashboard.
 * `user_id` and `duration` are intentionally NOT accepted from the client:
 *   - user_id comes from the authenticated session.
 *   - duration is a DB-generated column (call_end - call_start).
 * @type {Joi.ObjectSchema}
 */
// تقييم الأداء (0..100) — يُخزّن في performance_scores. مشتق من تقرير الـ AI.
const scoresSchema = Joi.object({
  script_compliance: Joi.number().integer().min(0).max(100),
  empathy_score: Joi.number().integer().min(0).max(100),
  resolution_score: Joi.number().integer().min(0).max(100),
  total_score: Joi.number().integer().min(0).max(100),
  customer_satisfaction_score: Joi.number().integer().min(0).max(100),
});

// سطر تفريغ واحد من المكالمة: متحدّث + نص + وقت اختياري (ISO).
const transcriptLineSchema = Joi.object({
  speaker: Joi.string().max(120).allow(null, '').optional(),
  text: Joi.string().required(),
  ts: Joi.date().iso().optional(),
  summary: Joi.string().allow(null, '').optional(),
});

// اقتراح مدرّب لحظي واحد (live coaching) يُحفظ في جدول suggestions.
// problem_type/suggestion_type: تصنيف الاقتراح (نوع المشكلة/نوع الاقتراح) للتنظيم.
const suggestionSchema = Joi.object({
  suggest_text: Joi.string().min(1).max(2000).required(),
  agent_action: Joi.string().max(2000).allow(null, '').optional(),
  priority: Joi.string().valid('low', 'medium', 'high').optional(),
  problem_type: Joi.string().max(120).allow(null, '').optional(),
  suggestion_type: Joi.string().max(120).allow(null, '').optional(),
});

// عميل مُضمّن يُحفظ مع المكالمة عند عدم اختيار customer_id. الموظف قد يُدخل
// الاسم و/أو الرقم، ويكمل الـ AI الباقي — لكن لا بد من الاثنين قبل الحفظ النهائي
// (يُفرض في الخدمة). لذا نسمح بأحدهما هنا على الأقل.
const inlineCustomerSchema = Joi.object({
  name: Joi.string().min(1).max(255).allow(null, '').optional(),
  phone_number: Joi.string().min(3).max(30).allow(null, '').optional(),
  email: Joi.string().email().allow(null, '').optional(),
}).or('name', 'phone_number');

const createCallSchema = Joi.object({
  customer_id: Joi.string().uuid().allow(null, '').optional(),
  customer: inlineCustomerSchema.optional(),
  call_start: Joi.date().iso().required(),
  call_end: Joi.date().iso().min(Joi.ref('call_start')).required(),
  call_type: Joi.string().valid(...CALL_TYPES).allow(null, '').optional(),
  issues_category: Joi.string().max(255).allow(null, '').optional(),
  recording_path: Joi.string().max(1000).allow(null, '').optional(),
  sentiment: Joi.string().max(120).allow(null, '').optional(),
  summary: Joi.string().allow(null, '').optional(),
  analysis: Joi.object().unknown(true).optional(),
  transcripts: Joi.array().items(transcriptLineSchema).max(2000).optional(),
  scores: scoresSchema.optional(),
  suggestions: Joi.array().items(suggestionSchema).max(500).optional(),
});

/**
 * Schema for updating an existing call's editable fields.
 * @type {Joi.ObjectSchema}
 */
const updateCallSchema = Joi.object({
  customer_id: Joi.string().uuid().allow(null, '').optional(),
  call_type: Joi.string().valid(...CALL_TYPES).allow(null, '').optional(),
  issues_category: Joi.string().max(255).allow(null, '').optional(),
}).min(1);

/**
 * Schema for the :callId route parameter.
 * @type {Joi.ObjectSchema}
 */
const callIdParamSchema = Joi.object({
  callId: Joi.string().uuid().required(),
});

/**
 * Schema for creating a customer from the agent dashboard.
 * @type {Joi.ObjectSchema}
 */
// phone_number مطلوب (NOT NULL UNIQUE في جدول customers)
const createCustomerSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  phone_number: Joi.string().min(3).max(30).required(),
  email: Joi.string().email().allow(null, '').optional(),
});

module.exports = {
  CALL_TYPES,
  createCallSchema,
  updateCallSchema,
  callIdParamSchema,
  createCustomerSchema,
};
