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
const earningsRoutes = require('./earnings.routes');

const router = express.Router();

// API Routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/consultations', consultationRoutes);
router.use('/payment', paymentRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);
router.use('/earnings', earningsRoutes);

module.exports = router;

