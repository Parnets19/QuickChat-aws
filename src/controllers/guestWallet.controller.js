const { Guest, Transaction } = require("../models");
const { AppError } = require("../middlewares/errorHandler");

// @desc    Get guest wallet details
// @route   GET /api/guest-wallet/balance
// @access  Private (Guest)
const getWalletBalance = async (req, res, next) => {
  try {
    const guest = await Guest.findById(req.user.id);
    if (!guest) {
      return next(new AppError("Guest not found", 404));
    }

    // Get recent transactions
    const recentTransactions = await Transaction.find({
      user: req.user.id,
      userType: "Guest",
    })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        balance: guest.wallet, // Frontend expects this structure
        wallet: {
          balance: guest.wallet,
          totalSpent: guest.totalSpent,
          currency: "INR",
        },
        recentTransactions,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add money to guest wallet
// @route   POST /api/guest-wallet/add-money
// @access  Private (Guest)
const addMoneyToWallet = async (req, res, next) => {
  try {
    const { amount, paymentMethod = "demo" } = req.body;

    if (!amount || amount <= 0) {
      return next(new AppError("Please provide a valid amount", 400));
    }

    if (amount < 10) {
      return next(new AppError("Minimum amount to add is ₹10", 400));
    }

    if (amount > 50000) {
      return next(new AppError("Maximum amount to add is ₹50,000", 400));
    }

    const guest = await Guest.findById(req.user.id);
    if (!guest) {
      return next(new AppError("Guest not found", 404));
    }

    // For demo purposes, we'll simulate successful payment
    // In production, integrate with actual payment gateway
    const transactionId = `TXN_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create transaction record
    const transaction = new Transaction({
      user: guest._id,
      userType: "Guest",
      type: "wallet_credit",
      category: "deposit", // Required field
      amount: amount,
      balance: guest.wallet + amount, // Required field - balance after transaction
      status: "completed",
      description: `Wallet top-up via ${paymentMethod}`,
      transactionId,
      paymentMethod,
      metadata: {
        previousBalance: guest.wallet,
        newBalance: guest.wallet + amount,
      },
    });

    await transaction.save();

    // Add money to wallet
    await guest.addToWallet(amount);

    // Add transaction reference to guest
    guest.transactions.push(transaction._id);
    await guest.save();

    res.status(200).json({
      success: true,
      message: `₹${amount} added to wallet successfully`,
      data: {
        transaction: {
          id: transaction._id,
          amount: transaction.amount,
          type: transaction.type,
          status: transaction.status,
          transactionId: transaction.transactionId,
          createdAt: transaction.createdAt,
        },
        wallet: {
          balance: guest.wallet,
          totalSpent: guest.totalSpent,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Withdraw money from guest wallet
// @route   POST /api/guest-wallet/withdraw
// @access  Private (Guest)
const withdrawFromWallet = async (req, res, next) => {
  try {
    const { amount, bankDetails } = req.body;

    if (!amount || amount <= 0) {
      return next(new AppError("Please provide a valid amount", 400));
    }

    if (amount < 100) {
      return next(new AppError("Minimum withdrawal amount is ₹100", 400));
    }

    if (!bankDetails || !bankDetails.accountNumber) {
      return next(
        new AppError("Account number is required for withdrawal", 400)
      );
    }

    const guest = await Guest.findById(req.user.id);
    if (!guest) {
      return next(new AppError("Guest not found", 404));
    }

    if (guest.wallet < amount) {
      return next(new AppError("Insufficient wallet balance", 400));
    }

    // For demo purposes, we'll create a pending withdrawal
    // In production, integrate with actual payment gateway
    const transactionId = `WTH_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create withdrawal transaction record
    const transaction = new Transaction({
      user: guest._id,
      userType: "Guest",
      type: "withdrawal",
      category: "withdrawal", // Required field
      amount: amount,
      balance: guest.wallet - amount, // Required field - balance after transaction
      status: "pending", // Withdrawals typically need approval
      description: `Wallet withdrawal to ${bankDetails.accountNumber}`,
      transactionId,
      paymentMethod: "bank_transfer",
      metadata: {
        bankDetails: {
          accountNumber: bankDetails.accountNumber.slice(-4), // Store only last 4 digits
          ifscCode: bankDetails.ifscCode,
          accountHolderName: bankDetails.accountHolderName,
        },
        previousBalance: guest.wallet,
        newBalance: guest.wallet - amount,
      },
    });

    await transaction.save();

    // Deduct money from wallet
    await guest.deductFromWallet(amount);

    // Add transaction reference to guest
    guest.transactions.push(transaction._id);
    await guest.save();

    res.status(200).json({
      success: true,
      message: `Withdrawal request for ₹${amount} submitted successfully`,
      data: {
        transaction: {
          id: transaction._id,
          amount: transaction.amount,
          type: transaction.type,
          status: transaction.status,
          transactionId: transaction.transactionId,
          createdAt: transaction.createdAt,
        },
        wallet: {
          balance: guest.wallet,
          totalSpent: guest.totalSpent,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get guest transaction history
// @route   GET /api/guest-wallet/transactions
// @access  Private (Guest)
const getTransactionHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type } = req.query;

    const query = {
      user: req.user.id,
      userType: "Guest",
    };

    if (type) {
      query.type = type;
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Make payment for consultation
// @route   POST /api/guest-wallet/pay-consultation
// @access  Private (Guest)
const payForConsultation = async (req, res, next) => {
  try {
    const { consultationId, amount, providerId } = req.body;

    if (!consultationId || !amount || !providerId) {
      return next(
        new AppError(
          "Consultation ID, amount, and provider ID are required",
          400
        )
      );
    }

    const guest = await Guest.findById(req.user.id);
    if (!guest) {
      return next(new AppError("Guest not found", 404));
    }

    if (!guest.canMakePayment(amount)) {
      return next(
        new AppError("Insufficient wallet balance or account suspended", 400)
      );
    }

    // Create payment transaction
    const transactionId = `PAY_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const transaction = new Transaction({
      user: guest._id,
      userType: "Guest",
      type: "consultation",
      category: "consultation", // Required field
      amount: amount,
      balance: guest.wallet - amount, // Required field - balance after transaction
      status: "completed",
      description: `Payment for consultation ${consultationId}`,
      transactionId,
      metadata: {
        consultationId,
        providerId,
        previousBalance: guest.wallet,
        newBalance: guest.wallet - amount,
      },
    });

    await transaction.save();

    // Deduct money from wallet
    await guest.deductFromWallet(amount);

    // Add transaction reference
    guest.transactions.push(transaction._id);
    await guest.save();

    res.status(200).json({
      success: true,
      message: "Payment successful",
      data: {
        transaction: {
          id: transaction._id,
          amount: transaction.amount,
          type: transaction.type,
          status: transaction.status,
          transactionId: transaction.transactionId,
          createdAt: transaction.createdAt,
        },
        wallet: {
          balance: guest.wallet,
          totalSpent: guest.totalSpent,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getWalletBalance,
  addMoneyToWallet,
  withdrawFromWallet,
  getTransactionHistory,
  payForConsultation,
};
