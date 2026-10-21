/**
 * @module utils/ApiError
 * @description Custom error class for operational API errors.
 * Provides structured error information including HTTP status codes
 * and a flag to distinguish operational errors from programming bugs.
 *
 * @example
 * // Throwing directly
 * throw new ApiError(400, 'Invalid email format');
 *
 * // Using static factory methods
 * throw ApiError.notFound('User not found');
 * throw ApiError.unauthorized();
 */

/**
 * Structured API error for Express error handling.
 * @extends Error
 */
class ApiError extends Error {
  /**
   * Creates a new ApiError instance.
   *
   * @param {number} statusCode - HTTP status code (e.g., 400, 401, 404, 500)
   * @param {string} message - Human-readable error message
   * @param {boolean} [isOperational=true] - Whether this is an expected operational error.
   *   Set to false for unexpected/programming errors that should trigger alerts.
   */
  constructor(statusCode, message, isOperational = true) {
    super(message);

    /** @type {number} HTTP status code */
    this.statusCode = statusCode;

    /** @type {string} Error status category: 'fail' for 4xx, 'error' for 5xx */
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';

    /** @type {boolean} Operational vs programming error flag */
    this.isOperational = isOperational;

    // Capture stack trace, excluding the constructor call from the trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Creates a 400 Bad Request error.
   * @param {string} [message='Bad request'] - Error message
   * @returns {ApiError}
   */
  static badRequest(message = 'Bad request') {
    return new ApiError(400, message);
  }

  /**
   * Creates a 401 Unauthorized error.
   * @param {string} [message='Unauthorized'] - Error message
   * @returns {ApiError}
   */
  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  /**
   * Creates a 403 Forbidden error.
   * @param {string} [message='Access denied'] - Error message
   * @returns {ApiError}
   */
  static forbidden(message = 'Access denied') {
    return new ApiError(403, message);
  }

  /**
   * Creates a 404 Not Found error.
   * @param {string} [message='Resource not found'] - Error message
   * @returns {ApiError}
   */
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  /**
   * Creates a 429 Too Many Requests error.
   * @param {string} [message='Too many requests'] - Error message
   * @returns {ApiError}
   */
  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  /**
   * Creates a 500 Internal Server Error.
   * Marked as non-operational since 500 errors typically indicate unexpected failures.
   *
   * @param {string} [message='Internal server error'] - Error message
   * @returns {ApiError}
   */
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, false);
  }
}

module.exports = ApiError;
