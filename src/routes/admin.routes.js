const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect, adminOnly } = require('../middlewares/auth');

// Public route to create admin user (no authentication required)
router.post('/create-admin', adminController.createAdminUser);

// Test route (no authentication required)
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Admin routes are working',
    timestamp: new Date().toISOString()
  });
});

// Debug route to check authentication status
router.get('/debug-auth', protect, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      fullName: req.user.fullName,
      isServiceProvider: req.user.isServiceProvider,
      isAdmin: req.user.isAdmin,
      status: req.user.status
    },
    message: 'Authentication successful'
  });
});

// Temporary route to make current user admin (only requires authentication)
router.post('/make-me-admin', protect, adminController.makeCurrentUserAdmin);

// Apply authentication and admin-only middleware to all other routes
router.use(protect);
router.use(adminOnly);

// Provider management routes
router.get('/providers', adminController.getAllProviders);
router.get('/providers/:id', adminController.getProviderById);
router.put('/providers/:id', adminController.updateProvider);
router.put('/providers/:id/status', adminController.updateProviderStatus);
router.put('/providers/:id/visibility', adminController.toggleProviderVisibility);

// Analytics routes
router.get('/stats', adminController.getAdminStats);

// KYC management routes
router.get('/kyc', adminController.getKycRequests);
router.get('/kyc/:id', adminController.getKycRequestById);
router.put('/kyc/:id/verify', adminController.verifyKycRequest);

// Bulk operations
router.post('/bulk-verify-providers', adminController.bulkVerifyExistingProviders);

module.exports = router;