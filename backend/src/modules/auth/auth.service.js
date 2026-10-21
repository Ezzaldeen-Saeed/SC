/**
 * @fileoverview Auth service - business logic for authentication.
 * Uses Supabase Auth as the source of truth for user identity,
 * with a users table for extended profile data.
 * @module modules/auth/auth.service
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const usersRepository = require('../../repositories/users.repository');
const passwordResetsRepository = require('../../repositories/passwordResets.repository');
const emailService = require('../../services/email.service');

/**
 * Authenticate a user with email and password.
 * @param {string} email - User's email address.
 * @param {string} password - User's password.
 * @returns {Promise<{ session: object, user: object }>} Supabase session and user profile.
 * @throws {ApiError} If credentials are invalid or profile is not found.
 */
const login = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw ApiError.unauthorized(error.message);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profileError) {
    throw ApiError.internal('Failed to retrieve user profile');
  }

  if (!profile) {
    throw ApiError.notFound('User profile not found');
  }

  // سجِّل وقت آخر تسجيل دخول في قاعدة البيانات. غير حاسم: لو العمود غير موجود
  // (سكيمة قديمة) نسجّل تحذيرًا فقط دون تعطيل تسجيل الدخول.
  const loginAt = new Date().toISOString();
  supabaseAdmin
    .from('users')
    .update({ last_login: loginAt })
    .eq('user_id', data.user.id)
    .then(({ error }) => { if (error) logger.warn('login: failed to update last_login', { error: error.message }); })
    .catch((e) => logger.warn('login: last_login update threw', { error: e.message }));
  profile.last_login = loginAt; // اعكسه فورًا في الاستجابة

  // أول دخول: الأدمن أنشأ الحساب بكلمة مرور مؤقتة — نطلب تغييرها أول مرة فقط.
  const mustChange = data.user.user_metadata?.must_change_password === true;

  return { session: data.session, user: { ...profile, must_change_password: mustChange } };
};

/**
 * Change the authenticated user's password.
 * - Forced first-login change (must_change_password=true): no current password needed.
 * - Voluntary change: the current password is required and verified.
 * Clears the must_change_password flag afterwards.
 * @param {string} userId
 * @param {string} email
 * @param {string} newPassword
 * @param {string} [currentPassword]
 * @returns {Promise<{ message: string }>}
 */
