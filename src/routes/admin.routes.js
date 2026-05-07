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

// ── Admin Add Money to User/Guest Wallet ─────────────────────────────────────
router.post('/users/:id/add-wallet', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const Guest = require('../models/Guest.model');
    const { Transaction } = require('../models');
    const { createNotification } = require('../utils/notifications');
    const { id } = req.params;
    const { amount, reason, customReason, userType = 'user' } = req.body;

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason is required' });
    }

    const creditAmount = Math.round(parseFloat(amount) * 100) / 100;
    const description = customReason
      ? `${reason}: ${customReason}`
      : reason;

    let targetUser, previousBalance, newBalance, userName;

    if (userType === 'guest') {
      targetUser = await Guest.findById(id);
      if (!targetUser) return res.status(404).json({ success: false, message: 'Guest not found' });

      previousBalance = targetUser.wallet || 0;
      newBalance = Math.round((previousBalance + creditAmount) * 100) / 100;
      targetUser.wallet = newBalance;
      await targetUser.save();
      userName = targetUser.name;

      // Transaction for guest
      await Transaction.create({
        user: targetUser._id,
        userType: 'Guest',
        type: 'credit',
        category: 'adjustment',
        amount: creditAmount,
        balance: newBalance,
        description: `Admin Credit — ${description}`,
        status: 'completed',
        processedBy: req.user._id,
        processedAt: new Date(),
        metadata: {
          previousBalance,
          newBalance,
          adminNote: description,
          adminId: req.user._id.toString(),
        },
      });

      // Push notification for guest
      await createNotification({
        userId: targetUser._id.toString(),
        userType: 'guest',
        title: '💰 Wallet Credited',
        message: `Rs.${creditAmount} has been added to your wallet. Reason: ${description}`,
        type: 'wallet',
        data: { amount: creditAmount, reason: description, newBalance },
        io: req.io,
      }).catch(() => {});

    } else {
      targetUser = await User.findById(id);
      if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

      previousBalance = targetUser.wallet || 0;
      newBalance = Math.round((previousBalance + creditAmount) * 100) / 100;
      targetUser.wallet = newBalance;
      await targetUser.save();
      userName = targetUser.fullName;

      // Transaction for user
      await Transaction.create({
        user: targetUser._id,
        userType: 'User',
        type: 'credit',
        category: 'adjustment',
        amount: creditAmount,
        balance: newBalance,
        description: `Admin Credit — ${description}`,
        status: 'completed',
        processedBy: req.user._id,
        processedAt: new Date(),
        metadata: {
          previousBalance,
          newBalance,
          adminNote: description,
          adminId: req.user._id.toString(),
        },
      });

      // Push notification for user
      await createNotification({
        userId: targetUser._id.toString(),
        userType: 'user',
        title: '💰 Wallet Credited',
        message: `Rs.${creditAmount} has been added to your wallet. Reason: ${description}`,
        type: 'wallet',
        data: { amount: creditAmount, reason: description, newBalance },
        io: req.io,
      }).catch(() => {});

      // Real-time socket event
      if (req.io) {
        req.io.to(`user:${id}`).emit('wallet:updated', { newBalance, amount: creditAmount, reason: description });
      }
    }

    res.json({
      success: true,
      message: `Rs.${creditAmount} added to ${userName}'s wallet successfully`,
      data: { previousBalance, newBalance, amountAdded: creditAmount, description },
    });
  } catch (error) {
    next(error);
  }
});

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

    // ── Manually populate Guest callers (populate() only works for User refs) ──
    const Guest = require('../models/Guest.model');
    const guestIds = providerConsultations
      .filter(c => c.userType === 'Guest' && c.user)
      .map(c => c.user.toString());
    const uniqueGuestIds = [...new Set(guestIds)];
    const guests = uniqueGuestIds.length > 0
      ? await Guest.find({ _id: { $in: uniqueGuestIds } }).select('name mobile').lean()
      : [];
    const guestMap = {};
    guests.forEach(g => { guestMap[g._id.toString()] = g; });

    // Normalize: if user is null (populate failed) and userType is Guest, inject guest data
    const normalizedProviderConsultations = providerConsultations.map(c => {
      if (c.userType === 'Guest' && c.user) {
        const guestId = c.user._id ? c.user._id.toString() : c.user.toString();
        const guest = guestMap[guestId];
        if (guest) {
          return {
            ...c,
            user: {
              _id: guest._id,
              fullName: guest.name,   // Guest uses 'name' not 'fullName'
              profilePhoto: null,
              isGuest: true,
              mobile: guest.mobile,
            }
          };
        }
        // Guest not found — show mobile if available
        return { ...c, user: { _id: c.user, fullName: 'Guest User', profilePhoto: null, isGuest: true } };
      }
      // Regular user — if populate worked, user.fullName exists; if not, show fallback
      if (!c.user || !c.user.fullName) {
        return { ...c, user: { _id: c.user, fullName: 'Deleted User', profilePhoto: null } };
      }
      return c;
    });

    // ── Transactions ──────────────────────────────────────────────────────────
    const txQuery = { user: id };
    if (hasDateFilter) txQuery.createdAt = dateFilter;
    const transactions = await Transaction.find(txQuery)
      .sort({ createdAt: -1 })
      .lean();

    // ── Aggregated stats ──────────────────────────────────────────────────────
    const completedAsClient = clientConsultations.filter(c => c.status === 'completed');
    const completedAsProvider = normalizedProviderConsultations.filter(c => c.status === 'completed');

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
          totalCallsReceived: normalizedProviderConsultations.length,
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
        consultationsAsProvider: normalizedProviderConsultations,
        transactions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Admin: Add Money to User/Provider Wallet ─────────────────────────────────
