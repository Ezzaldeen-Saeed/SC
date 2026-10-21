/**
 * @fileoverview Express application setup and configuration.
 * Assembles middleware, routes, and error handling into the app instance.
 * @module app
 */

require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const corsOptions = require('./config/cors');
const { apiLimiter, eventsLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const ApiError = require('./utils/ApiError');

// Route imports
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const managerRoutes = require('./modules/manager/manager.routes');
const supervisorRoutes = require('./modules/supervisor/supervisor.routes');
const agentRoutes = require('./modules/agent/agent.routes');
const eventsRoutes = require('./modules/events/events.routes');
const liveRoutes = require('./modules/live/live.routes');

const app = express();

// -------------------------------------------------------------------
// Security middleware
// -------------------------------------------------------------------
app.use(helmet());
app.use(cors(corsOptions));

// -------------------------------------------------------------------
// Body parsing
// -------------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -------------------------------------------------------------------
// Logging
// -------------------------------------------------------------------
app.use(requestLogger);

// -------------------------------------------------------------------
// Real-time notification stream (Server-Sent Events).
// Mounted BEFORE the shared API limiter with its own dedicated limiter, so the
// long-lived stream and its reconnects use a separate budget and can never
// exhaust the general /api/ quota (which would 429 normal dashboard requests).
// -------------------------------------------------------------------
app.use('/api/events', eventsLimiter, eventsRoutes);

// -------------------------------------------------------------------
// Rate limiting (applied to all other /api/* routes)
// -------------------------------------------------------------------
app.use('/api/', apiLimiter);

// -------------------------------------------------------------------
// Health check
// -------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// -------------------------------------------------------------------
// API Routes
// -------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/live', liveRoutes);

// -------------------------------------------------------------------
// 404 handler – catch unmatched routes
// -------------------------------------------------------------------
app.use((req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
});

// -------------------------------------------------------------------
// Global error handler (MUST be registered last)
// -------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
