/**
 * @module middleware/requestLogger
 * @description HTTP request/response logging middleware.
 * Captures request start time and logs response details after the response is sent.
 *
 * Log levels are determined by HTTP status code:
 * - 2xx/3xx → logger.info
 * - 4xx     → logger.warn
 * - 5xx     → logger.error
 */

const logger = require('../utils/logger');

/**
 * Express middleware that logs HTTP request and response details.
 * Hooks into the 'finish' event on the response to capture timing and status.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    const logData = {
      method: req.method,
      url: req.originalUrl,
      statusCode,
      responseTime: `${responseTime}ms`,
      ip: req.ip,
      userId: req.user?.id || 'anonymous',
    };

    if (statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  next();
}

module.exports = requestLogger;