router.post('/users/:id/add-money', async (req, res, next) => {
  try {
    const User = require('../models/User.model');
    const { Transaction } = require('../models');
    const { createNotification } = require('../utils/notifications');
    const { id } = req.params;
    const { amount, reason, customReason } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const PRESET_REASONS = [
      'Refund',
      'Promotional Offer',
      'Bonus',
      'Compensation',
      'Cashback',
      'Welcome Bonus',
      'Referral Bonus',
      'Contest Prize',
      'Manual Adjustment',
    ];

    const finalReason = reason === 'Other' ? (customReason || 'Admin Credit') : (reason || 'Admin Credit');
    if (reason && reason !== 'Other' && !PRESET_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: 'Invalid reason' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const parsedAmount = parseFloat(parseFloat(amount).toFixed(2));
    const previousBalance = user.wallet || 0;
    const newBalance = parseFloat((previousBalance + parsedAmount).toFixed(2));

    // Update wallet
    await User.findByIdAndUpdate(id, { wallet: newBalance });

    // Create transaction record
    const transaction = new Transaction({
      user: user._id,
      userType: 'User',
      type: 'credit',
      category: 'adjustment',
      amount: parsedAmount,
      balance: newBalance,
      description: `Admin Credit: ${finalReason}`,
      status: 'completed',
      processedBy: req.user._id,
      processedAt: new Date(),
      metadata: {
        previousBalance,
        newBalance,
        adminId: req.user._id,
        reason: finalReason,
      },
    });
    await transaction.save();

    // Send notification
    try {
      await createNotification({
        userId: user._id.toString(),
        userType: 'user',
        title: '💰 Wallet Credited',
        message: `Rs.${parsedAmount.toFixed(2)} has been added to your wallet. Reason: ${finalReason}`,
        type: 'wallet',
        data: { amount: parsedAmount, reason: finalReason, newBalance },
        io: req.io,
      });
    } catch (notifErr) {
      console.error('Notification error (non-fatal):', notifErr.message);
    }

    res.json({
      success: true,
      message: `Rs.${parsedAmount} added to ${user.fullName}'s wallet`,
      data: { previousBalance, newBalance, amountAdded: parsedAmount, transaction },
    });
  } catch (error) {
    next(error);
  }
});

// ── Admin: Add Money to Guest Wallet ─────────────────────────────────────────
router.post('/guests/:id/add-money-v2', async (req, res, next) => {
  try {
    const Guest = require('../models/Guest.model');
    const { Transaction } = require('../models');
    const { createNotification } = require('../utils/notifications');
    const { id } = req.params;
    const { amount, reason, customReason } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const finalReason = reason === 'Other' ? (customReason || 'Admin Credit') : (reason || 'Admin Credit');

    const guest = await Guest.findById(id);
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });

    const parsedAmount = parseFloat(parseFloat(amount).toFixed(2));
    const previousBalance = guest.wallet || 0;
    const newBalance = parseFloat((previousBalance + parsedAmount).toFixed(2));

    await Guest.findByIdAndUpdate(id, { wallet: newBalance });

    const transaction = new Transaction({
      user: guest._id,
      userType: 'Guest',
      type: 'credit',
      category: 'adjustment',
      amount: parsedAmount,
      balance: newBalance,
      description: `Admin Credit: ${finalReason}`,
      status: 'completed',
      processedBy: req.user._id,
      processedAt: new Date(),
      metadata: {
        previousBalance,
        newBalance,
        adminId: req.user._id,
        reason: finalReason,
      },
    });
    await transaction.save();

    // Send push notification to guest
    try {
      await createNotification({
        userId: guest._id.toString(),
        userType: 'guest',
        title: '💰 Wallet Credited',
        message: `Rs.${parsedAmount.toFixed(2)} has been added to your wallet. Reason: ${finalReason}`,
        type: 'wallet',
        data: { amount: parsedAmount, reason: finalReason, newBalance },
        io: req.io,
      });
    } catch (notifErr) {
      console.error('Notification error (non-fatal):', notifErr.message);
    }

    res.json({
      success: true,
      message: `Rs.${parsedAmount} added to ${guest.name}'s wallet`,
      data: { previousBalance, newBalance, amountAdded: parsedAmount, transaction },
    });
  } catch (error) {
    next(error);
  }
});
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