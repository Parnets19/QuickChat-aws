const { User, Transaction, Withdrawal } = require('../models');
const { AppError } = require('../middlewares/errorHandler');
const phonepeService = require('../utils/phonepe');
const { v4: uuidv4 } = require('uuid');

// @desc    Initiate wallet recharge
// @route   POST /api/payment/recharge
// @access  Private
const initiateWalletRecharge = async (req, res, next) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 1) {
      return next(new AppError('Invalid amount', 400));
    }

    const user = await User.findById(req.user?._id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const orderId = `ORD-${uuidv4().substring(0, 12).toUpperCase()}`;

    // Create pending transaction
    const transaction = await Transaction.create({
      transactionId: orderId,
      user: user._id,
      userType: 'User',
      type: 'credit',
      category: 'deposit',
      amount,
      balance: user.wallet + amount, // Balance after transaction
      status: 'pending',
      paymentMethod: 'phonepe',
      description: 'Wallet recharge',
    });

    // Initiate PhonePe payment
    const paymentResponse = await phonepeService.initiatePayment({
      amount,
      userId: user._id.toString(),
      orderId,
      mobileNumber: user.mobile,
    });

    if (!paymentResponse.success) {
      transaction.status = 'failed';
      await transaction.save();
      return next(new AppError('Payment initiation failed', 500));
    }

    res.status(200).json({
      success: true,
      data: {
        transactionId: orderId,
        paymentUrl: paymentResponse.paymentUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Payment webhook
// @route   POST /api/payment/webhook
// @access  Public
const paymentWebhook = async (req, res, next) => {
  try {
    const { code, merchantId, transactionId, amount, providerReferenceId } = req.body;

    if (code !== 'PAYMENT_SUCCESS') {
      return res.status(200).json({ success: false });
    }

    const transaction = await Transaction.findOne({ transactionId });
    if (!transaction) {
      return res.status(200).json({ success: false });
    }

    if (transaction.status === 'completed') {
      return res.status(200).json({ success: true });
    }

    // Update transaction
    transaction.status = 'completed';
    transaction.paymentDetails = req.body;
    await transaction.save();

    // Update user wallet
    const user = await User.findById(transaction.user);
    if (user) {
      user.wallet += transaction.amount;
      await user.save();
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ success: false });
  }
};

// @desc    Verify payment
// @route   GET /api/payment/verify/:transactionId
// @access  Private
const verifyPayment = async (req, res, next) => {
  try {
    const transaction = await Transaction.findOne({
      transactionId: req.params.transactionId,
      user: req.user?._id,
    });

    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get wallet balance
// @route   GET /api/payment/wallet
// @access  Private
const getWalletBalance = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?._id).select('wallet');
    res.status(200).json({
      success: true,
      data: { balance: user?.wallet || 0 },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get transactions
// @route   GET /api/payment/transactions
// @access  Private
const getTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category } = req.query;

    const query = { user: req.user?._id };
    if (category) query.category = category;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Request withdrawal
// @route   POST /api/payment/withdraw
// @access  Private
const requestWithdrawal = async (req, res, next) => {
  try {
    const { amount } = req.body;

    const user = await User.findById(req.user?._id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (user.wallet < amount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    if (!user.bankDetails) {
      return next(new AppError('Bank details not found', 400));
    }

    const withdrawal = await Withdrawal.create({
      user: user._id,
      amount,
      fee: amount * 0.02, // 2% fee
      netAmount: amount * 0.98,
      bankDetails: user.bankDetails,
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted',
      data: withdrawal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get withdrawals
// @route   GET /api/payment/withdrawals
// @access  Private
const getWithdrawals = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user?._id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initiateWalletRecharge,
  paymentWebhook,
  verifyPayment,
  getWalletBalance,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
};

