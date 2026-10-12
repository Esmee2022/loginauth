const crypto = require('crypto');
const { getDatabase } = require('../database/database');
const cryptoService = require('../security/crypto_service');
const { logEvent } = require('../security/audit_logger');

/**
 * List users (Filtered by role permissions)
 */
function listUsers(req, res) {
  const db = getDatabase();
  const currentRole = req.user.role;

  let query = 'SELECT id, username, email, display_name, role, status, created_at, last_login_at FROM users';
  const params = [];

  // Managers can view inputers and managers
  if (currentRole === 'manager') {
    query += ' WHERE role IN (?, ?)';
    params.push('inputer', 'manager');
  } else if (currentRole === 'admin') {
    // Admins can view inputers and admins
    query += ' WHERE role IN (?, ?, ?)';
    params.push('inputer', 'admin', 'manager');
  }
  // Administrators can view all users

  query += ' ORDER BY created_at DESC';
  const users = db.prepare(query).all(...params);

  return res.json({ users });
}

/**
 * Create a new user account (Manager can only create Inputer; Administrator can create any role)
 */
async function createUser(req, res) {
  const { username, email, fullName, password, role } = req.body;
  const actor = req.user;

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'All fields are required.' });
  }

  const targetRole = role || 'inputer';

  // Role creation boundary enforcement
  if (actor.role === 'manager' && targetRole !== 'inputer') {
    logEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      eventType: 'PRIVILEGE_VIOLATION',
      action: 'CREATE_USER_FORBIDDEN_ROLE',
      outcome: 'FAILURE',
      ipAddress: req.ip,
      metadata: { attemptedRole: targetRole }
    });
    return res.status(403).json({
      error: 'ROLE_CREATION_DENIED',
      message: 'Managers are only permitted to provision Inputer accounts.'
    });
  }

  if (actor.role === 'admin' && !['inputer'].includes(targetRole)) {
    return res.status(403).json({
      error: 'ROLE_CREATION_DENIED',
      message: 'Admins cannot create elevated administrator accounts.'
    });
  }

  try {
    cryptoService.validatePasswordStrength(password);
  } catch (err) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: err.message });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim().toLowerCase();
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(cleanEmail, cleanUsername);
  if (existing) {
    return res.status(400).json({ error: 'ALREADY_EXISTS', message: 'Username or email already exists.' });
  }

  const passwordHash = await cryptoService.hashPassword(password);
  const newUserId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(newUserId, cleanUsername, cleanEmail, fullName.trim(), passwordHash, targetRole, now);

  logEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    eventType: 'USER_CREATED',
    targetId: newUserId,
    action: 'CREATE_USER',
    outcome: 'SUCCESS',
    ipAddress: req.ip,
    metadata: { createdRole: targetRole, username: cleanUsername }
  });

  return res.status(201).json({
    success: true,
    message: `User ${cleanUsername} successfully created with role ${targetRole}.`,
    user: { id: newUserId, username: cleanUsername, email: cleanEmail, role: targetRole }
  });
}

/**
 * Toggle user account status (active, disabled, locked)
 */
function updateAccountStatus(req, res) {
  const { userId } = req.params;
  const { status } = req.body;
  const actor = req.user;

  if (!['active', 'disabled', 'locked'].includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS', message: 'Status must be active, disabled, or locked.' });
  }

  const db = getDatabase();
  const targetUser = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(userId);

  if (!targetUser) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Target user not found.' });
  }

  // Self modification prevention
  if (targetUser.id === actor.id) {
    return res.status(400).json({ error: 'SELF_MODIFICATION', message: 'Cannot alter your own account status.' });
  }

  // RBAC permissions boundary:
  // Admin can ONLY deactivate/lock inputers
  if (actor.role === 'admin' && targetUser.role !== 'inputer') {
    logEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      eventType: 'PRIVILEGE_VIOLATION',
      targetId: targetUser.id,
      action: 'UPDATE_STATUS_DENIED',
      outcome: 'FAILURE',
      ipAddress: req.ip,
      metadata: { targetRole: targetUser.role }
    });
    return res.status(403).json({
      error: 'PERMISSION_DENIED',
      message: 'Admins are only permitted to alter status of Inputer accounts.'
    });
  }

  db.prepare('UPDATE users SET status = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(status, userId);

  // If disabling, terminate active sessions
  if (status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  logEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    eventType: 'ACCOUNT_STATUS_CHANGED',
    targetId: targetUser.id,
    action: `SET_STATUS_${status.toUpperCase()}`,
    outcome: 'SUCCESS',
    ipAddress: req.ip,
    metadata: { targetUsername: targetUser.username, previousStatus: targetUser.status, newStatus: status }
  });

  return res.json({
    success: true,
    message: `Account status for ${targetUser.username} set to ${status}.`
  });
}

module.exports = {
  listUsers,
  createUser,
  updateAccountStatus
};
