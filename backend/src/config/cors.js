/**
 * @module config/cors
 * @description CORS configuration for the Express application.
 * Supports wildcard ('*') or a comma-separated list of allowed origins.
 *
 * @exports {Object} corsOptions - Options object compatible with the `cors` middleware.
 */

const config = require('./index');

/**
 * Parses the configured CORS origin value.
 * - If '*', allows all origins (returns true for every request).
 * - Otherwise, splits by comma and returns an array of trimmed origin strings.
 *
 * @param {string} originConfig - Raw origin config value
 * @returns {boolean|string[]} Origin setting for cors middleware
 */
const parseOrigin = (originConfig) => {
  if (originConfig === '*') {
    return true;
  }

  return originConfig
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

/**
 * CORS options object.
 * Pass directly to the `cors()` middleware.
 *
 * @type {Object}
 * @property {boolean|string[]} origin - Allowed origins
 * @property {string[]} methods - Allowed HTTP methods
 * @property {string[]} allowedHeaders - Allowed request headers
 * @property {boolean} credentials - Whether to include credentials
 * @property {number} maxAge - Preflight response cache duration in seconds (24h)
 */
const corsOptions = {
  origin: parseOrigin(config.cors.origin),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
};

module.exports = corsOptions;
