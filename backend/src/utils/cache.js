/**
 * @module utils/cache
 * @description In-memory cache wrapper built on node-cache.
 * Provides a simplified interface for caching frequently accessed data
 * with configurable TTL (time-to-live) per key.
 *
 * Default TTL: 60 seconds. Expired key cleanup check: every 120 seconds.
 *
 * @exports {Object} cache
 * @property {Function} get - Retrieve a cached value by key
 * @property {Function} set - Store a value with optional TTL
 * @property {Function} del - Delete one or more cached keys
 * @property {Function} flush - Clear all cached data
 * @property {Function} getStats - Retrieve cache hit/miss statistics
 *
 * @example
 * const cache = require('./cache');
 *
 * cache.set('user:123', userData, 300); // Cache for 5 minutes
 * const user = cache.get('user:123');   // Retrieve (undefined if expired/missing)
 * cache.del('user:123');                // Remove specific key
 * cache.flush();                        // Clear everything
 */

const NodeCache = require('node-cache');

/**
 * Internal NodeCache instance.
 * @type {NodeCache}
 */
const cacheInstance = new NodeCache({
  stdTTL: 60,        // Default TTL: 60 seconds
  checkperiod: 120,  // Check for expired keys every 120 seconds
  useClones: true,   // Return cloned copies to prevent mutation of cached data
});

/**
 * Retrieves a value from the cache.
 *
 * @param {string} key - Cache key to look up
 * @returns {*|undefined} The cached value, or undefined if the key doesn't exist or has expired
 */
const get = (key) => {
  return cacheInstance.get(key);
};

/**
 * Stores a value in the cache.
 *
 * @param {string} key - Cache key
 * @param {*} value - Value to cache (must be serializable if useClones is true)
 * @param {number} [ttlSeconds] - Time-to-live in seconds. Uses default (60s) if omitted.
 * @returns {boolean} True if the value was stored successfully
 */
const set = (key, value, ttlSeconds) => {
  if (ttlSeconds !== undefined) {
    return cacheInstance.set(key, value, ttlSeconds);
  }
  return cacheInstance.set(key, value);
};

/**
 * Deletes one or more keys from the cache.
 *
 * @param {string|string[]} key - A single key or an array of keys to delete
 * @returns {number} Number of keys actually deleted
 */
const del = (key) => {
  return cacheInstance.del(key);
};

/**
 * Clears all data from the cache.
 * @returns {void}
 */
const flush = () => {
  cacheInstance.flushAll();
};

/**
 * Retrieves cache statistics.
 *
 * @returns {Object} Statistics object with hits, misses, keys count, etc.
 * @property {number} hits - Number of cache hits
 * @property {number} misses - Number of cache misses
 * @property {number} keys - Current number of keys in cache
 * @property {number} ksize - Approximate key size in bytes
 * @property {number} vsize - Approximate value size in bytes
 */
const getStats = () => {
  return cacheInstance.getStats();
};

module.exports = { get, set, del, flush, getStats };
