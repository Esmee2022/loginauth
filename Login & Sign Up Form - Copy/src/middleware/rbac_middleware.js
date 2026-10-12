const { logEvent } = require('../security/audit_logger');

const ROLES = {
  INPUTER: 'inputer',
  ADMIN: 'admin',
  ADMINISTRATOR: 'administrator',
  MANAGER: 'manager'
};

/**
 * Enforce allowed roles on endpoint with strict deny-by-default
 */
function requireRoles(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      // Audit log the authorization failure
      logEvent({
        actorId: req.user.id,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        eventType: 'ACCESS_DENIED',
        targetId: req.originalUrl,
        action: `HTTP ${req.method} ${req.originalUrl}`,
        outcome: 'FAILURE',
        ipAddress: req.ip,
        metadata: { requiredRoles: allowedRoles, userRole: req.user.role }
      });

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Access denied: You do not have sufficient permissions to perform this action.'
      });
    }

    next();
  };
}

module.exports = {
  ROLES,
  requireRoles
};
