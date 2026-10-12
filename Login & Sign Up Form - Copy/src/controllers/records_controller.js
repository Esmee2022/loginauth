const crypto = require('crypto');
const { getDatabase } = require('../database/database');
const { logEvent } = require('../security/audit_logger');

/**
 * List operational records based on role
 */
function listRecords(req, res) {
  const db = getDatabase();
  const actor = req.user;

  let query = 'SELECT r.*, u.username as creator_username FROM records r JOIN users u ON r.created_by = u.id';
  const params = [];

  if (actor.role === 'inputer') {
    query += ' WHERE r.created_by = ?';
    params.push(actor.id);
  }

  query += ' ORDER BY r.created_at DESC';
  const records = db.prepare(query).all(...params);

  return res.json({ records });
}

/**
 * Create a new operational record
 */
function createRecord(req, res) {
  const { title, category, content } = req.body;
  const actor = req.user;

  if (!title || !category || !content) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Title, category, and content are required.' });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDatabase();

  db.prepare(`
    INSERT INTO records (id, title, category, content, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, title.trim(), category.trim(), content.trim(), actor.id, now, now);

  logEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    eventType: 'RECORD_CREATED',
    targetId: id,
    action: 'CREATE_RECORD',
    outcome: 'SUCCESS',
    ipAddress: req.ip,
    metadata: { title }
  });

  return res.status(201).json({
    success: true,
    message: 'Record created successfully.',
    record: { id, title, category, status: 'draft', createdAt: now }
  });
}

/**
 * Update a record (Inputer edits own drafts; Manager can approve/reject)
 */
function updateRecord(req, res) {
  const { id } = req.params;
  const { title, content, status } = req.body;
  const actor = req.user;

  const db = getDatabase();
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);

  if (!record) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Record not found.' });
  }

  // Inputer can only edit their own draft records
  if (actor.role === 'inputer') {
    if (record.created_by !== actor.id) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot edit records created by another user.' });
    }
    if (record.status !== 'draft') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot edit submitted or approved records.' });
    }

    db.prepare(`
      UPDATE records SET title = coalesce(?, title), content = coalesce(?, content), updated_at = ?
      WHERE id = ?
    `).run(title, content, new Date().toISOString(), id);
  } else if (['manager', 'admin', 'administrator'].includes(actor.role)) {
    // Managers/Admins can update status (approve / reject)
    const newStatus = status || record.status;
    db.prepare(`
      UPDATE records SET title = coalesce(?, title), content = coalesce(?, content), status = ?, updated_at = ?
      WHERE id = ?
    `).run(title, content, newStatus, new Date().toISOString(), id);
  }

  logEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    eventType: 'RECORD_UPDATED',
    targetId: id,
    action: 'UPDATE_RECORD',
    outcome: 'SUCCESS',
    ipAddress: req.ip,
    metadata: { newStatus: status }
  });

  return res.json({ success: true, message: 'Record updated successfully.' });
}

module.exports = {
  listRecords,
  createRecord,
  updateRecord
};