const changePassword = async (userId, email, newPassword, currentPassword) => {
  const { data: authData, error: getErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (getErr || !authData?.user) {
    throw ApiError.notFound('User not found');
  }
  const meta = authData.user.user_metadata || {};
  const forced = meta.must_change_password === true;

  if (!forced) {
    if (!currentPassword) {
      throw ApiError.badRequest('كلمة المرور الحالية مطلوبة');
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (signErr) {
      throw ApiError.badRequest('كلمة المرور الحالية غير صحيحة');
    }
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
    user_metadata: { ...meta, must_change_password: false },
  });
  if (error) {
    throw ApiError.badRequest(error.message);
  }
  return { message: 'تم تحديث كلمة المرور بنجاح' };
};

// ── نسيت كلمة المرور — OTP reset flow ────────────────────────────────────
//
// Three steps, each its own endpoint:
//   1. requestPasswordReset  — verify the email exists, mail a 6-digit code
//   2. verifyResetOtp        — check the code without spending it (UI step 2)
//   3. resetPassword         — re-check the code, set the password, burn the code
//
// The code is stored only as a bcrypt hash, is single-use, expires after
// config.otp.ttlMinutes, and dies after config.otp.maxAttempts wrong guesses.

/** bcrypt cost for OTP hashes. Lower than a password's: the code lives ~10 minutes
 *  and only has 10^6 possibilities, so attempt-throttling — not cost — is the real
 *  defence, and reset requests shouldn't stall the event loop. */
const OTP_HASH_ROUNDS = 10;

/**
 * Generate a cryptographically random 6-digit code (000000–999999).
 * crypto.randomInt is uniform; Math.random would be predictable.
 * @returns {string}
 */
const generateOtpCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

/**
 * Look up the account behind a reset request.
 *
 * Per the product requirement, an unknown address is reported explicitly rather
 * than answered with a neutral "if this email exists…". That reveals whether an
 * address is registered (user enumeration) — an accepted trade-off here because
 * accounts are staff-only and created by an admin, never self-registered.
 *
 * @param {string} email - Already lowercased by the Joi schema.
 * @returns {Promise<object>} The users row
 * @throws {ApiError} 404 if unknown, 403 if the account is deactivated
 */
const findResettableUser = async (email) => {
  const user = await usersRepository.findByEmail(email);
  if (!user) {
    throw ApiError.notFound('هذا البريد الإلكتروني غير مسجل في النظام');
  }
  if (user.is_active === false) {
    throw ApiError.forbidden('هذا الحساب موقوف — برجاء التواصل مع مسؤول النظام');
  }
  return user;
};

/**
 * Validate a submitted code against the user's outstanding OTP, without
 * consuming it. Counts a wrong guess against the attempt budget.
 * @param {object} user - The users row
 * @param {string} code - The submitted 6-digit code
 * @returns {Promise<object>} The matching OTP row
 * @throws {ApiError} If no code is outstanding, it expired, attempts ran out, or it's wrong
 */
const assertValidOtp = async (user, code) => {
  const otp = await passwordResetsRepository.findActiveByUserId(user.user_id);
  if (!otp) {
    throw ApiError.badRequest('لا يوجد كود صالح لهذا الحساب — اطلب كودًا جديدًا');
  }
  if (new Date(otp.expires_at) <= new Date()) {
    throw ApiError.badRequest('انتهت صلاحية الكود — اطلب كودًا جديدًا');
  }
  if (otp.attempts >= config.otp.maxAttempts) {
    throw ApiError.tooManyRequests('تم تجاوز عدد المحاولات المسموح بها — اطلب كودًا جديدًا');
  }

  const matches = await bcrypt.compare(code, otp.code_hash);
  if (!matches) {
    const attempts = otp.attempts + 1;
    await passwordResetsRepository.incrementAttempts(otp.otp_id, attempts);
    const remaining = config.otp.maxAttempts - attempts;
    if (remaining <= 0) {
      throw ApiError.tooManyRequests('تم تجاوز عدد المحاولات المسموح بها — اطلب كودًا جديدًا');
    }
    throw ApiError.badRequest(`الكود غير صحيح — المحاولات المتبقية: ${remaining}`);
  }

  return otp;
};

/**
 * Step 1 — issue a reset code and email it.
 * Any previously issued code for this user is invalidated first, so only the
 * newest email works.
 * @param {string} email
 * @returns {Promise<{ message: string, expires_in_minutes: number, delivered: boolean, user_id: string }>}
 * @throws {ApiError} 404 unknown email, 403 deactivated, 500 if the send fails
 */
const requestPasswordReset = async (email) => {
  const user = await findResettableUser(email);

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, OTP_HASH_ROUNDS);
  const expiresAt = new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000).toISOString();

  await passwordResetsRepository.invalidateActiveForUser(user.user_id);
  await passwordResetsRepository.create({
    user_id: user.user_id,
    email: user.email,
    code_hash: codeHash,
    expires_at: expiresAt,
  });

  let delivered = false;
  try {
    ({ delivered } = await emailService.sendPasswordResetOtp({
      to: user.email,
      code,
      fullName: user.full_name,
    }));
  } catch (err) {
    // The code is already stored, but nobody will ever see it — don't tell the
    // user to go check an inbox that will stay empty.
    logger.error('requestPasswordReset: failed to send OTP email', { email: user.email, error: err.message });
    throw ApiError.internal('تعذّر إرسال البريد الإلكتروني — برجاء المحاولة لاحقًا أو التواصل مع مسؤول النظام');
  }

  return {
    message: delivered
      ? 'تم إرسال كود التحقق إلى بريدك الإلكتروني'
      : 'تم إنشاء كود التحقق (وضع التطوير — راجع سجل الخادم)',
    expires_in_minutes: config.otp.ttlMinutes,
    delivered,
    user_id: user.user_id,
  };
};

