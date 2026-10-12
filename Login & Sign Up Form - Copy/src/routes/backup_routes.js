const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backup_controller');
const { requireAuth } = require('../middleware/auth_middleware');
const { requireRoles, ROLES } = require('../middleware/rbac_middleware');

router.use(requireAuth);
// Backups are strictly restricted to the Administrator role
router.use(requireRoles([ROLES.ADMINISTRATOR]));

router.post('/trigger', backupController.triggerBackup);
router.get('/history', backupController.listBackups);
router.post('/test-restore', backupController.testRestore);

module.exports = router;
