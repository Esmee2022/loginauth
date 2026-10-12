const { getDatabase } = require('../database/database');
const config = require('../config/environment');

function extractSession(req) {
  const token = req.cookies && req.cookies.saams_session;
  if (!token) return null;

  const db = getDatabase();
  const now = new Date().toISOString();

  const session = db.prepare(`
    SELECT s.id, s.user_id, s.expires_at, s.is_2fa_verified,
           u.id as uid, u.username, u.email, u.display_name, u.role, u.status
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(token, now);

  if (!session) return null;

  // Check account status
  if (session.status !== 'active') {
    return { accountInactive: true, status: session.status };
  }

  return {
    id: session.id,
    userId: session.user_id,
    is2faVerified: Boolean(session.is_2fa_verified),
    user: {
      id: session.uid,
      username: session.username,
      email: session.email,
      displayName: session.display_name,
      role: session.role,
      status: session.status
    }
  };
}

/**
 * Enforces fully authenticated session with 2FA completed
 */
function requireAuth(req, res, next) {
  const sessionData = extractSession(req);

  if (!sessionData) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication session required. Please sign in.'
    });
  }

  if (sessionData.accountInactive) {
    return res.status(403).json({
      error: 'ACCOUNT_INACTIVE',
      message: `Account is currently ${sessionData.status}. Contact an administrator.`
    });
  }

  // Check if 2FA has been verified for this session
  if (!sessionData.is2faVerified) {
    return res.status(403).json({
      error: '2FA_REQUIRED',
      message: 'Two-factor authentication verification is required to complete sign-in.'
    });
  }

  req.session = sessionData;
  req.user = sessionData.user;
  next();
}

/**
 * Allows partially authenticated session (stage 1 password verified, stage 2 pending)
 */
function requirePartialAuth(req, res, next) {
  const sessionData = extractSession(req);

  if (!sessionData) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Active authentication session required.'
    });
  }

  if (sessionData.accountInactive) {
    return res.status(403).json({
      error: 'ACCOUNT_INACTIVE',
      message: `Account is ${sessionData.status}.`
    });
  }

  req.session = sessionData;
  req.user = sessionData.user;
  next();
}

module.exports = {
  requireAuth,
  requirePartialAuth
};
