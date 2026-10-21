/**
 * @module utils/logger
 * @description Winston logger configuration with environment-aware transports.
 *
 * - Development: Console (colorized) + file transports
 * - Production: File transports only (no console noise)
 * - All environments: error.log (errors only) + combined.log (all levels)
 *
 * Also exports a `stream` object for morgan HTTP request logging integration.
 *
 * @exports {import('winston').Logger} logger - Winston logger instance
 * @exports {Object} stream - Morgan-compatible write stream
 *
 * @example
 * const logger = require('./logger');
 *
 * logger.info('Server started', { port: 3000 });
 * logger.error('Database connection failed', { error: err.message });
 * logger.warn('Deprecated endpoint called', { path: '/v1/old' });
 * logger.debug('Request payload', { body: req.body });
 */

const winston = require('winston');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

/**
 * Directory for log files. Resolves relative to the project root
 * (backend/logs/) regardless of the working directory.
 */
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

/**
 * Console-friendly format for development.
 * Displays timestamp, level (colorized), message, and stack traces.
 */
const devConsoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp: ts, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return stack
      ? `${ts} ${level}: ${message}\n${stack}`
      : `${ts} ${level}: ${message}${metaStr}`;
  })
);

/**
 * Structured JSON format for file transports.
 * Includes timestamps, error stack traces, and all metadata.
 */
const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  json()
);

/**
 * Build transport array based on environment.
 * @returns {winston.transport[]}
 */
const buildTransports = () => {
  const transports = [
    // Error-level log file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
    }),

    // Combined log file (all levels)
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
  ];

  // Console transport in non-production environments only
  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: devConsoleFormat,
      })
    );
  }

  return transports;
};

/**
 * Winston logger instance.
 * @type {import('winston').Logger}
 */
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: 'smart-call-monitor' },
  transports: buildTransports(),
  // Do not exit on uncaught exceptions — let the process manager handle restarts
  exitOnError: false,
});

/**
 * Morgan-compatible write stream for HTTP request logging.
 * Pipe morgan output into the Winston logger at the 'info' level.
 *
 * @type {{ write: (message: string) => void }}
 *
 * @example
 * const morgan = require('morgan');
 * const { stream } = require('./logger');
 * app.use(morgan('combined', { stream }));
 */
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = logger;
