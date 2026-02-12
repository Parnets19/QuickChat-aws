const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuth.controller');
const { protect } = require('../middlewares/auth');

// Admin authentication routes
router.post('/login', adminAuthController.adminLogin);
router.post('/logout', protect, adminAuthController.adminLogout);
router.post('/refresh-token', adminAuthController.refreshAdminToken);
router.get('/me', protect, adminAuthController.getAdminProfile);

// Admin setup routes
router.post('/setup', adminAuthController.setupAdmin);
router.get('/check-setup', adminAuthController.checkAdminSetup);

// FCM token management
router.post('/fcm-token', protect, adminAuthController.updateAdminFCMToken);

module.exports = router;