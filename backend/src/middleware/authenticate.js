/**
 * @module middleware/authenticate
 * @description Supabase JWT verification middleware.
 * Verifies Supabase-issued tokens and hydrates req.user with the user profile.
 * Implements a short-lived cache (30s) to avoid repeated DB lookups on every request.
 *
 * This does NOT replace Supabase Auth — it verifies Supabase tokens server-side.
 */

const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

/**
 * Hash a token to produce a short, safe cache key.
 * @param {string} token - The raw JWT token.
 * @returns {string} A 16-character hex hash suitable for cache keys.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
}

/**
 * Express middleware that authenticates incoming requests via Supabase JWT.
 *
 * Flow:
 * 1. Extract Bearer token from the Authorization header.
 * 2. Check the in-memory cache for a previously verified user profile.
 * 3. If not cached, verify the token with Supabase Auth and look up the user profile.
 * 4. Hydrate req.user and cache the result for 30 seconds.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function authenticate(req, res, next) {
  try {
    // 1. Extract token from the Authorization header, or the ?token= query
    //    param (used by EventSource / SSE, which cannot set custom headers).
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Strip 'Bearer '
    } else if (req.query && req.query.token) {
      token = String(req.query.token);
    }
    if (!token) {
      throw ApiError.unauthorized('Authentication required');
    }

    // 1b. Reject obviously-malformed tokens up front. A Supabase JWT always has
    //     three dot-separated segments; bailing here avoids a wasted network
    //     round-trip to Supabase and shrinks the DoS surface for garbage tokens
    //     (e.g. an EventSource reconnecting with a stale/blank token).
    if (token.split('.').length !== 3) {
      throw ApiError.unauthorized('Invalid or expired token');
    }

    // 2. Check cache first
    const cacheKey = `auth:${hashToken(token)}`;
    const cachedUser = cache.get(cacheKey);

    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    // 3. Verify token with Supabase Auth
    const { data, error: authError } = await supabase.auth.getUser(token);

    if (authError || !data?.user) {
      logger.warn('Token verification failed', {
        error: authError?.message || 'No user returned',
      });
      throw ApiError.unauthorized('Invalid or expired token');
    }

    const authUser = data.user;

    // 4. Look up user profile from the users table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('user_id, full_name, email, role, is_active, phone, parent_id')
      .eq('user_id', authUser.id)
      .single();

    if (profileError || !profile) {
      logger.warn('User profile not found', {
        userId: authUser.id,
        error: profileError?.message,
      });
      throw ApiError.unauthorized('User profile not found');
    }

    // 5. Check if the account is active
    if (profile.is_active === false) {
      logger.warn('Deactivated account attempted access', {
        userId: profile.user_id,
        email: profile.email,
      });
      throw ApiError.forbidden('Account is deactivated');
    }

    // 6. Hydrate req.user
    req.user = {
      id: profile.user_id,
      email: profile.email,
      role: profile.role,
      fullName: profile.full_name,
      isActive: profile.is_active,
      phone: profile.phone || null,
      managerId: profile.parent_id || null,
    };

    // 7. Cache the user profile for 30 seconds
    cache.set(cacheKey, req.user, 30);

    return next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
