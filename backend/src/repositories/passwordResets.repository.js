/**
 * @module repositories/passwordResets.repository
 * @description Data access layer for the password_reset_otps table (the
 * "نسيت كلمة المرور" flow). All operations use supabaseAdmin (service role);
 * RLS denies this table to every other client.
 *
 * Rows hold a bcrypt hash of the code, never the code itself.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Raised when the table hasn't been provisioned yet, so callers can point the
 * operator at migrate.sql instead of surfacing a bare 500.
 * @param {{ code?: string, message?: string }} error
 * @returns {boolean}
 */
function isMissingTable(error) {
  return error.code === 'PGRST205' || /could not find the table/i.test(error.message || '');
}

/**
 * Consume every live OTP for a user. Called before issuing a new one so that
 * requesting a fresh code immediately invalidates the previous email.
 * @param {string} userId - UUID of the user
 * @returns {Promise<void>}
 * @throws {ApiError} On database error
 */
async function invalidateActiveForUser(userId) {
  const { error } = await supabaseAdmin
    .from('password_reset_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('consumed_at', null);

  if (error) {
    if (isMissingTable(error)) {
      throw ApiError.internal(
        'password_reset_otps table not found — run supabase/migrate.sql to enable password reset'
      );
    }
    logger.error('PasswordResetsRepository.invalidateActiveForUser failed', { userId, error: error.message });
    throw ApiError.internal('Failed to invalidate previous reset codes');
  }
}

/**
 * Insert a new OTP row.
 * @param {Object} data
 * @param {string} data.user_id - UUID of the user
 * @param {string} data.email - Email the code was sent to
 * @param {string} data.code_hash - bcrypt hash of the 6-digit code
 * @param {string} data.expires_at - ISO timestamp when the code stops working
 * @returns {Promise<Object>} The created OTP row
 * @throws {ApiError} On database error
 */
async function create({ user_id, email, code_hash, expires_at }) {
  const { data, error } = await supabaseAdmin
    .from('password_reset_otps')
    .insert({ user_id, email, code_hash, expires_at })
    .select()
    .single();

  if (error) {
    if (isMissingTable(error)) {
      throw ApiError.internal(
        'password_reset_otps table not found — run supabase/migrate.sql to enable password reset'
      );
    }
    logger.error('PasswordResetsRepository.create failed', { user_id, error: error.message });
    throw ApiError.internal('Failed to create reset code');
  }

  return data;
}

/**
 * Fetch the newest unconsumed OTP for a user. Expiry and attempt limits are the
 * service's call — this returns the row so the caller can tell "expired" apart
 * from "never requested" in its error message.
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object|null>} The OTP row, or null if none is outstanding
 * @throws {ApiError} On database error
 */
async function findActiveByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('password_reset_otps')
    .select('*')
    .eq('user_id', userId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      throw ApiError.internal(
        'password_reset_otps table not found — run supabase/migrate.sql to enable password reset'
      );
    }
    logger.error('PasswordResetsRepository.findActiveByUserId failed', { userId, error: error.message });
    throw ApiError.internal('Failed to fetch reset code');
  }

  return data;
}

/**
 * Record a failed verification attempt.
 * @param {string} otpId - UUID of the OTP row
 * @param {number} attempts - The new attempt count
 * @returns {Promise<void>}
 * @throws {ApiError} On database error
 */
async function incrementAttempts(otpId, attempts) {
  const { error } = await supabaseAdmin
    .from('password_reset_otps')
    .update({ attempts })
    .eq('otp_id', otpId);

  if (error) {
    logger.error('PasswordResetsRepository.incrementAttempts failed', { otpId, error: error.message });
    throw ApiError.internal('Failed to record reset attempt');
  }
}

/**
 * Burn an OTP after a successful password reset, so the same code can't be
 * replayed.
 * @param {string} otpId - UUID of the OTP row
 * @returns {Promise<void>}
 * @throws {ApiError} On database error
 */
async function markConsumed(otpId) {
  const { error } = await supabaseAdmin
    .from('password_reset_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('otp_id', otpId);

  if (error) {
    logger.error('PasswordResetsRepository.markConsumed failed', { otpId, error: error.message });
    throw ApiError.internal('Failed to consume reset code');
  }
}

module.exports = {
  invalidateActiveForUser,
  create,
  findActiveByUserId,
  incrementAttempts,
  markConsumed,
};
