const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const consultationRoutes = require('./consultation.routes');
const paymentRoutes = require('./payment.routes');
const subscriptionRoutes = require('./subscription.routes');
const reviewRoutes = require('./review.routes');
const notificationRoutes = require('./notification.routes');
const categoryRoutes = require('./category.routes');
const adminRoutes = require('./admin.routes');
const adminAuthRoutes = require('./adminAuth.routes');
const adminWalletRoutes = require('./adminWallet.routes');
const earningsRoutes = require('./earnings.routes');
const uploadRoutes = require('./upload.routes');
const guestAuthRoutes = require('./guestAuth.routes');
const guestWalletRoutes = require('./guestWallet.routes');
const guestWithdrawalRoutes = require('./guestWithdrawal.routes');
const realTimeBillingRoutes = require('./realTimeBilling.routes');
const walletRoutes = require('./wallet.routes');
const chatRoutes = require('./chat.routes');
const checkRoutes = require('./check.routes');
const analyticsRoutes = require('./analytics.routes');

const router = express.Router();

// API Routes
router.use('/auth', authRoutes);
router.use('/check', checkRoutes); // User existence check routes
router.use('/upload', uploadRoutes); // Public upload routes
router.use('/users', userRoutes);
router.use('/consultations', consultationRoutes);
router.use('/payment', paymentRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);
router.use('/admin-auth', adminAuthRoutes);
router.use('/admin/wallet', adminWalletRoutes);
router.use('/earnings', earningsRoutes);
router.use('/guest-auth', guestAuthRoutes);
router.use('/guest-wallet', guestWalletRoutes);
router.use('/guest/withdrawal', guestWithdrawalRoutes); // Guest withdrawal system
router.use('/billing', realTimeBillingRoutes); // Real-time billing system
router.use('/wallet', walletRoutes); // Wallet balance API
router.use('/chat', chatRoutes); // Chat system
router.use('/analytics', analyticsRoutes); // Analytics and reports

module.exports = router;

