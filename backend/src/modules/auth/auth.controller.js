/**
 * @fileoverview Auth controller - thin request/response layer for authentication.
 * Delegates all business logic to auth.service.
 * @module modules/auth/auth.controller
 */

const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const audit = require('../../services/audit.service');

/** Audit actions a signed-in client is allowed to self-report (browser-only events). */
const CLIENT_AUDIT_ACTIONS = ['LOGOUT', 'GENERATE_REPORT'];

/**
 * Handle user login.
 * @route POST /api/auth/login
 * @returns {{ success: boolean, message: string, session: object, user: object }}
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { session, user } = await authService.login(email, password);

  audit.record({
    userId: user.user_id,
    action: 'LOGIN',
    resource: 'auth',
    details: { email: user.email, role: user.role },
    ip: req.ip,
    userAgent: req.get('User-Agent') || null,
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    session,
    user,
  });
});

/**
 * Record a browser-only audit event (LOGOUT, GENERATE_REPORT) for the
 * authenticated user. The action is validated against a strict whitelist.
 * @route POST /api/auth/audit
 * @returns {{ success: boolean }}
 */
const recordAudit = asyncHandler(async (req, res) => {
  const action = String(req.body.action || '').toUpperCase();
  if (!CLIENT_AUDIT_ACTIONS.includes(action)) {
    throw ApiError.badRequest('Unsupported audit action');
  }
  audit.record({
    userId: req.user.id,
    action,
    resource: 'client',
    details: req.body.details && typeof req.body.details === 'object' ? req.body.details : {},
    ip: req.ip,
    userAgent: req.get('User-Agent') || null,
  });
  res.status(202).json({ success: true });
});

/**
 * Handle user signup.
 * @route POST /api/auth/signup
 * @returns {{ success: boolean, message: string }}
 */
const signup = asyncHandler(async (req, res) => {
  const { email, password, full_name, username } = req.body;
  const result = await authService.signup({ email, password, full_name, username });

  res.status(201).json({
    success: true,
    message: result.message,
  });
});

/**
 * Change the authenticated user's password (forced first-login or voluntary).
 * @route POST /api/auth/change-password
 * @returns {{ success: boolean, message: string }}
 */
const changePassword = asyncHandler(async (req, res) => {
  const { new_password, current_password } = req.body;
  const result = await authService.changePassword(req.user.id, req.user.email, new_password, current_password);
  res.status(200).json({ success: true, message: result.message });
});

/**
 * Update the authenticated user's own profile.
 * @route PUT /api/auth/me
 * @returns {{ success: boolean, user: object }}
 */
const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.status(200).json({ success: true, user });
});

/**
 * Step 1 of "نسيت كلمة المرور" — verify the email is registered and mail an OTP.
 * @route POST /api/auth/forgot-password
 * @returns {{ success: boolean, message: string, expires_in_minutes: number, delivered: boolean }}
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.requestPasswordReset(email);

  audit.record({
    userId: result.user_id,
    action: 'PASSWORD_RESET_REQUEST',
    resource: 'auth',
    details: { email, delivered: result.delivered },
    ip: req.ip,
    userAgent: req.get('User-Agent') || null,
  });

  res.status(200).json({
    success: true,
    message: result.message,
    expires_in_minutes: result.expires_in_minutes,
    delivered: result.delivered,
  });
});

/**
 * Step 2 — check the OTP so the UI can reveal the new-password field.
 * The code is not consumed here; resetPassword re-checks it.
 * @route POST /api/auth/verify-otp
 * @returns {{ success: boolean, message: string }}
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const result = await authService.verifyResetOtp(email, code);
  res.status(200).json({ success: true, message: result.message });
});

/**
 * Step 3 — set the new password and burn the OTP.
 * @route POST /api/auth/reset-password
 * @returns {{ success: boolean, message: string }}
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, new_password } = req.body;
  const result = await authService.resetPassword(email, code, new_password);

  audit.record({
    userId: result.user_id,
    action: 'PASSWORD_RESET',
    resource: 'auth',
    details: { email },
    ip: req.ip,
    userAgent: req.get('User-Agent') || null,
  });

  res.status(200).json({ success: true, message: result.message });
});

module.exports = {
  login,
  signup,
  changePassword,
  updateMe,
  recordAudit,
  forgotPassword,
  verifyOtp,
  resetPassword,
};
