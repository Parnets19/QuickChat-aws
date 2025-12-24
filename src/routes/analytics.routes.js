const express = require('express');
const router = express.Router();
const {
  getOverviewAnalytics,
  getUserGrowthAnalytics,
  getRevenueAnalytics,
  getCategoryAnalytics,
  getProviderAnalytics,
  getDailyActivityAnalytics,
  exportAnalytics
} = require('../controllers/analytics.controller');
const { protect, adminOnly } = require('../middlewares/auth');

// All analytics routes require admin authentication
router.use(protect);
router.use(adminOnly);

// Analytics endpoints
router.get('/overview', getOverviewAnalytics);
router.get('/user-growth', getUserGrowthAnalytics);
router.get('/revenue', getRevenueAnalytics);
router.get('/categories', getCategoryAnalytics);
router.get('/providers', getProviderAnalytics);
router.get('/daily-activity', getDailyActivityAnalytics);
router.get('/export', exportAnalytics);

module.exports = router;