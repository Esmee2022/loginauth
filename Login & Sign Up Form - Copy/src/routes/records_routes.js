const express = require('express');
const router = express.Router();
const recordsController = require('../controllers/records_controller');
const { requireAuth } = require('../middleware/auth_middleware');
const { requireRoles, ROLES } = require('../middleware/rbac_middleware');

router.use(requireAuth);

// All authenticated roles can view permitted records
router.get('/', recordsController.listRecords);

// All authenticated roles can create draft records
router.post('/', recordsController.createRecord);

// Update/Approve record
router.patch('/:id', recordsController.updateRecord);

module.exports = router;
