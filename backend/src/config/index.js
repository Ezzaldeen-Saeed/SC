/**
 * @module config
 * @description Centralized application configuration with environment variable validation.
 * Loads environment variables from .env file and validates them using Joi schema.
 * Throws a descriptive error on startup if required variables are missing or invalid.
 *
 * @exports {Object} config
 * @property {string} env - Node environment (development, production, test)
 * @property {number} port - Server port number
 * @property {Object} supabase - Supabase connection credentials
 * @property {string} supabase.url - Supabase project URL
 * @property {string} supabase.anonKey - Supabase anonymous/public key
 * @property {string} supabase.serviceRoleKey - Supabase service role key (admin access)
 * @property {Object} cors - CORS configuration
 * @property {string} cors.origin - Allowed origins (comma-separated or '*')
 * @property {Object} rateLimit - Rate limiting configuration
 * @property {number} rateLimit.windowMs - Rate limit window in milliseconds
 * @property {number} rateLimit.max - Max requests per window (general)
 * @property {number} rateLimit.authMax - Max requests per window (auth endpoints)
 * @property {number} rateLimit.passwordResetMax - Max requests per window (password reset)
 * @property {Object} smtp - Outbound email credentials for password-reset OTPs
 * @property {boolean} smtp.enabled - False when credentials are absent; OTPs are logged, not mailed
 * @property {Object} otp - Password-reset OTP policy (TTL, max attempts)
 */

require('dotenv').config({ quiet: true });

const Joi = require('joi');

const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Application environment'),

  PORT: Joi.number()
    .port()
    .default(3000)
    .description('Server listening port'),

  SUPABASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .description('Supabase project URL'),

  SUPABASE_ANON_KEY: Joi.string()
    .min(1)
    .required()
    .description('Supabase anonymous/public API key'),

  SUPABASE_SERVICE_ROLE_KEY: Joi.string()
    .min(1)
    .required()
    .description('Supabase service role key for admin operations'),

  CORS_ORIGIN: Joi.string()
    .default('*')
    .description('Allowed CORS origins (comma-separated or *)'),

  RATE_LIMIT_WINDOW_MS: Joi.number()
    .integer()
    .positive()
    .default(900000)
    .description('Rate limit window in milliseconds (default: 15 minutes)'),

  RATE_LIMIT_MAX: Joi.number()
    .integer()
    .positive()
    .default(1000)
    .description('Max requests per rate limit window, per user (general). Dashboards poll several endpoints on an interval, so this is per-token (see rateLimiter), not per-IP.'),

  AUTH_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .positive()
    .default(10)
    .description('Max requests per rate limit window (auth endpoints)'),

  SMTP_HOST: Joi.string()
    .allow('')
    .default('')
    .description('SMTP hostname (e.g. smtp.gmail.com). Empty disables real delivery — see config.smtp.enabled'),

  SMTP_PORT: Joi.number()
    .port()
    .default(587)
    .description('SMTP port (587 = STARTTLS, 465 = implicit TLS)'),

  SMTP_SECURE: Joi.boolean()
    .default(false)
    .description('Use implicit TLS from the first byte. true for port 465, false for 587'),

  SMTP_USER: Joi.string()
    .allow('')
    .default('')
    .description('SMTP username (for Gmail: the full address)'),

  SMTP_PASS: Joi.string()
    .allow('')
    .default('')
    .description('SMTP password (for Gmail: a 16-char App Password, not the account password)'),

  SMTP_FROM: Joi.string()
    .allow('')
    .default('')
    .description('From header, e.g. "SCM <no-reply@example.com>". Defaults to SMTP_USER'),

  OTP_TTL_MINUTES: Joi.number()
    .integer()
    .positive()
    .default(10)
    .description('How long a password-reset OTP stays valid'),

  OTP_MAX_ATTEMPTS: Joi.number()
    .integer()
    .positive()
    .default(5)
    .description('Wrong-code attempts allowed per OTP before it is burned'),

  PASSWORD_RESET_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .positive()
    .default(5)
    .description('Max password-reset requests per rate limit window, per IP'),
})
  .unknown(true) // Allow other env vars not defined in schema
  .messages({
    'any.required': '{{#label}} is required — check your .env file',
    'string.uri': '{{#label}} must be a valid URL (e.g., https://your-project.supabase.co)',
    'string.empty': '{{#label}} cannot be empty',
  });

const { error, value: envVars } = envSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: false,
});

if (error) {
  const details = error.details.map((d) => `  • ${d.message}`).join('\n');
  throw new Error(
    `\n[CONFIG] Environment validation failed:\n${details}\n\n` +
      `Ensure all required variables are set in your .env file.\n`
  );
}

const config = {
  /** @type {string} Current environment */
  env: envVars.NODE_ENV,

  /** @type {number} Server port */
  port: envVars.PORT,

  /** @type {Object} Supabase credentials */
  supabase: {
    url: envVars.SUPABASE_URL,
    anonKey: envVars.SUPABASE_ANON_KEY,
    serviceRoleKey: envVars.SUPABASE_SERVICE_ROLE_KEY,
  },

  /** @type {Object} CORS settings */
  cors: {
    origin: envVars.CORS_ORIGIN,
  },

  /** @type {Object} Rate limiting settings */
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX,
    authMax: envVars.AUTH_RATE_LIMIT_MAX,
    passwordResetMax: envVars.PASSWORD_RESET_RATE_LIMIT_MAX,
  },

  /** @type {Object} Outbound email (SMTP) settings */
  smtp: {
    host: envVars.SMTP_HOST,
    port: envVars.SMTP_PORT,
    secure: envVars.SMTP_SECURE,
    user: envVars.SMTP_USER,
    pass: envVars.SMTP_PASS,
    from: envVars.SMTP_FROM || envVars.SMTP_USER,
    // Email is optional infrastructure: with no credentials the app still boots and
    // the reset flow still works end-to-end — email.service logs the OTP instead of
    // sending it. Keeps local dev running without a mailbox.
    enabled: Boolean(envVars.SMTP_HOST && envVars.SMTP_USER && envVars.SMTP_PASS),
  },

  /** @type {Object} Password-reset OTP policy */
  otp: {
    ttlMinutes: envVars.OTP_TTL_MINUTES,
    maxAttempts: envVars.OTP_MAX_ATTEMPTS,
  },
};

module.exports = config;
