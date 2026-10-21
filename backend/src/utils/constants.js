/**
 * @module utils/constants
 * @description Application-wide constants. Single source of truth for roles,
 * cache configuration, and pagination defaults. Prevents magic strings and
 * numbers scattered throughout the codebase.
 *
 * @example
 * const { ROLES, CACHE_KEYS, CACHE_TTL, PAGINATION } = require('./constants');
 *
 * if (user.role === ROLES.ADMIN) { ... }
 * cache.set(CACHE_KEYS.ALL_USERS, users, CACHE_TTL.LONG);
 */

/**
 * Application role identifiers.
 * Used for RBAC (Role-Based Access Control) checks throughout middleware and services.
 *
 * @readonly
 * @enum {string}
 */
const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
});

/**
 * Ordered array of all valid roles.
 * Useful for validation checks and iteration.
 *
 * @type {string[]}
 */
const ALL_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.SUPERVISOR,
  ROLES.AGENT,
]);

/**
 * Standardized cache key prefixes/patterns.
 * Use these constants as keys (or key prefixes) when interacting with the cache
 * to ensure consistency and prevent key collisions.
 *
 * Keys ending with ':' are prefixes — append a unique identifier (e.g., user ID).
 *
 * @readonly
 * @enum {string}
 */
const CACHE_KEYS = Object.freeze({
  /** Admin dashboard statistics */
  ADMIN_STATS: 'admin:stats',

  /** Aggregated admin dashboard payload (stats + users + calls + customers) */
  ADMIN_OVERVIEW: 'admin:overview',

  /** Manager statistics (prefix — append manager ID) */
  MANAGER_STATS: 'manager:stats:',

  /** Full user list for admin panel */
  ALL_USERS: 'admin:users',
});

/**
 * Cache TTL (time-to-live) values in seconds.
 *
 * @readonly
 * @enum {number}
 */
const CACHE_TTL = Object.freeze({
  /** 8 seconds — for near-real-time payloads polled by live dashboards */
  REALTIME: 8,

  /** 30 seconds — for rapidly changing data (e.g., live call metrics) */
  SHORT: 30,

  /** 60 seconds — for moderately changing data (e.g., dashboard stats) */
  MEDIUM: 60,

  /** 300 seconds (5 min) — for stable data (e.g., user lists, config) */
  LONG: 300,
});

/**
 * Pagination defaults and limits.
 *
 * @readonly
 * @enum {number}
 */
const PAGINATION = Object.freeze({
  /** Default page number when not specified */
  DEFAULT_PAGE: 1,

  /** Default number of items per page */
  DEFAULT_LIMIT: 50,

  /** Maximum allowed items per page (prevents excessive queries) */
  MAX_LIMIT: 200,
});

module.exports = {
  ROLES,
  ALL_ROLES,
  CACHE_KEYS,
  CACHE_TTL,
  PAGINATION,
};
