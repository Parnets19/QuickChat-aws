const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminGuestController = require('../controllers/adminGuest.controller');
const broadcastController = require('../controllers/broadcastNotification.controller');
const { protect, adminOnly } = require('../middlewares/auth');

// Test route (no authentication required)
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Admin routes are working',
    timestamp: new Date().toISOString()
  });
});

// SECURITY: The previous /create-admin, /make-me-admin, and /debug-auth routes
// were removed. There is exactly ONE admin (the Admin-model account managed via
// /api/admin-auth/setup + /api/admin-auth/login). No regular user can become an
// admin, so self-service admin creation/promotion endpoints must not exist.

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

    // Create admin notification
    const { createAdminNotification } = require('../utils/notifications');
    await createAdminNotification({
      title: 'Account Deleted',
      message: `${user.fullName}'s account has been deleted by admin.`,
      type: 'account_deleted',
      triggeredBy: req.user._id,
      affectedUser: id,
      io: req.io,
    }).catch(() => {});

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

// ── Admin Notifications ───────────────────────────────────────────────────────
router.get('/notifications', async (req, res, next) => {
  try {
    const AdminNotification = require('../models/AdminNotification.model');
    const { page = 1, limit = 20 } = req.query;

    const notifications = await AdminNotification.find()
      .populate('affectedUser', 'fullName email mobile profilePhoto')
      .populate('triggeredBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await AdminNotification.countDocuments();
    const unreadCount = await AdminNotification.countDocuments({ isRead: false });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

router.get('/notifications/unread-count', async (req, res, next) => {
  try {
    const AdminNotification = require('../models/AdminNotification.model');
    const count = await AdminNotification.countDocuments({ isRead: false });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) { next(error); }
});

router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    const AdminNotification = require('../models/AdminNotification.model');
    await AdminNotification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.status(200).json({ success: true, message: 'Marked as read' });
  } catch (error) { next(error); }
});

router.put('/notifications/read-all', async (req, res, next) => {
  try {
    const AdminNotification = require('../models/AdminNotification.model');
    await AdminNotification.updateMany({ isRead: false }, { isRead: true });
    res.status(200).json({ success: true, message: 'All marked as read' });
  } catch (error) { next(error); }
});

router.delete('/notifications/:id', async (req, res, next) => {
  try {
    const AdminNotification = require('../models/AdminNotification.model');
    await AdminNotification.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  REVIEW MANAGEMENT                                                       ██
// ═══════════════════════════════════════════════════════════════════════════════

// GET all reviews with filters
router.get('/reviews', async (req, res, next) => {
  try {
    const { Review, User } = require('../models');
    const { page = 1, limit = 20, status = 'all', rating, search, sortBy = 'newest' } = req.query;

    const query = {};
    if (status !== 'all') query.status = status;
    if (rating) query.rating = parseInt(rating);

    // Sort options
    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      highRating: { rating: -1 },
      lowRating: { rating: 1 },
    };

    let reviews = await Review.find(query)
      .populate('user', 'fullName profilePhoto mobile')
      .populate('provider', 'fullName profilePhoto profession')
      .populate('consultation', 'type duration totalAmount createdAt')
      .sort(sortOptions[sortBy] || sortOptions.newest)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    // Handle search filter on populated fields
    if (search) {
      const s = search.toLowerCase();
      reviews = reviews.filter(r =>
        (r.user?.fullName || '').toLowerCase().includes(s) ||
        (r.provider?.fullName || '').toLowerCase().includes(s) ||
        (r.review || '').toLowerCase().includes(s)
      );
    }

    const total = await Review.countDocuments(query);

    // Stats
    const allReviews = await Review.find({});
    const stats = {
      total: allReviews.length,
      active: allReviews.filter(r => r.status === 'active').length,
      hidden: allReviews.filter(r => r.status === 'hidden').length,
      reported: allReviews.filter(r => r.isReported).length,
      averageRating: allReviews.length > 0
        ? (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1)
        : 0,
    };

    res.json({
      success: true,
      data: reviews,
      stats,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

// PUT update review status (hide/activate/delete)
router.put('/reviews/:id/status', async (req, res, next) => {
  try {
    const { Review } = require('../models');
    const { status } = req.body;
    if (!['active', 'hidden', 'deleted'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const review = await Review.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true, data: review });
  } catch (error) { next(error); }
});

// DELETE review permanently
router.delete('/reviews/:id', async (req, res, next) => {
  try {
    const { Review, User } = require('../models');
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    // Update provider rating
    const provider = await User.findById(review.provider);
    if (provider && provider.rating.count > 0) {
      const newCount = provider.rating.count - 1;
      const newTotal = (provider.rating.average * provider.rating.count) - review.rating;
      provider.rating.count = newCount;
      provider.rating.average = newCount > 0 ? newTotal / newCount : 0;
      await provider.save();
    }

    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Review deleted' });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  REELS MODERATION                                                        ██
// ═══════════════════════════════════════════════════════════════════════════════

// GET all reels with filters
// Includes BOTH real Reel documents AND provider profession/portfolio videos
// (the same sources shown in the public reels feed).
router.get('/reels', async (req, res, next) => {
  try {
    const { Reel } = require('../models');
    const User = require('../models/User.model');
    const { page = 1, limit = 20, status = 'all', search, sortBy = 'newest' } = req.query;

    // 1) Real Reel documents
    const reelDocs = await Reel.find({})
      .populate('user', 'fullName profilePhoto profession')
      .lean();

    let items = reelDocs.map(r => ({ ...r, isProviderReel: false }));

    // 2) Provider profession/portfolio videos (stored on the user profile)
    const providers = await User.find({
      isServiceProvider: true,
      $or: [
        { 'professionVideo.0': { $exists: true } },
        { 'portfolioMedia.0': { $exists: true } },
      ],
    }).select('_id fullName profilePhoto profession professionVideo portfolioMedia').lean();

    providers.forEach(provider => {
      (provider.professionVideo || []).forEach((video, index) => {
        const url = typeof video === 'string' ? video : video.url;
        if (!url) return;
        items.push({
          _id: `provider:${provider._id}:profession:${index}`,
          user: { _id: provider._id, fullName: provider.fullName, profilePhoto: provider.profilePhoto, profession: provider.profession },
          type: 'video',
          videoUrl: url,
          thumbnailUrl: (typeof video === 'object' && video.thumbnailUrl) || undefined,
          caption: (typeof video === 'object' && video.caption) || provider.profession || 'Professional video',
          likes: (typeof video === 'object' && video.likes) || [],
          views: (typeof video === 'object' && video.views) || 0,
          isActive: !(typeof video === 'object' && video.hidden),
          createdAt: (typeof video === 'object' && video.createdAt) || provider._id.getTimestamp(),
          isProviderReel: true,
          source: 'professionVideo',
          sourceIndex: index,
        });
      });

      (provider.portfolioMedia || []).forEach((media, index) => {
        const url = typeof media === 'string' ? media : media.url;
        if (!url) return;
        const mediaType = (typeof media === 'object' && media.type) || (url.match(/\.(mp4|webm|mov|mkv|3gp|avi)$/i) ? 'video' : 'image');
        if (mediaType !== 'video') return; // only moderate videos here
        items.push({
          _id: `provider:${provider._id}:portfolio:${index}`,
          user: { _id: provider._id, fullName: provider.fullName, profilePhoto: provider.profilePhoto, profession: provider.profession },
          type: 'video',
          videoUrl: url,
          thumbnailUrl: (typeof media === 'object' && media.thumbnailUrl) || undefined,
          caption: (typeof media === 'object' && media.caption) || provider.profession || '',
          likes: (typeof media === 'object' && media.likes) || [],
          views: (typeof media === 'object' && media.views) || 0,
          isActive: !(typeof media === 'object' && media.hidden),
          createdAt: (typeof media === 'object' && media.createdAt) || provider._id.getTimestamp(),
          isProviderReel: true,
          source: 'portfolioMedia',
          sourceIndex: index,
        });
      });
    });

    // Filter by status
    if (status === 'active') items = items.filter(i => i.isActive);
    else if (status === 'hidden') items = items.filter(i => !i.isActive);

    // Search
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(i =>
        (i.caption || '').toLowerCase().includes(s) ||
        (i.user?.fullName || '').toLowerCase().includes(s) ||
        (i.tags || []).some(t => t.toLowerCase().includes(s))
      );
    }

    // Sort
    const sorters = {
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      mostViewed: (a, b) => (b.views || 0) - (a.views || 0),
      mostLiked: (a, b) => (b.likes?.length || 0) - (a.likes?.length || 0),
    };
    items.sort(sorters[sortBy] || sorters.newest);

    // Stats (over the full merged set, before pagination)
    const total = items.length;
    const activeCount = items.filter(i => i.isActive).length;
    const totalViews = items.reduce((sum, i) => sum + (i.views || 0), 0);

    // Paginate
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paged = items.slice(start, start + parseInt(limit));

    res.json({
      success: true,
      data: paged,
      stats: {
        total,
        active: activeCount,
        hidden: total - activeCount,
        totalViews,
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

// Helper: parse a provider reel synthetic id → { userId, field, index }
const parseProviderReelId = (id) => {
  if (typeof id !== 'string' || !id.startsWith('provider:')) return null;
  const [, userId, source, indexStr] = id.split(':');
  const field = source === 'profession' ? 'professionVideo' : source === 'portfolio' ? 'portfolioMedia' : null;
  if (!field) return null;
  return { userId, field, index: parseInt(indexStr) };
};

// Helper: notify a reel owner when their reel is hidden/shown by admin
const notifyReelOwner = async (ownerId, hidden, req) => {
  if (!ownerId) return;
  try {
    const { createNotification } = require('../utils/notifications');
    await createNotification({
      userId: String(ownerId),
      userType: 'user',
      title: hidden ? 'Your reel was hidden' : 'Your reel is visible again',
      message: hidden
        ? 'An admin has hidden one of your reels. It is no longer visible to other users.'
        : 'An admin has restored one of your reels. It is visible to other users again.',
      type: 'system',
      data: { action: hidden ? 'reel_hidden' : 'reel_shown' },
      io: req.io,
    });
  } catch (e) {
    console.error('Failed to notify reel owner:', e.message);
  }
};

// PUT toggle reel active status (hide/show)
router.put('/reels/:id/toggle', async (req, res, next) => {
  try {
    const { id } = req.params;
    const providerRef = parseProviderReelId(id);

    if (providerRef) {
      // Provider profession/portfolio video → toggle a `hidden` flag on the media sub-doc
      const User = require('../models/User.model');
      const user = await User.findById(providerRef.userId);
      if (!user) return res.status(404).json({ success: false, message: 'Provider not found' });
      const arr = user[providerRef.field];
      if (!Array.isArray(arr) || !arr[providerRef.index]) {
        return res.status(404).json({ success: false, message: 'Reel not found' });
      }
      const item = arr[providerRef.index];
      let nowHidden;
      // Handle both string and object entries
      if (typeof item === 'string') {
        arr.set(providerRef.index, { url: item, hidden: true });
        nowHidden = true;
      } else {
        nowHidden = !item.hidden;
        item.hidden = nowHidden;
      }
      user.markModified(providerRef.field);
      await user.save();

      notifyReelOwner(user._id, nowHidden, req);

      return res.json({
        success: true,
        message: nowHidden ? 'Reel hidden' : 'Reel activated',
        data: { _id: id, isActive: !nowHidden, ownerId: String(user._id) },
      });
    }

    const { Reel } = require('../models');
    const reel = await Reel.findById(id);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });
    reel.isActive = !reel.isActive;
    await reel.save();

    notifyReelOwner(reel.user, !reel.isActive, req);

    res.json({
      success: true,
      data: { _id: id, isActive: reel.isActive, ownerId: String(reel.user) },
      message: reel.isActive ? 'Reel activated' : 'Reel hidden',
    });
  } catch (error) { next(error); }
});

// DELETE reel permanently
router.delete('/reels/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const providerRef = parseProviderReelId(id);

    if (providerRef) {
      // Remove the video from the provider's profile media array
      const User = require('../models/User.model');
      const user = await User.findById(providerRef.userId);
      if (!user) return res.status(404).json({ success: false, message: 'Provider not found' });
      const arr = user[providerRef.field];
      if (!Array.isArray(arr) || !arr[providerRef.index]) {
        return res.status(404).json({ success: false, message: 'Reel not found' });
      }
      arr.splice(providerRef.index, 1);
      user.markModified(providerRef.field);
      await user.save();
      return res.json({ success: true, message: 'Reel deleted from provider profile' });
    }

    const { Reel, ReelComment } = require('../models');
    const reel = await Reel.findById(id);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });
    await ReelComment.deleteMany({ reel: id });
    await Reel.findByIdAndDelete(id);
    res.json({ success: true, message: 'Reel and its comments deleted' });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  LIVE STREAM MONITORING                                                  ██
// ═══════════════════════════════════════════════════════════════════════════════

// GET all live streams (active + history)
router.get('/live-streams', async (req, res, next) => {
  try {
    const { LiveStream } = require('../models');
    const { page = 1, limit = 20, status = 'all' } = req.query;

    const query = {};
    if (status === 'active') query.isActive = true;
    else if (status === 'ended') query.isActive = false;

    const streams = await LiveStream.find(query)
      .populate('streamer', 'fullName profilePhoto profession')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await LiveStream.countDocuments(query);
    const activeCount = await LiveStream.countDocuments({ isActive: true });
    const totalEarnings = await LiveStream.aggregate([{ $group: { _id: null, total: { $sum: '$totalEarnings' } } }]);

    res.json({
      success: true,
      data: streams,
      stats: {
        total: await LiveStream.countDocuments(),
        active: activeCount,
        totalEarnings: totalEarnings[0]?.total || 0,
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

// PUT force-end a live stream
router.put('/live-streams/:id/force-end', async (req, res, next) => {
  try {
    const { LiveStream } = require('../models');
    const stream = await LiveStream.findById(req.params.id);
    if (!stream) return res.status(404).json({ success: false, message: 'Stream not found' });
    if (!stream.isActive) return res.status(400).json({ success: false, message: 'Stream already ended' });

    stream.isActive = false;
    stream.endedAt = new Date();
    await stream.save();

    // Notify via socket
    if (req.io) {
      req.io.to(`live-stream:${req.params.id}`).emit('stream:force-ended', {
        message: 'This stream has been terminated by admin.',
      });
    }

    res.json({ success: true, message: 'Stream force-ended' });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  CONSULTATION MONITORING                                                 ██
// ═══════════════════════════════════════════════════════════════════════════════

// GET active/ongoing consultations
router.get('/consultations', async (req, res, next) => {
  try {
    const { Consultation, User } = require('../models');
    const Guest = require('../models/Guest.model');
    const { page = 1, limit = 20, status = 'all', type = 'all', search } = req.query;

    const query = {};
    if (status !== 'all') query.status = status;
    if (type !== 'all') query.type = type;

    let consultations = await Consultation.find(query)
      .populate('provider', 'fullName profilePhoto profession')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    // Manually resolve user names (handles both User and Guest)
    const userIds = consultations.filter(c => c.userType !== 'Guest' && c.user).map(c => c.user.toString());
    const guestIds = consultations.filter(c => c.userType === 'Guest' && c.user).map(c => c.user.toString());

    const [users, guests] = await Promise.all([
      userIds.length > 0 ? User.find({ _id: { $in: userIds } }).select('fullName profilePhoto mobile').lean() : [],
      guestIds.length > 0 ? Guest.find({ _id: { $in: guestIds } }).select('name mobile').lean() : [],
    ]);

    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = { _id: u._id, fullName: u.fullName, profilePhoto: u.profilePhoto, mobile: u.mobile }; });
    guests.forEach(g => { userMap[g._id.toString()] = { _id: g._id, fullName: g.name, profilePhoto: null, mobile: g.mobile, isGuest: true }; });

    // Attach resolved user data
    consultations = consultations.map(c => ({
      ...c,
      user: c.user ? (userMap[c.user.toString()] || { _id: c.user, fullName: 'Unknown User', profilePhoto: null }) : null,
    }));

    // Also resolve provider if populate failed (string IDs)
    const unresolvedProviders = consultations.filter(c => c.provider && !c.provider.fullName);
    if (unresolvedProviders.length > 0) {
      const provIds = unresolvedProviders.map(c => c.provider.toString ? c.provider.toString() : c.provider);
      const provs = await User.find({ _id: { $in: provIds } }).select('fullName profilePhoto profession').lean();
      const provMap = {};
      provs.forEach(p => { provMap[p._id.toString()] = p; });
      consultations = consultations.map(c => {
        if (c.provider && !c.provider.fullName) {
          const key = c.provider.toString ? c.provider.toString() : c.provider;
          return { ...c, provider: provMap[key] || { _id: key, fullName: 'Unknown Provider' } };
        }
        return c;
      });
    }

    if (search) {
      const s = search.toLowerCase();
      consultations = consultations.filter(c =>
        (c.user?.fullName || '').toLowerCase().includes(s) ||
        (c.provider?.fullName || '').toLowerCase().includes(s) ||
        (c.consultationId || '').toLowerCase().includes(s)
      );
    }

    const total = await Consultation.countDocuments(query);

    // Stats
    const ongoing = await Consultation.countDocuments({ status: 'ongoing' });
    const completed = await Consultation.countDocuments({ status: 'completed' });
    const totalRevenue = await Consultation.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);

    res.json({
      success: true,
      data: consultations,
      stats: {
        ongoing,
        completed,
        total: await Consultation.countDocuments(),
        totalRevenue: totalRevenue[0]?.total || 0,
      },
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

// GET single consultation details
router.get('/consultations/:id', async (req, res, next) => {
  try {
    const { Consultation } = require('../models');
    const consultation = await Consultation.findById(req.params.id)
      .populate('user', 'fullName profilePhoto mobile email wallet')
      .populate('provider', 'fullName profilePhoto profession mobile email wallet earnings')
      .lean();
    if (!consultation) return res.status(404).json({ success: false, message: 'Consultation not found' });
    res.json({ success: true, data: consultation });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  REFUND / DISPUTE SYSTEM                                                 ██
// ═══════════════════════════════════════════════════════════════════════════════

// POST process refund for a consultation
router.post('/consultations/:id/refund', async (req, res, next) => {
  try {
    const { Consultation, Transaction, User } = require('../models');
    const Guest = require('../models/Guest.model');
    const { createNotification } = require('../utils/notifications');
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Refund amount must be greater than 0' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Refund reason is required' });
    }

    const consultation = await Consultation.findById(id);
    if (!consultation) return res.status(404).json({ success: false, message: 'Consultation not found' });

    const refundAmount = Math.min(parseFloat(amount), consultation.totalAmount || 0);
    if (refundAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Nothing to refund for this consultation' });
    }

    // Credit user wallet
    const userId = consultation.user;
    const isGuestUser = consultation.userType === 'Guest';
    let targetUser, previousBalance, newBalance, userName;

    if (isGuestUser) {
      targetUser = await Guest.findById(userId);
      if (!targetUser) return res.status(404).json({ success: false, message: 'Guest user not found' });
      previousBalance = targetUser.wallet || 0;
      newBalance = Math.round((previousBalance + refundAmount) * 100) / 100;
      targetUser.wallet = newBalance;
      await targetUser.save();
      userName = targetUser.name;
    } else {
      targetUser = await User.findById(userId);
      if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });
      previousBalance = targetUser.wallet || 0;
      newBalance = Math.round((previousBalance + refundAmount) * 100) / 100;
      targetUser.wallet = newBalance;
      await targetUser.save();
      userName = targetUser.fullName;
    }

    // Create refund transaction
    await Transaction.create({
      user: userId,
      userType: isGuestUser ? 'Guest' : 'User',
      type: 'credit',
      category: 'refund',
      amount: refundAmount,
      balance: newBalance,
      description: `Refund for consultation ${consultation.consultationId} — ${reason}`,
      status: 'completed',
      processedBy: req.user._id,
      processedAt: new Date(),
      metadata: {
        consultationId: consultation._id,
        consultationCode: consultation.consultationId,
        previousBalance,
        newBalance,
        reason,
        adminId: req.user._id.toString(),
      },
    });

    // Deduct from provider earnings (optional, depends on policy)
    const provider = await User.findById(consultation.provider);
    if (provider) {
      const providerDeduction = Math.round(refundAmount * 0.9 * 100) / 100; // 90% was credited to provider
      if (provider.earnings >= providerDeduction) {
        provider.earnings = Math.round((provider.earnings - providerDeduction) * 100) / 100;
        await provider.save();
      }
    }

    // Send notification to user
    await createNotification({
      userId: userId.toString(),
      userType: isGuestUser ? 'guest' : 'user',
      title: '💰 Refund Processed',
      message: `Rs.${refundAmount.toFixed(2)} has been refunded to your wallet for consultation ${consultation.consultationId}. Reason: ${reason}`,
      type: 'wallet',
      data: { amount: refundAmount, reason, consultationId: consultation.consultationId },
      io: req.io,
    }).catch(() => {});

    res.json({
      success: true,
      message: `Rs.${refundAmount} refunded to ${userName}`,
      data: { refundAmount, previousBalance, newBalance, consultationId: consultation.consultationId },
    });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██  PROFILE EDIT LOGS (Audit Trail)                                         ██
// ═══════════════════════════════════════════════════════════════════════════════

// GET all profile edit logs
router.get('/profile-edits', async (req, res, next) => {
  try {
    const ProfileEditLog = require('../models/ProfileEditLog.model');
    const { page = 1, limit = 20, search, userId } = req.query;

    const query = {};
    if (userId) query.user = userId;
    if (search) {
      query.$or = [
        { userName: { $regex: search, $options: 'i' } },
        { userMobile: { $regex: search, $options: 'i' } },
        { 'changes.field': { $regex: search, $options: 'i' } },
      ];
    }

    const logs = await ProfileEditLog.find(query)
      .populate('user', 'fullName profilePhoto mobile profession isServiceProvider')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await ProfileEditLog.countDocuments(query);

    res.json({
      success: true,
      data: logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
});

module.exports = router;