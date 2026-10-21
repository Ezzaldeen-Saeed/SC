/**
 * @module middleware/rateLimiter
 * @description Rate limiting middleware for API and authentication endpoints.
 * Uses express-rate-limit with configurable windows and thresholds.
 *
 * - apiLimiter: General API rate limit (applied globally or to API routes).
 * - authLimiter: Stricter limit for authentication endpoints (login, register, etc.).
 *
 * Both limiters throw ApiError.tooManyRequests() when the limit is exceeded,
 * ensuring consistent error formatting across the application.
 */

const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const config = require('../config');
const ApiError = require('../utils/ApiError');

/**
 * Rate-limit key: per authenticated user when a token is present (Bearer header
 * or the SSE `?token=` query), else per client IP. Bucketing by user means one
 * user's polling can never exhaust another's quota — important when several
 * users share an IP (corporate NAT / reverse proxy / local dev on localhost).
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientKey(req) {
  const header = req.headers.authorization;
  const token =
    header && header.startsWith('Bearer ')
      ? header.substring(7)
      : req.query && req.query.token
        ? String(req.query.token)
        : null;
  if (token) return `tok:${crypto.createHash('sha256').update(token).digest('hex').substring(0, 16)}`;
  return `ip:${req.ip || 'unknown'}`;
}

/**
 * General API rate limiter.
 * Applies to all API routes to prevent abuse and ensure fair usage.
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many requests, please try again later'));
  },
});

/**
 * Dedicated limiter for the long-lived SSE notification stream (/api/events).
 * Mounted before the shared apiLimiter (see app.js) so the persistent stream
 * and its reconnects use their OWN budget and can never starve normal dashboard
 * requests. Still caps reconnect storms (per user/IP) from a misbehaving client.
 */
const eventsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // generous for healthy reconnects; blocks tight reconnect loops
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many connection attempts, please slow down'));
  },
});

/**
 * Authentication route rate limiter.
 * Applies stricter limits to auth endpoints (login, register, password reset)
 * to mitigate brute-force and credential-stuffing attacks.
 */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many authentication attempts, please try again later'));
  },
});

/**
 * Limiter for ISSUING password-reset codes (POST /forgot-password).
 *
 * Separate from authLimiter so a burst of reset attempts can't lock legitimate
 * users out of /login, and vice versa. This caps how many emails one IP can have
 * sent — it deliberately does NOT guard /verify-otp or /reset-password, which
 * need their own budget (see otpAttemptLimiter).
 */
const passwordResetLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.passwordResetMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('عدد كبير من محاولات استعادة كلمة المرور — برجاء المحاولة بعد قليل'));
  },
});

/**
 * Limiter for SPENDING a reset code (/verify-otp, /reset-password).
 *
 * Intentionally roomier than passwordResetLimiter: one honest reset already
 * costs two calls here, and a mistyped code must not lock the user out while a
 * valid code sits in their inbox. Guessing is capped by OTP_MAX_ATTEMPTS per
 * code, which burns the code long before this ceiling — so this only exists to
 * stop a runaway client loop.
 */
const otpAttemptLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('عدد كبير من المحاولات — برجاء المحاولة بعد قليل'));
  },
});

module.exports = { apiLimiter, authLimiter, eventsLimiter, passwordResetLimiter, otpAttemptLimiter };
