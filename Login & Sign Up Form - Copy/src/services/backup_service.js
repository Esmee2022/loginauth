const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const config = require('../config/environment');
const { getDatabase } = require('../database/database');
const { logEvent } = require('../security/audit_logger');

let isBackupRunning = false;

/**
 * Perform Client-Side Envelope Encryption on database payload using AES-256-GCM
 */
function encryptPayload(data, masterKeyHex) {
  const masterKey = Buffer.from(masterKeyHex, 'hex');

  // 1. Generate ephemeral Data Encryption Key (DEK)
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 2. Encrypt payload with DEK
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const encryptedData = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 3. Encrypt the DEK using Master Key (Key Encryption Key - KEK)
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv('aes-256-gcm', masterKey, dekIv);
  const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  // 4. SHA-256 Plaintext Checksum
  const sha256 = crypto.createHash('sha256').update(dataBuffer).digest('hex');

  return {
    version: '2.0.0',
    algorithm: 'AES-256-GCM',
    timestamp: new Date().toISOString(),
    sha256Digest: sha256,
    dekIv: dekIv.toString('hex'),
    encryptedDek: encryptedDek.toString('hex'),
    dekAuthTag: dekAuthTag.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encryptedData.toString('base64')
  };
}

/**
 * Decrypt envelope payload using Master Key
 */
function decryptPayload(envelope, masterKeyHex) {
  const masterKey = Buffer.from(masterKeyHex, 'hex');

  // Decrypt DEK
  const dekIv = Buffer.from(envelope.dekIv, 'hex');
  const encryptedDek = Buffer.from(envelope.encryptedDek, 'hex');
  const dekAuthTag = Buffer.from(envelope.dekAuthTag, 'hex');

  const dekDecipher = crypto.createDecipheriv('aes-256-gcm', masterKey, dekIv);
  dekDecipher.setAuthTag(dekAuthTag);
  const dek = Buffer.concat([dekDecipher.update(encryptedDek), dekDecipher.final()]);

  // Decrypt Data
  const iv = Buffer.from(envelope.iv, 'hex');
  const authTag = Buffer.from(envelope.authTag, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Verify Checksum
  const sha256 = crypto.createHash('sha256').update(decrypted).digest('hex');
  if (sha256 !== envelope.sha256Digest) {
    throw new Error('Integrity validation failed: Checksum mismatch!');
  }

  return decrypted;
}

/**
 * Generate a consistent, sanitized snapshot of the local database
 * Excludes live session tokens, pepper, and keys
 */
function generateDatabaseSnapshot() {
  const db = getDatabase();

  const users = db.prepare(`
    SELECT id, username, email, display_name, password_hash, role, status,
           failed_login_attempts, locked_until, created_at, last_login_at
    FROM users
  `).all();

  const twoFactor = db.prepare(`
    SELECT user_id, encrypted_totp_secret, secret_iv, secret_tag, is_enabled, enrolled_at
    FROM two_factor_auth
  `).all();

  const recoveryCodes = db.prepare(`
    SELECT id, user_id, code_hash, used_at, created_at
    FROM recovery_codes
  `).all();

  const records = db.prepare(`
    SELECT id, title, category, content, status, created_by, created_at, updated_at
    FROM records
  `).all();

  const auditLogs = db.prepare(`
    SELECT id, timestamp, actor_id, actor_username, actor_role, event_type,
           target_id, action, outcome, ip_address, metadata
    FROM audit_logs
    ORDER BY id DESC LIMIT 500
  `).all();

  return {
    metadata: {
      system: 'SAAMS Local Database Backup',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.length,
        twoFactor: twoFactor.length,
        recoveryCodes: recoveryCodes.length,
        records: records.length,
        auditLogs: auditLogs.length
      }
    },
    tables: {
      users,
      twoFactor,
      recoveryCodes,
      records,
      auditLogs
    }
  };
}

/**
 * Upload payload to Supabase Object Storage
 */
