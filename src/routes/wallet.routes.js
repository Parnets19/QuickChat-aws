const express = require('express');
const { protect } = require('../middlewares/auth');
const { User, Guest } = require('../models');

const router = express.Router();

// GET /api/wallet/balance - Get current wallet balance
router.get('/balance', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log('💰 WALLET BALANCE REQUEST:', {
      userId,
      isGuest,
      timestamp: new Date().toISOString()
    });

    let user;
    if (isGuest) {
      user = await Guest.findById(userId).select('wallet name');
    } else {
      user = await User.findById(userId).select('wallet fullName totalSpent earnings');
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const walletBalance = user.wallet || 0;
    const userName = isGuest ? user.name : user.fullName;

    console.log('💰 WALLET BALANCE RESPONSE:', {
      userId,
      userName,
      walletBalance,
      totalSpent: user.totalSpent || 0,
      earnings: user.earnings || 0
    });

    res.json({
      success: true,
      data: {
        walletBalance,
        totalSpent: user.totalSpent || 0,
        earnings: user.earnings || 0,
        userName
      }
    });

  } catch (error) {
    console.error('❌ WALLET BALANCE ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;