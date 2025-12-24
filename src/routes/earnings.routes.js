const express = require('express');
const {
  getEarningsOverview,
  getTransactionHistory,
  getWithdrawalHistory,
  requestWithdrawal,
  getEarningsChart,
  fixUserWallet,
  addMoneyToWallet,
  updateWalletBalance,
  checkConsultationAffordability,
  debugWalletCalculations,
  getWithdrawalLimits
} = require('../controllers/earnings.controller');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

// Test monthly calculation (temporary)
router.get('/test-monthly', async (req, res) => {
  try {
    const User = require('../models/User.model');
    const Consultation = require('../models/Consultation.model');
    const EarningsTransaction = require('../models/Transaction.model');
    
    const amitId = '6937d5da082dde1474b170b9';
    const user = await User.findById(amitId);
    
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    console.log('📅 TEST: Current date:', now);
    console.log('📅 TEST: Start of month:', startOfMonth);
    console.log('📅 TEST: End of month:', endOfMonth);
    
    // Get consultations this month
    const monthlyConsultations = await Consultation.find({
      provider: user._id,
      status: 'completed',
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    }).select('totalAmount createdAt type duration');
    
    console.log('📋 TEST: Monthly consultations found:', monthlyConsultations.length);
    monthlyConsultations.forEach((c, i) => {
      console.log(`${i+1}. ₹${c.totalAmount} - ${c.type} - ${c.createdAt}`);
    });
    
    const totalThisMonth = monthlyConsultations.reduce((sum, c) => sum + (c.totalAmount || 0), 0);
    console.log('💰 TEST: Total this month:', totalThisMonth);
    
    res.json({
      success: true,
      data: {
        currentDate: now,
        startOfMonth,
        endOfMonth,
        monthlyConsultations: monthlyConsultations.length,
        totalThisMonth,
        consultations: monthlyConsultations.map(c => ({
          amount: c.totalAmount,
          type: c.type,
          date: c.createdAt
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// All routes require authentication
router.use(protect);
router.use((req, res, next) => {
  console.log('🔍 EARNINGS ROUTE: User authenticated:', {
    userId: req.user?.id || req.user?._id,
    isServiceProvider: req.user?.isServiceProvider,
    isGuest: req.user?.isGuest,
    userExists: !!req.user
  });
  next();
});

// Middleware to check if user can access earnings (providers or guests with earnings)
const canAccessEarnings = (req, res, next) => {
  const user = req.user;
  
  // Allow service providers
  if (user?.isServiceProvider) {
    return next();
  }
  
  // Allow guests (they can have earnings from referrals, etc.)
  if (user?.isGuest) {
    return next();
  }
  
  // For regular users, they need to be service providers
  return res.status(403).json({
    success: false,
    message: 'You must be a service provider or guest to access earnings features'
  });
};

router.use(canAccessEarnings);

// GET /api/earnings/overview - Get earnings overview
router.get('/overview', getEarningsOverview);

// GET /api/earnings/transactions - Get transaction history
router.get('/transactions', getTransactionHistory);

// GET /api/earnings/withdrawals - Get withdrawal history
router.get('/withdrawals', getWithdrawalHistory);

// GET /api/earnings/withdrawal-limits - Get withdrawal limits (75% policy)
router.get('/withdrawal-limits', getWithdrawalLimits);

// POST /api/earnings/withdraw - Request withdrawal
router.post('/withdraw', requestWithdrawal);

// GET /api/earnings/chart - Get earnings chart data
router.get('/chart', getEarningsChart);



// POST /api/earnings/fix-wallet - Fix wallet data
router.post('/fix-wallet', fixUserWallet);

// POST /api/earnings/add-money - Add money to wallet (recharge)
router.post('/add-money', addMoneyToWallet);

// POST /api/earnings/check-affordability - Check if user can afford consultation
router.post('/check-affordability', checkConsultationAffordability);

// GET /api/earnings/debug - Debug wallet calculations
router.get('/debug', debugWalletCalculations);

// POST /api/earnings/update-balance - Update wallet balance (admin function)
router.post('/update-balance', updateWalletBalance);

module.exports = router;