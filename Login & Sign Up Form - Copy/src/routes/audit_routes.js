const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit_controller');
const { requireAuth } = require('../middleware/auth_middleware');
const { requireRoles, ROLES } = require('../middleware/rbac_middleware');

router.use(requireAuth);
// Audit logs are strictly restricted to the Administrator role
router.use(requireRoles([ROLES.ADMINISTRATOR]));

router.get('/', auditController.listAuditLogs);

module.exports = router;
