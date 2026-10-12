const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true';

const DATABASE_PATH = path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/saams.db');
const SESSION_TTL_MINUTES = parseInt(process.env.SESSION_TTL_MINUTES || '120', 10);

const PEPPER_SECRET = process.env.PEPPER_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY;
const BACKUP_MASTER_KEY = process.env.BACKUP_MASTER_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yzjalvfrgfvyjknpjrju.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'encrypted-backups';
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const BACKUP_INTERVAL_MINUTES = parseInt(process.env.BACKUP_INTERVAL_MINUTES || '360', 10);
const BACKUP_RETENTION_COUNT = parseInt(process.env.BACKUP_RETENTION_COUNT || '10', 10);

// Validate cryptographic secrets at startup
function validateEnvironment() {
  const missing = [];
  if (!PEPPER_SECRET) missing.push('PEPPER_SECRET');
  if (!SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!TOTP_ENCRYPTION_KEY) missing.push('TOTP_ENCRYPTION_KEY');
  if (!BACKUP_MASTER_KEY) missing.push('BACKUP_MASTER_KEY');

  if (missing.length > 0) {
    throw new Error(
      `[SECURITY HALT] Critical server configuration missing: ${missing.join(', ')}.\n` +
      'Check your .env file or run the environment setup instructions.'
    );
  }

  // Ensure database directory exists
  const dbDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }
}

validateEnvironment();

module.exports = {
  NODE_ENV,
  PORT,
  HOST,
  ENABLE_HTTPS,
  DATABASE_PATH,
  SESSION_TTL_MINUTES,
  PEPPER_SECRET,
  SESSION_SECRET,
  TOTP_ENCRYPTION_KEY,
  BACKUP_MASTER_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_BUCKET,
  BACKUP_ENABLED,
  BACKUP_INTERVAL_MINUTES,
  BACKUP_RETENTION_COUNT
};
