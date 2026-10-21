/**
 * @module utils/asyncHandler
 * @description Express async handler wrapper. Wraps an async route handler
 * to automatically catch rejected promises and forward errors to the
 * Express error-handling middleware via next().
 *
 * Eliminates the need for try/catch blocks in every async route handler.
 *
 * @example
 * const asyncHandler = require('./asyncHandler');
 *
 * router.get('/users', asyncHandler(async (req, res) => {
 *   const users = await User.findAll();
 *   res.json(users);
 *   // Any thrown error or rejected promise is automatically caught
 *   // and forwarded to the error-handling middleware
 * }));
 *
 * @param {Function} fn - Async Express route handler (req, res, next) => Promise
 * @returns {Function} Wrapped Express middleware that catches errors
 */
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
