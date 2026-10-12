const { getDatabase } = require('../database/database');

function listAuditLogs(req, res) {
  const db = getDatabase();
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);

  return res.json({ logs });
}

module.exports = {
  listAuditLogs
};
