const backupService = require('../services/backup_service');
const { getDatabase } = require('../database/database');

async function triggerBackup(req, res) {
  try {
    const result = await backupService.executeBackup(req.user);
    return res.json({
      success: true,
      message: 'Automated encrypted backup successfully executed and synced to Supabase.',
      result
    });
  } catch (err) {
    return res.status(500).json({
      error: 'BACKUP_FAILED',
      message: err.message
    });
  }
}

function listBackups(req, res) {
  const db = getDatabase();
  const logs = db.prepare('SELECT * FROM backup_logs ORDER BY started_at DESC LIMIT 50').all();
  return res.json({ backups: logs });
}

async function testRestore(req, res) {
  const { fileName } = req.body;
  if (!fileName) {
    return res.status(400).json({ error: 'MISSING_FILENAME', message: 'Target backup fileName is required.' });
  }

  try {
    const drill = await backupService.verifyRestoreDrill(fileName);
    return res.json({
      success: true,
      message: 'Restoration drill verified into isolated database. SHA-256 match confirmed.',
      drill
    });
  } catch (err) {
    return res.status(500).json({
      error: 'RESTORE_DRILL_FAILED',
      message: err.message
    });
  }
}

module.exports = {
  triggerBackup,
  listBackups,
  testRestore
};
