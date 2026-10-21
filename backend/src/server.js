/**
 * @fileoverview HTTP server entry point.
 * Starts the Express application and handles graceful shutdown.
 * @module server
 */

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const email = require('./services/email.service');

const server = app.listen(config.port, () => {
  logger.info(`SCM Backend running on port ${config.port} in ${config.env} mode`);
  // Surface a bad App Password at boot rather than on a user's first reset attempt.
  email.verifyConnection();
});

// -------------------------------------------------------------------
// Graceful shutdown
// -------------------------------------------------------------------

/**
 * Gracefully shut down the HTTP server.
 * Closes open connections and exits the process.
 * @param {string} signal - The OS signal that triggered shutdown.
 */
const shutdown = (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    logger.info('Server closed. Process terminating.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful close stalls
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = server;
