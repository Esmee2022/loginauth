const crypto = require('crypto');
const { getDatabase } = require('../database/database');
const cryptoService = require('../security/crypto_service');
const totpService = require('../security/totp_service');
const { logEvent } = require('../security/audit_logger');
const config = require('../config/environment');
const { recordSuccessfulLogin } = require('../services/login_backup_service');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function createSessionCookie(res, sessionId) {
  const maxAgeMs = config.SESSION_TTL_MINUTES * 60 * 1000;
  res.cookie('saams_session', sessionId, {
    httpOnly: true,
    secure: config.ENABLE_HTTPS,
    sameSite: 'strict',
    maxAge: maxAgeMs,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie('saams_session', {
    httpOnly: true,
    secure: config.ENABLE_HTTPS,
    sameSite: 'strict',
    path: '/'
  });
}

/**
 * Public User Registration (Defaults to 'inputer' role)
 */
async function register(req, res) {
  const { username, email, fullName, password } = req.body;

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'All registration fields are required.' });
  }

  const cleanEmail = normalizeEmail(email);
  const cleanUsername = normalizeUsername(username);

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Please provide a valid email address.' });
  }

  // Password strength check
  try {
    cryptoService.validatePasswordStrength(password);
  } catch (err) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: err.message });
  }

  const db = getDatabase();

  // Check uniqueness without leaking details
  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(cleanEmail, cleanUsername);
  if (existing) {
    return res.status(400).json({ error: 'REGISTRATION_FAILED', message: 'Username or email already in use.' });
  }

  // Hash password using Argon2id + salt + pepper
  const passwordHash = await cryptoService.hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Check if this is the very first user in the database (bootstrap administrator)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const assignedRole = userCount === 0 ? 'administrator' : 'inputer';

  db.prepare(`
    INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(userId, cleanUsername, cleanEmail, fullName.trim(), passwordHash, assignedRole, now);

  logEvent({
    actorId: userId,
    actorUsername: cleanUsername,
    actorRole: assignedRole,
    eventType: 'USER_REGISTERED',
    targetId: userId,
    action: 'REGISTER_ACCOUNT',
    outcome: 'SUCCESS',
    ipAddress: req.ip,
    metadata: { role: assignedRole }
  });

  return res.status(201).json({
    success: true,
    message: 'Account successfully registered. Please sign in.',
    role: assignedRole
  });
}

/**
 * Stage 1 Login (Password verification)
 */
async function login(req, res) {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Identifier and password are required.' });
  }

  const cleanIdentifier = String(identifier).trim().toLowerCase();
  const db = getDatabase();

  const user = db.prepare(`
    SELECT id, username, email, display_name, password_hash, role, status, failed_login_attempts, locked_until
    FROM users
    WHERE email = ? OR username = ?
  `).get(cleanIdentifier, cleanIdentifier);

  const genericFailMessage = 'Invalid username, email, or password.';

  // If user not found, perform dummy hash check to prevent timing analysis
  if (!user) {
    res.locals.recordFailedAttempt && res.locals.recordFailedAttempt();
    await cryptoService.verifyPassword('dummyPassword123!', '$argon2id$v=19$m=32768,t=2,p=1$c2FtcGxlc2FsdA$fakehashfakehashfakehashfakehashfakehash');
    logEvent({
      eventType: 'AUTH_FAILED',
      action: 'LOGIN_ATTEMPT',
      outcome: 'FAILURE',
      ipAddress: req.ip,
      metadata: { reason: 'USER_NOT_FOUND' }
    });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: genericFailMessage });
  }

  // Check account lock/disabled status
  if (user.status !== 'active') {
    logEvent({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      eventType: 'AUTH_DENIED',
      action: 'LOGIN_ATTEMPT',
      outcome: 'FAILURE',
      ipAddress: req.ip,
      metadata: { status: user.status }
    });
    return res.status(403).json({
      error: 'ACCOUNT_LOCKED',
      message: `Account is currently ${user.status}. Please contact an administrator.`
    });
  }

  // Verify password using Argon2id with pepper
  const passwordValid = await cryptoService.verifyPassword(password, user.password_hash);

  if (!passwordValid) {
    res.locals.recordFailedAttempt && res.locals.recordFailedAttempt();

    const newFailedCount = (user.failed_login_attempts || 0) + 1;
    let newStatus = user.status;
    let lockedUntil = null;

    if (newFailedCount >= 5) {
      newStatus = 'locked';
      lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    }

    db.prepare(`
      UPDATE users SET failed_login_attempts = ?, status = ?, locked_until = ? WHERE id = ?
    `).run(newFailedCount, newStatus, lockedUntil, user.id);

    logEvent({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      eventType: 'AUTH_FAILED',
      action: 'LOGIN_ATTEMPT',
      outcome: 'FAILURE',
      ipAddress: req.ip,
      metadata: { failedAttempts: newFailedCount }
    });

    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: genericFailMessage });
  }

  // Reset failed attempts on success
  res.locals.clearAttempts && res.locals.clearAttempts();
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  // Check 2FA Status
  const twoFactor = db.prepare('SELECT is_enabled FROM two_factor_auth WHERE user_id = ?').get(user.id);
  const requires2fa = Boolean(twoFactor && twoFactor.is_enabled);

  // Create session
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const is2faVerified = requires2fa ? 0 : 1;

  db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at, ip_address, user_agent, is_2fa_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, user.id, now.toISOString(), expiresAt, req.ip, req.headers['user-agent'] || '', is2faVerified);

  createSessionCookie(res, sessionId);

  if (requires2fa) {
    logEvent({
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      eventType: 'AUTH_STAGE_1_SUCCESS',
      action: 'PASSWORD_VERIFIED',
      outcome: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { nextStep: '2FA_VERIFICATION' }
    });

    return res.json({
      success: true,
      requires2fa: true,
      message: 'Password verified. Please enter your 2FA authenticator code.'
    });
  }

  // Update last login
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), user.id);

  logEvent({
    actorId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
    eventType: 'LOGIN_SUCCESS',
    action: 'SESSION_ESTABLISHED',
    outcome: 'SUCCESS',
    ipAddress: req.ip
  });

  await recordSuccessfulLogin(user);

  return res.json({
    success: true,
    requires2fa: false,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role
    }
  });
}

/**
 * Stage 2 Login (2FA verification via TOTP)
 */
async function verify2faLogin(req, res) {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'MISSING_CODE', message: 'Six-digit verification code is required.' });
  }

  const db = getDatabase();
  const twoFactor = db.prepare(`
    SELECT encrypted_totp_secret, secret_iv, secret_tag, is_enabled
    FROM two_factor_auth
    WHERE user_id = ?
  `).get(req.user.id);

  if (!twoFactor || !twoFactor.is_enabled) {
    return res.status(400).json({ error: '2FA_NOT_ENABLED', message: 'Two-factor authentication is not active.' });
  }

  // Decrypt stored TOTP secret
  const decryptedSecret = cryptoService.decryptTotpSecret(
    twoFactor.encrypted_totp_secret,
    twoFactor.secret_iv,
    twoFactor.secret_tag
  );

  const isValid = totpService.verifyTotpToken(decryptedSecret, code);

  if (!isValid) {
    res.locals.recordFailedAttempt && res.locals.recordFailedAttempt();
    logEvent({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      eventType: '2FA_FAILED',
      action: 'TOTP_VERIFICATION',
      outcome: 'FAILURE',
      ipAddress: req.ip
    });
    return res.status(401).json({ error: 'INVALID_2FA_CODE', message: 'Invalid or expired 2FA verification code.' });
  }

  // Mark session as 2FA verified
  db.prepare('UPDATE sessions SET is_2fa_verified = 1 WHERE id = ?').run(req.session.id);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), req.user.id);

  logEvent({
    actorId: req.user.id,
    actorUsername: req.user.username,
    actorRole: req.user.role,
    eventType: '2FA_SUCCESS',
    action: 'LOGIN_COMPLETED',
    outcome: 'SUCCESS',
    ipAddress: req.ip
  });

  await recordSuccessfulLogin(req.user);

  return res.json({
    success: true,
    message: 'Two-factor verification successful. Sign-in complete.',
    user: req.user
  });
}

/**
 * 2FA Recovery Code Login Fallback
 */
async function verifyRecoveryCode(req, res) {
  const { recoveryCode } = req.body;
  if (!recoveryCode) {
    return res.status(400).json({ error: 'MISSING_CODE', message: 'Recovery code is required.' });
  }

  const db = getDatabase();
  const unusedCodes = db.prepare(`
    SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL
  `).all(req.user.id);

  let matchedId = null;
  for (const item of unusedCodes) {
    if (cryptoService.verifyRecoveryCode(recoveryCode, item.code_hash)) {
      matchedId = item.id;
      break;
    }
  }

  if (!matchedId) {
    res.locals.recordFailedAttempt && res.locals.recordFailedAttempt();
    logEvent({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      eventType: 'RECOVERY_CODE_FAILED',
      action: 'RECOVERY_VERIFICATION',
      outcome: 'FAILURE',
      ipAddress: req.ip
    });
    return res.status(401).json({ error: 'INVALID_RECOVERY_CODE', message: 'Invalid or already utilized recovery code.' });
  }

  // Invalidate the matched recovery code immediately
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(new Date().toISOString(), matchedId);
  db.prepare('UPDATE sessions SET is_2fa_verified = 1 WHERE id = ?').run(req.session.id);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), req.user.id);

  logEvent({
    actorId: req.user.id,
    actorUsername: req.user.username,
    actorRole: req.user.role,
    eventType: 'RECOVERY_CODE_SUCCESS',
    action: 'RECOVERY_LOGIN',
    outcome: 'SUCCESS',
    ipAddress: req.ip
  });

  await recordSuccessfulLogin(req.user);

  return res.json({
    success: true,
    message: 'Emergency recovery code verified. Sign-in complete.',
    user: req.user
  });
}

/**
 * Initialize 2FA Enrollment (Generates QR Code & Recovery Codes)
 */
async function setup2fa(req, res) {
  const bundle = await totpService.generateTotpSetup(req.user.email);
  const db = getDatabase();

  // Save/Update in two_factor_auth (disabled until verified)
  db.prepare(`
    INSERT INTO two_factor_auth (user_id, encrypted_totp_secret, secret_iv, secret_tag, is_enabled)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_totp_secret = excluded.encrypted_totp_secret,
      secret_iv = excluded.secret_iv,
      secret_tag = excluded.secret_tag,
      is_enabled = 0
  `).run(req.user.id, bundle.encryptedSecret, bundle.secretIv, bundle.secretTag);

  // Clear previous recovery codes and store new hashed recovery codes
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(req.user.id);

  const insertRecovery = db.prepare(`
    INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const code of bundle.recoveryCodes) {
    const codeHash = cryptoService.hashRecoveryCode(code);
    insertRecovery.run(req.user.id, codeHash, now);
  }

  return res.json({
    qrCodeDataUrl: bundle.qrCodeDataUrl,
    rawSecret: bundle.rawSecret,
    recoveryCodes: bundle.recoveryCodes
  });
}

