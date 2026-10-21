/**
 * @fileoverview Auth module routes.
 * Handles user authentication endpoints (login, signup).
 * @module modules/auth/auth.routes
 */

const express = require('express');
const router = express.Router();

const authController = require('./auth.controller');
const {
  loginSchema,
  signupSchema,
  changePasswordSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} = require('./auth.validation');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { authLimiter, passwordResetLimiter, otpAttemptLimiter } = require('../../middleware/rateLimiter');

/**
 * @route POST /api/auth/login
 * @desc Authenticate user and return session + profile
 * @access Public
 */
router.post('/login', authLimiter, validate(loginSchema), authController.login);

/**
 * @route POST /api/auth/signup
 * @desc Register a new user account
 * @access Public
 */
router.post('/signup', authLimiter, validate(signupSchema), authController.signup);

/**
 * @route POST /api/auth/forgot-password
 * @desc Verify the email is registered and mail a 6-digit reset code
 * @access Public
 */
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

/**
 * @route POST /api/auth/verify-otp
 * @desc Check a reset code without consuming it (UI step 2)
 * @access Public
 */
router.post('/verify-otp', otpAttemptLimiter, validate(verifyOtpSchema), authController.verifyOtp);

/**
 * @route POST /api/auth/reset-password
 * @desc Set a new password using a valid reset code
 * @access Public
 */
router.post(
  '/reset-password',
  otpAttemptLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

/**
 * @route POST /api/auth/change-password
 * @desc Change own password (forced first-login or voluntary)
 * @access Authenticated
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

/**
 * @route PUT /api/auth/me
 * @desc Update own profile (full_name, phone)
 * @access Authenticated
 */
router.put('/me', authenticate, validate(updateProfileSchema), authController.updateMe);

/**
 * @route POST /api/auth/audit
 * @desc Record a browser-only audit event (LOGOUT, GENERATE_REPORT)
 * @access Authenticated
 */
router.post('/audit', authenticate, authController.recordAudit);

module.exports = router;
