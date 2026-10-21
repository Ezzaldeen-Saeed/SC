/**
 * @module middleware/errorHandler
 * @description Global error handling middleware for Express.
 * Catches all errors propagated via next(err) and sends a consistent JSON response.
 *
 * Features:
 * - Recognizes ApiError instances and uses their status codes.
 * - Handles Joi validation errors with detailed field-level messages.
 * - Never exposes stack traces in production.
 * - Logs errors with appropriate severity levels.
 */

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Global Express error handler.
 * Must be registered AFTER all routes and other middleware.
 *
 * @param {Error} err - The error object.
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next function.
 */
function errorHandler(err, req, res, next) {
  let statusCode = 500;
  let message = 'Internal server error';

  // Determine error type and extract appropriate status/message
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err.isJoi === true) {
    // Joi validation error
    statusCode = 400;
    message = err.details
      ? err.details.map((d) => d.message).join(', ')
      : err.message;
  }

  // Log the error with appropriate severity
  const logPayload = {
    statusCode,
    message: err.message,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id || 'anonymous',
    ...(config.env === 'development' && { stack: err.stack }),
  };

  if (statusCode >= 500) {
    logger.error('Server error', logPayload);
  } else if (statusCode >= 400) {
    logger.warn('Client error', logPayload);
  }

  // Build response body
  const responseBody = {
    success: false,
    message,
  };

  // Only include stack trace in development
  if (config.env === 'development') {
    responseBody.stack = err.stack;
  }

  res.status(statusCode).json(responseBody);
}

module.exports = errorHandler;