/**
 * Confirm 2FA Enrollment by verifying initial token
 */
async function confirm2faEnrollment(req, res) {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'MISSING_CODE', message: 'Verification code is required.' });
  }

  const db = getDatabase();
  const twoFactor = db.prepare(`
    SELECT encrypted_totp_secret, secret_iv, secret_tag FROM two_factor_auth WHERE user_id = ?
  `).get(req.user.id);

  if (!twoFactor) {
    return res.status(400).json({ error: 'SETUP_NOT_INITIATED', message: 'Please initialize 2FA enrollment first.' });
  }

  const decryptedSecret = cryptoService.decryptTotpSecret(
    twoFactor.encrypted_totp_secret,
    twoFactor.secret_iv,
    twoFactor.secret_tag
  );

  const isValid = totpService.verifyTotpToken(decryptedSecret, code);
  if (!isValid) {
    return res.status(400).json({ error: 'INVALID_CODE', message: 'Invalid code. Check your authenticator app.' });
  }

  // Activate 2FA
  db.prepare(`
    UPDATE two_factor_auth SET is_enabled = 1, enrolled_at = ? WHERE user_id = ?
  `).run(new Date().toISOString(), req.user.id);

  // Upgrade session to 2FA verified
  db.prepare('UPDATE sessions SET is_2fa_verified = 1 WHERE id = ?').run(req.session.id);

  logEvent({
    actorId: req.user.id,
    actorUsername: req.user.username,
    actorRole: req.user.role,
    eventType: '2FA_ENROLLED',
    action: 'ENABLE_2FA',
    outcome: 'SUCCESS',
    ipAddress: req.ip
  });

  return res.json({
    success: true,
    message: 'Two-factor authentication successfully enabled on your account.'
  });
}

/**
 * Terminate current user session
 */
function logout(req, res) {
  if (req.session) {
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
    logEvent({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      eventType: 'LOGOUT',
      action: 'USER_LOGOUT',
      outcome: 'SUCCESS',
      ipAddress: req.ip
    });
  }
  clearSessionCookie(res);
  return res.json({ success: true, message: 'Successfully logged out.' });
}

/**
 * Get current authenticated user profile
 */
function me(req, res) {
  const db = getDatabase();
  const twoFactor = db.prepare('SELECT is_enabled, enrolled_at FROM two_factor_auth WHERE user_id = ?').get(req.user.id);

  return res.json({
    user: req.user,
    twoFactor: {
      enabled: Boolean(twoFactor && twoFactor.is_enabled),
      enrolledAt: twoFactor ? twoFactor.enrolled_at : null
    }
  });
}

module.exports = {
  register,
  login,
  verify2faLogin,
  verifyRecoveryCode,
  setup2fa,
  confirm2faEnrollment,
  logout,
  me
};
