const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config/environment');
const { getDatabase, closeDatabase } = require('./database/database');
const backupService = require('./services/backup_service');

const authRoutes = require('./routes/auth_routes');
const userRoutes = require('./routes/user_routes');
const recordsRoutes = require('./routes/records_routes');
const backupRoutes = require('./routes/backup_routes');
const auditRoutes = require('./routes/audit_routes');

const app = express();

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.ENABLE_HTTPS) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Parsers
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser(config.SESSION_SECRET));

// Health check endpoint (Safe, zero secret exposure)
app.get('/api/health', (req, res) => {
  try {
    const db = getDatabase();
    const test = db.prepare('SELECT 1 as alive').get();
    return res.json({
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      database: test.alive === 1 ? 'CONNECTED' : 'UNKNOWN',
      mode: 'LOCAL_OFFLINE_CAPABLE',
      backupEnabled: config.BACKUP_ENABLED
    });
  } catch (err) {
    return res.status(503).json({ status: 'UNHEALTHY', error: 'Database unavailable' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/audit', auditRoutes);

// Static frontend serving
app.use(express.static(path.resolve(__dirname, '..'), {
  index: 'index.html',
  maxAge: '1h'
}));

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('[UNHANDLED SERVER ERROR]', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal error occurred. Please contact the administrator.'
  });
});

// Initialize database
getDatabase();

// Background automated backup timer
if (config.BACKUP_ENABLED && config.BACKUP_INTERVAL_MINUTES > 0) {
  const intervalMs = config.BACKUP_INTERVAL_MINUTES * 60 * 1000;
  console.log(`[BACKUP SCHEDULER] Active. Interval: ${config.BACKUP_INTERVAL_MINUTES} minutes.`);
  setInterval(() => {
    console.log('[BACKUP SCHEDULER] Triggering scheduled database backup...');
    backupService.executeBackup().catch(err => {
      console.error('[BACKUP SCHEDULER ERROR]', err.message);
    });
  }, intervalMs).unref();
}

// Start Server
const server = app.listen(config.PORT, config.HOST, () => {
  console.log('================================================================');
  console.log(`SAAMS Server listening on http://${config.HOST}:${config.PORT}`);
  console.log(`Mode: ${config.NODE_ENV} | Primary DB: ${config.DATABASE_PATH}`);
  console.log(`Supabase Sync: ${config.SUPABASE_URL ? 'CONFIGURED' : 'OFFLINE'}`);
  console.log('================================================================');
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing HTTP server and database...`);
  server.close(() => {
    closeDatabase();
    console.log('[SHUTDOWN] Server stopped safely.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = { app, server };