/**
 * Step 2 — check a code so the UI can advance to the new-password field.
 * Deliberately does not consume the code; resetPassword re-checks it.
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ message: string, user_id: string }>}
 */
const verifyResetOtp = async (email, code) => {
  const user = await findResettableUser(email);
  await assertValidOtp(user, code);
  return { message: 'تم التحقق من الكود بنجاح', user_id: user.user_id };
};

/**
 * Step 3 — set the new password and burn the code.
 * Also clears must_change_password: the user just proved control of the mailbox
 * and chose the password themselves, so forcing another change at login would be
 * a dead end.
 * @param {string} email
 * @param {string} code
 * @param {string} newPassword
 * @returns {Promise<{ message: string, user_id: string }>}
 */
const resetPassword = async (email, code, newPassword) => {
  const user = await findResettableUser(email);
  const otp = await assertValidOtp(user, code);

  const { data: authData, error: getErr } = await supabaseAdmin.auth.admin.getUserById(user.user_id);
  if (getErr || !authData?.user) {
    throw ApiError.notFound('User not found');
  }
  const meta = authData.user.user_metadata || {};

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.user_id, {
    password: newPassword,
    user_metadata: { ...meta, must_change_password: false },
  });
  if (error) {
    throw ApiError.badRequest(error.message);
  }

  await passwordResetsRepository.markConsumed(otp.otp_id);
  logger.info('Password reset completed', { userId: user.user_id });

  return { message: 'تم تعيين كلمة المرور الجديدة بنجاح', user_id: user.user_id };
};

/**
 * Update the authenticated user's own profile (full_name, phone).
 * Writes to the users table and mirrors into Supabase Auth metadata.
 * @param {string} userId
 * @param {{ full_name?: string, phone?: string }} fields
 * @returns {Promise<object>} The updated user row
 */
const updateProfile = async (userId, fields) => {
  const updates = {};
  if (fields.full_name !== undefined) updates.full_name = fields.full_name;
  if (fields.phone !== undefined) updates.phone = fields.phone;
  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest('لا يوجد بيانات للتحديث');
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) {
    throw ApiError.internal('Failed to update profile');
  }

  // Mirror into auth metadata (non-critical).
  try {
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = authData?.user?.user_metadata || {};
    await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { ...meta, ...updates } });
  } catch (_) {
    /* non-critical */
  }

  return data;
};

/**
 * Register a new user account.
 * Creates the Supabase Auth user and inserts a corresponding profile row.
 * @param {object} params - Signup parameters.
 * @param {string} params.email - User's email address.
 * @param {string} params.password - User's password (min 6 chars).
 * @param {string} params.full_name - User's full name.
 * @param {string} params.username - Unique username.
 * @returns {Promise<{ message: string }>} Success message.
 * @throws {ApiError} If signup or profile creation fails.
 */
const signup = async ({ email, password, full_name, username }) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    throw ApiError.badRequest(error.message);
  }

  // 'agent' is the least-privilege valid role. The users.role CHECK constraint
  // only allows admin|manager|supervisor|agent, so 'user' would be rejected.
  const { error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      user_id: data.user.id,
      full_name,
      email,
      username,
      role: 'agent',
      is_active: true,
      created_at: new Date().toISOString(),
    });

  if (insertError) {
    throw ApiError.internal('User created but profile insert failed');
  }

  return { message: 'User created successfully' };
};

module.exports = {
  login,
  signup,
  changePassword,
  updateProfile,
  requestPasswordReset,
  verifyResetOtp,
  resetPassword,
};
