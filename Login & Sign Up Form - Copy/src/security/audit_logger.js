const { getDatabase } = require('../database/database');

// Sensitive keys that must NEVER be written to audit logs
const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'pepper',
  'secret',
  'encrypted_totp_secret',
  'token',
  'recovery_code',
  'recovery_codes',
  'code_hash',
  'session_token',
  'api_key'
];

function sanitizeMetadata(data) {
  if (!data || typeof data !== 'object') return data;
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function logEvent({
  actorId = null,
  actorUsername = null,
  actorRole = null,
  eventType,
  targetId = null,
  action,
  outcome = 'SUCCESS',
  ipAddress = null,
  metadata = null
}) {
  try {
    const db = getDatabase();
    const cleanMeta = metadata ? JSON.stringify(sanitizeMetadata(metadata)) : null;

    db.prepare(`
      INSERT INTO audit_logs (
        timestamp, actor_id, actor_username, actor_role,
        event_type, target_id, action, outcome, ip_address, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      actorId,
      actorUsername,
      actorRole,
      eventType,
      targetId,
      action,
      outcome,
      ipAddress,
      cleanMeta
    );
  } catch (err) {
    console.error('[AUDIT LOGGING FAILURE]', err.message);
  }
}

module.exports = {
  logEvent
};
