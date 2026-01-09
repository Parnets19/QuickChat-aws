const express = require("express");
const { protect } = require("../middlewares/auth");
const { User, Guest, Transaction } = require("../models");

const router = express.Router();

// GET /api/wallet/balance - Get current wallet balance
router.get("/balance", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log("💰 WALLET BALANCE REQUEST:", {
      userId,
      isGuest,
      timestamp: new Date().toISOString(),
    });

    let user;
    if (isGuest) {
      user = await Guest.findById(userId).select("wallet name");
    } else {
      user = await User.findById(userId).select(
        "wallet fullName totalSpent earnings"
      );
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const walletBalance = user.wallet || 0;
    const userName = isGuest ? user.name : user.fullName;

    console.log("💰 WALLET BALANCE RESPONSE:", {
      userId,
      userName,
      walletBalance,
      totalSpent: user.totalSpent || 0,
      earnings: user.earnings || 0,
    });

    res.json({
      success: true,
      data: {
        walletBalance,
        totalSpent: user.totalSpent || 0,
        earnings: user.earnings || 0,
        userName,
      },
    });
  } catch (error) {
    console.error("❌ WALLET BALANCE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// GET /api/wallet/withdrawal-history - Get withdrawal history
router.get("/withdrawal-history", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 20 } = req.query;

    console.log("📜 WITHDRAWAL HISTORY REQUEST:", {
      userId,
      page,
      limit,
      timestamp: new Date().toISOString(),
    });

    // Find withdrawal transactions
    const withdrawals = await Transaction.find({
      user: userId,
      type: "WITHDRAWAL",
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select("amount status description createdAt");

    const total = await Transaction.countDocuments({
      user: userId,
      type: "WITHDRAWAL",
    });

    console.log("📜 WITHDRAWAL HISTORY RESPONSE:", {
      userId,
      count: withdrawals.length,
      total,
    });

    res.json({
      success: true,
      data: {
        withdrawals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("❌ WITHDRAWAL HISTORY ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