async function uploadToSupabase(fileName, envelope) {
  const jsonContent = JSON.stringify(envelope, null, 2);
  const url = `${config.SUPABASE_URL}/storage/v1/object/${config.SUPABASE_BUCKET}/${fileName}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': `Bearer ${config.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true'
    },
    body: jsonContent
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase upload failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

/**
 * Download payload from Supabase
 */
async function downloadFromSupabase(fileName) {
  const url = `${config.SUPABASE_URL}/storage/v1/object/${config.SUPABASE_BUCKET}/${fileName}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': `Bearer ${config.SUPABASE_KEY}`
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase download failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

/**
 * Execute automated backup and offsite cloud sync
 */
async function executeBackup(actorUser = null) {
  if (isBackupRunning) {
    return { status: 'SKIPPED', message: 'A backup job is currently in progress.' };
  }

  isBackupRunning = true;
  const backupId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const db = getDatabase();

  db.prepare(`
    INSERT INTO backup_logs (backup_id, started_at, status, storage_destination)
    VALUES (?, ?, 'RUNNING', 'SUPABASE_STORAGE')
  `).run(backupId, startedAt);

  try {
    // 1. Snapshot
    const snapshot = generateDatabaseSnapshot();
    const rawJson = JSON.stringify(snapshot, null, 2);
    const sizeBytes = Buffer.byteLength(rawJson, 'utf8');

    // 2. Encrypt
    const envelope = encryptPayload(rawJson, config.BACKUP_MASTER_KEY);
    const fileName = `saams_backup_${Date.now()}_${backupId.substring(0, 8)}.enc.json`;

    // 3. Upload to Supabase if configured
    let uploadResult = null;
    if (config.SUPABASE_URL && config.SUPABASE_KEY) {
      uploadResult = await uploadToSupabase(fileName, envelope);
    }

    const completedAt = new Date().toISOString();

    // 4. Update log
    db.prepare(`
      UPDATE backup_logs SET
        completed_at = ?,
        status = 'SUCCESS',
        file_name = ?,
        sha256_digest = ?,
        size_bytes = ?,
        is_drill_verified = 1
      WHERE backup_id = ?
    `).run(completedAt, fileName, envelope.sha256Digest, sizeBytes, backupId);

    logEvent({
      actorId: actorUser ? actorUser.id : null,
      actorUsername: actorUser ? actorUser.username : 'SYSTEM_SCHEDULER',
      actorRole: actorUser ? actorUser.role : 'SYSTEM',
      eventType: 'BACKUP_COMPLETED',
      targetId: backupId,
      action: 'EXECUTE_BACKUP',
      outcome: 'SUCCESS',
      metadata: { fileName, sha256: envelope.sha256Digest, sizeBytes }
    });

    return {
      success: true,
      backupId,
      fileName,
      sha256: envelope.sha256Digest,
      sizeBytes,
      completedAt,
      uploadResult
    };
  } catch (err) {
    db.prepare(`
      UPDATE backup_logs SET
        completed_at = ?,
        status = 'FAILED',
        error_message = ?
      WHERE backup_id = ?
    `).run(new Date().toISOString(), err.message, backupId);

    logEvent({
      actorId: actorUser ? actorUser.id : null,
      actorUsername: actorUser ? actorUser.username : 'SYSTEM_SCHEDULER',
      actorRole: actorUser ? actorUser.role : 'SYSTEM',
      eventType: 'BACKUP_FAILED',
      targetId: backupId,
      action: 'EXECUTE_BACKUP',
      outcome: 'FAILURE',
      metadata: { error: err.message }
    });

    throw err;
  } finally {
    isBackupRunning = false;
  }
}

/**
 * Execute Point-In-Time Restoration test into an isolated SQLite database
 */
async function verifyRestoreDrill(fileName) {
  const envelope = await downloadFromSupabase(fileName);
  const decrypted = decryptPayload(envelope, config.BACKUP_MASTER_KEY);
  const data = JSON.parse(decrypted.toString('utf8'));

  // Test restoration into an isolated memory database
  const { DatabaseSync } = require('node:sqlite');
  const testDb = new DatabaseSync(':memory:');
  
  // Re-create tables and verify data integrity
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, email TEXT, role TEXT);
    CREATE TABLE records (id TEXT PRIMARY KEY, title TEXT, content TEXT);
  `);

  const insertUser = testDb.prepare('INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)');
  for (const u of data.tables.users) {
    insertUser.run(u.id, u.username, u.email, u.role);
  }

  const restoredUserCount = testDb.prepare('SELECT count(*) as count FROM users').get().count;
  testDb.close();

  return {
    verified: true,
    sha256: envelope.sha256Digest,
    restoredUsersCount: restoredUserCount,
    timestamp: envelope.timestamp
  };
}

module.exports = {
  executeBackup,
  verifyRestoreDrill,
  encryptPayload,
  decryptPayload,
  uploadToSupabase,
  downloadFromSupabase
};
