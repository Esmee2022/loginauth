const express = require('express');
const router = express.Router();
const userController = require('../controllers/user_controller');
const { requireAuth } = require('../middleware/auth_middleware');
const { requireRoles, ROLES } = require('../middleware/rbac_middleware');

router.use(requireAuth);

// List users: Managers, Admins, Administrators
router.get('/', requireRoles([ROLES.MANAGER, ROLES.ADMIN, ROLES.ADMINISTRATOR]), userController.listUsers);

// Create user: Managers (inputer only) and Administrators (any role)
router.post('/', requireRoles([ROLES.MANAGER, ROLES.ADMINISTRATOR]), userController.createUser);

// Update account status: Admins (inputers only) and Administrators
router.patch('/:userId/status', requireRoles([ROLES.ADMIN, ROLES.ADMINISTRATOR]), userController.updateAccountStatus);

module.exports = router;
