/**
 * @fileoverview Auth module validation schemas.
 * Defines Joi schemas for login and signup request validation.
 * @module modules/auth/auth.validation
 */

const Joi = require('joi');

/**
 * Schema for user login requests.
 * @type {Joi.ObjectSchema}
 */
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

/**
 * Schema for user signup requests.
 * @type {Joi.ObjectSchema}
 */
const signupSchema = Joi.object({
  // lowercase: this address is inserted into users.email, the lookup key for
  // password reset, and must match Supabase Auth's lowercased copy.
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(6).required(),
  full_name: Joi.string().min(2).max(255).required(),
  username: Joi.string().min(2).max(100).required(),
});

/**
 * Schema for changing the authenticated user's password.
 * current_password is optional (only required for voluntary changes; the
 * service enforces that). @type {Joi.ObjectSchema}
 */
const changePasswordSchema = Joi.object({
  new_password: Joi.string().min(6).required(),
  current_password: Joi.string().allow('').optional(),
});

/**
 * Schema for a user editing their own profile (name + phone).
 * @type {Joi.ObjectSchema}
 */
const updateProfileSchema = Joi.object({
  full_name: Joi.string().min(2).max(255).optional(),
  phone: Joi.string().max(30).allow('', null).optional(),
}).min(1);

/**
 * Six ASCII digits. Shared by the OTP verify/reset schemas so both reject a
 * malformed code before it ever reaches bcrypt.
 * @type {Joi.StringSchema}
 */
const otpCode = Joi.string()
  .length(6)
  .pattern(/^[0-9]+$/)
  .required()
  .messages({
    'string.length': 'كود التحقق يجب أن يكون 6 أرقام',
    'string.pattern.base': 'كود التحقق يجب أن يتكون من أرقام فقط',
  });

/**
 * Email as a reset-flow lookup key. Lowercased to match how the address is
 * stored in users.email (see migrate.sql normalisation).
 * @type {Joi.StringSchema}
 */
const resetEmail = Joi.string().email().lowercase().required().messages({
  'string.email': 'صيغة البريد الإلكتروني غير صحيحة',
  'any.required': 'البريد الإلكتروني مطلوب',
});

/**
 * Schema for requesting a password-reset code.
 * @type {Joi.ObjectSchema}
 */
const forgotPasswordSchema = Joi.object({
  email: resetEmail,
});

/**
 * Schema for checking a reset code (UI step 2 — does not consume it).
 * @type {Joi.ObjectSchema}
 */
const verifyOtpSchema = Joi.object({
  email: resetEmail,
  code: otpCode,
});

/**
 * Schema for completing a reset: code + the new password.
 * @type {Joi.ObjectSchema}
 */
const resetPasswordSchema = Joi.object({
  email: resetEmail,
  code: otpCode,
  new_password: Joi.string().min(6).required().messages({
    'string.min': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
    'any.required': 'كلمة المرور الجديدة مطلوبة',
  }),
});

module.exports = {
  loginSchema,
  signupSchema,
  changePasswordSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
};
