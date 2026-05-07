const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminGuestController = require('../controllers/adminGuest.controller');
const broadcastController = require('../controllers/broadcastNotification.controller');
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
router.put('/providers/:id/recommended', adminController.toggleProviderRecommended);

// User delete (admin only)
router.delete('/users/:id', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Anonymize instead of hard delete (preserve financial audit trail)
    await User.findByIdAndUpdate(id, {
      $set: {
        status: 'deleted',
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user._id,
        fullName: 'Deleted User',
        email: `deleted_${id}@deleted.com`,
        mobile: `deleted_${id}`,
        profilePhoto: null,
        bio: '',
        isProfileHidden: true,
        isOnline: false,
        fcmTokens: [],
      }
    });

    // Notify user if they have FCM tokens (before clearing)
    if (user.fcmTokens && user.fcmTokens.length > 0 && req.io) {
      req.io.to(`user:${id}`).emit('account:deleted', {
        message: 'Your account has been removed by admin.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User account deleted and anonymized successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Guest management routes
router.get('/guests', adminGuestController.getAllGuests);
router.get('/guests/statistics', adminGuestController.getGuestStatistics);
router.get('/guests/:id', adminGuestController.getGuestById);
router.put('/guests/:id', adminGuestController.updateGuest);
router.put('/guests/:id/status', adminGuestController.updateGuestStatus);
router.post('/guests/:id/add-money', adminGuestController.addMoneyToGuestWallet);

// Analytics routes
router.get('/stats', adminController.getAdminStats);

// KYC management routes
router.get('/kyc', adminController.getKycRequests);
router.get('/kyc/:id', adminController.getKycRequestById);
router.put('/kyc/:id/verify', adminController.verifyKycRequest);

// Bulk operations
router.post('/bulk-verify-providers', adminController.bulkVerifyExistingProviders);

// Utility routes
router.post('/fix-user-roles', adminController.fixUserRoles);

// Reports and Blocks management routes
router.get('/reports-blocks', adminController.getReportsAndBlocks);
router.put('/reports/:userId/:reportId/status', adminController.updateReportStatus);

// ── User Full Details (for admin user detail page) ────────────────────────────
router.get('/users/:id/details', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const { Consultation, Transaction } = require('../models');
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const user = await User.findById(id)
      .select('-password -__v')
      .lean();

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // ── Consultations as CLIENT (calls made) ──────────────────────────────────
    const clientQuery = { user: id, status: { $in: ['completed', 'ongoing', 'no_answer', 'failed', 'cancelled', 'missed'] } };
    if (hasDateFilter) clientQuery.createdAt = dateFilter;
    const clientConsultations = await Consultation.find(clientQuery)
      .populate('provider', 'fullName profilePhoto profession')
      .sort({ createdAt: -1 })
      .lean();

    // ── Consultations as PROVIDER (calls received) ────────────────────────────
    const providerQuery = { provider: id, status: { $in: ['completed', 'ongoing', 'no_answer', 'failed', 'cancelled', 'missed'] } };
    if (hasDateFilter) providerQuery.createdAt = dateFilter;
    const providerConsultations = await Consultation.find(providerQuery)
      .populate('user', 'fullName profilePhoto')
      .sort({ createdAt: -1 })
      .lean();

    // ── Transactions ──────────────────────────────────────────────────────────
    const txQuery = { user: id };
    if (hasDateFilter) txQuery.createdAt = dateFilter;
    const transactions = await Transaction.find(txQuery)
      .sort({ createdAt: -1 })
      .lean();

    // ── Aggregated stats ──────────────────────────────────────────────────────
    const completedAsClient = clientConsultations.filter(c => c.status === 'completed');
    const completedAsProvider = providerConsultations.filter(c => c.status === 'completed');

    const totalSpentOnCalls = completedAsClient.reduce((s, c) => s + (c.totalAmount || 0), 0);
    const totalEarnedFromCalls = completedAsProvider.reduce((s, c) => s + (c.totalAmount || 0) * 0.9, 0);
    const totalCallDurationAsClient = completedAsClient.reduce((s, c) => s + (c.duration || 0), 0);
    const totalCallDurationAsProvider = completedAsProvider.reduce((s, c) => s + (c.duration || 0), 0);

    const totalDeposited = transactions
      .filter(t => t.type === 'credit' && t.category === 'recharge')
      .reduce((s, t) => s + (t.amount || 0), 0);
    const totalWithdrawn = transactions
      .filter(t => t.type === 'debit' && t.category === 'withdrawal')
      .reduce((s, t) => s + (t.amount || 0), 0);

    res.json({
      success: true,
      data: {
        user,
        stats: {
          // As client
          totalCallsMade: clientConsultations.length,
          completedCallsMade: completedAsClient.length,
          totalSpentOnCalls: Math.round(totalSpentOnCalls * 100) / 100,
          totalCallDurationAsClient, // in minutes
          // As provider
          totalCallsReceived: providerConsultations.length,
          completedCallsReceived: completedAsProvider.length,
          totalEarnedFromCalls: Math.round(totalEarnedFromCalls * 100) / 100,
          totalCallDurationAsProvider, // in minutes
          // Wallet
          currentWalletBalance: user.wallet || 0,
          totalDeposited: Math.round(totalDeposited * 100) / 100,
          totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
          totalEarnings: user.earnings || 0,
          totalSpent: user.totalSpent || 0,
        },
        consultationsAsClient: clientConsultations,
        consultationsAsProvider: providerConsultations,
        transactions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Broadcast Notifications ───────────────────────────────────────────────────
router.get('/broadcast-notification/stats', broadcastController.getBroadcastStats);
router.post('/broadcast-notification', broadcastController.sendBroadcastNotification);

// Deletion requests — admin can view and approve/reject
router.get('/deletion-requests', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const requests = await User.find({ deletionRequested: true, isDeleted: { $ne: true } })
      .select('fullName email mobile deletionReason deletionRequestedAt wallet earnings status')
      .sort({ deletionRequestedAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: requests, total: requests.length });
  } catch (error) { next(error); }
});

router.post('/deletion-requests/:id/approve', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await User.findByIdAndUpdate(id, {
      $set: {
        status: 'deleted', isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id,
        fullName: 'Deleted User', email: `deleted_${id}@deleted.com`, mobile: `deleted_${id}`,
        profilePhoto: null, bio: '', isProfileHidden: true, isOnline: false, fcmTokens: [],
        deletionRequested: false,
      }
    });

    if (req.io) req.io.to(`user:${id}`).emit('account:deleted', { message: 'Your account deletion has been approved.' });

    res.status(200).json({ success: true, message: 'Account deleted and anonymized.' });
  } catch (error) { next(error); }
});

router.post('/deletion-requests/:id/reject', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const { id } = req.params;
    const { reason } = req.body;

    await User.findByIdAndUpdate(id, {
      $set: { status: 'active', isProfileHidden: false, deletionRequested: false, deletionRejectedAt: new Date(), deletionRejectionReason: reason || '' }
    });

    // Notify user
    const { sendVerificationNotification } = require('../utils/notifications');
    await sendVerificationNotification(id, 'active', `Your account deletion request was rejected. ${reason || ''}`, req.io).catch(() => {});

    res.status(200).json({ success: true, message: 'Deletion request rejected. Account restored.' });
  } catch (error) { next(error); }
});

module.exports = router;