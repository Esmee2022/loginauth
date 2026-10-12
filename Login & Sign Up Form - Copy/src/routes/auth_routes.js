const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const { requireAuth, requirePartialAuth } = require('../middleware/auth_middleware');
const { rateLimitAuth } = require('../middleware/rate_limiter');

// Public endpoints
router.post('/register', rateLimitAuth, authController.register);
router.post('/login', rateLimitAuth, authController.login);
router.post('/logout', authController.logout);

// Partial Auth endpoints (Stage 2 2FA)
router.post('/2fa/verify', requirePartialAuth, rateLimitAuth, authController.verify2faLogin);
router.post('/2fa/recovery', requirePartialAuth, rateLimitAuth, authController.verifyRecoveryCode);

// Full Auth endpoints
router.get('/me', requireAuth, authController.me);
router.post('/2fa/setup', requireAuth, authController.setup2fa);
router.post('/2fa/confirm', requireAuth, authController.confirm2faEnrollment);

module.exports = router;
