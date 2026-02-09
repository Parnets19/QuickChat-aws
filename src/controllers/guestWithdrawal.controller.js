const { Guest, Withdrawal, Transaction } = require('../models');
const { AppError } = require('../middlewares/errorHandler');

// Request withdrawal for guest
const requestWithdrawal = async (req, res) => {
  try {
    const guestId = req.user._id;
    const { amount, bankDetails, paymentMethod = 'bank_transfer' } = req.body;

    // Validate input
    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is ₹100'
      });
    }

    // Validate bank details based on payment method
    if (paymentMethod === 'upi') {
      if (!bankDetails || !bankDetails.upiId || !bankDetails.accountHolderName) {
        return res.status(400).json({
          success: false,
          message: 'UPI ID and Account Holder Name are required for UPI withdrawals'
        });
      }
    } else {
      // Bank transfer validation
      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.accountHolderName) {
        return res.status(400).json({
          success: false,
          message: 'Account number and account holder name are required for bank transfer'
        });
      }
    }

    // Get guest details
    const guest = await Guest.findById(guestId);
    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    // Check if guest has sufficient balance
    if (guest.wallet < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ₹${guest.wallet}`
      });
    }

    // Check for pending withdrawals
    const pendingWithdrawal = await Withdrawal.findOne({
      user: guestId,
      userType: 'Guest',
      status: 'pending'
    });

    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending withdrawal request'
      });
    }

    // Calculate processing fee (guests can withdraw 100% - no retention)
    const processingFee = 0;
    const netAmount = amount - processingFee;

    // Immediately deduct money from guest wallet (like provider system)
    const previousBalance = guest.wallet;
    guest.wallet -= amount;
    await guest.save();

    // Create withdrawal record
    const withdrawal = new Withdrawal({
      user: guestId,
      userType: 'Guest',
      amount,
      processingFee,
      netAmount,
      bankDetails,
      paymentMethod,
      status: 'pending'
    });

    await withdrawal.save();

    // Create transaction record for the deduction
    const transactionMetadata = {
      withdrawalId: withdrawal._id,
      previousBalance: previousBalance,
      newBalance: guest.wallet,
      paymentMethod
    };

    // Add appropriate details based on payment method
    if (paymentMethod === 'upi') {
      transactionMetadata.upiId = bankDetails.upiId;
    } else {
      transactionMetadata.bankDetails = bankDetails.accountNumber.slice(-4); // Last 4 digits only
    }

    const transaction = new Transaction({
      user: guestId,
      userType: 'Guest',
      type: 'debit',
      amount: amount,
      balance: guest.wallet, // Current balance after deduction
      description: `Withdrawal request - ₹${amount} (${paymentMethod === 'upi' ? 'UPI' : 'Bank Transfer'})`,
      status: 'completed',
      category: 'withdrawal',
      withdrawalId: withdrawal._id,
      metadata: transactionMetadata
    });

    await transaction.save();

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Money has been deducted from your wallet.',
      data: {
        withdrawalId: withdrawal._id,
        amount,
        netAmount,
        status: 'pending',
        remainingBalance: guest.wallet
      }
    });

  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal request',
      error: error.message
    });
  }
};

// Get guest withdrawal history
const getWithdrawalHistory = async (req, res) => {
  try {
    const guestId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    // Build filter
    const filter = {
      user: guestId,
      userType: 'Guest'
    };

    if (status && status !== 'all') {
      filter.status = status;
    }

    // Get withdrawals with pagination
    const skip = (page - 1) * limit;
    const withdrawals = await Withdrawal.find(filter)
      .populate('reviewedBy', 'fullName email')
      .populate('processedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Withdrawal.countDocuments(filter);

    // Format response
    const formattedWithdrawals = withdrawals.map(withdrawal => {
      const bankDetails = {
        accountHolderName: withdrawal.bankDetails.accountHolderName,
        paymentMethod: withdrawal.paymentMethod
      };

      // Add appropriate details based on payment method
      if (withdrawal.paymentMethod === 'upi') {
        bankDetails.upiId = withdrawal.bankDetails.upiId;
      } else {
        bankDetails.accountNumber = withdrawal.bankDetails.accountNumber ? 
          `****${withdrawal.bankDetails.accountNumber.slice(-4)}` : 'N/A';
        bankDetails.bankName = withdrawal.bankDetails.bankName;
        bankDetails.ifscCode = withdrawal.bankDetails.ifscCode;
      }

      return {
        id: withdrawal._id,
        amount: withdrawal.amount,
        netAmount: withdrawal.netAmount,
        status: withdrawal.status,
        bankDetails,
        paymentMethod: withdrawal.paymentMethod,
        requestedAt: withdrawal.createdAt,
        reviewedAt: withdrawal.reviewedAt,
        processedAt: withdrawal.processedAt,
        adminNotes: withdrawal.adminNotes,
        rejectionReason: withdrawal.rejectionReason
      };
    });

    res.status(200).json({
      success: true,
      data: formattedWithdrawals,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal history',
      error: error.message
    });
  }
};

// Get guest wallet overview
const getWalletOverview = async (req, res) => {
  try {
    const guestId = req.user._id;

    // Get guest details
    const guest = await Guest.findById(guestId).select('wallet totalSpent');
    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    // Get withdrawal statistics
    const withdrawalStats = await Withdrawal.aggregate([
      { $match: { user: guestId, userType: 'Guest' } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Format withdrawal stats
    const stats = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      total: { count: 0, amount: 0 }
    };

    withdrawalStats.forEach(stat => {
      if (stats[stat._id]) {
        stats[stat._id] = { count: stat.count, amount: stat.totalAmount };
      }
      stats.total.count += stat.count;
      stats.total.amount += stat.totalAmount;
    });

    // Get recent transactions
    const recentTransactions = await Transaction.find({
      user: guestId,
      userType: 'Guest'
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('type amount description status createdAt')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        wallet: {
          balance: guest.wallet,
          totalSpent: guest.totalSpent,
          availableForWithdrawal: guest.wallet // Guests can withdraw 100%
        },
        withdrawals: stats,
        recentTransactions
      }
    });

  } catch (error) {
    console.error('Error fetching wallet overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet overview',
      error: error.message
    });
  }
};

// Cancel pending withdrawal (if not yet reviewed)
const cancelWithdrawal = async (req, res) => {
  try {
    const guestId = req.user._id;
    const { withdrawalId } = req.params;

    // Find the withdrawal
    const withdrawal = await Withdrawal.findOne({
      _id: withdrawalId,
      user: guestId,
      userType: 'Guest'
    });

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    // Check if withdrawal can be cancelled
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending withdrawals can be cancelled'
      });
    }

    // Refund money to guest wallet
    const guest = await Guest.findById(guestId);
    const previousBalance = guest.wallet;
    guest.wallet += withdrawal.amount;
    await guest.save();

    // Update withdrawal status
    withdrawal.status = 'cancelled';
    await withdrawal.save();

    // Create refund transaction
    const refundTransaction = new Transaction({
      user: guestId,
      userType: 'Guest',
      type: 'credit',
      amount: withdrawal.amount,
      balance: guest.wallet, // Current balance after refund
      description: `Withdrawal cancelled - Refund ₹${withdrawal.amount}`,
      status: 'completed',
      category: 'refund',
      withdrawalId: withdrawal._id,
      metadata: {
        withdrawalId: withdrawal._id,
        reason: 'User cancelled',
        previousBalance: previousBalance,
        newBalance: guest.wallet
      }
    });

    await refundTransaction.save();

    res.status(200).json({
      success: true,
      message: 'Withdrawal cancelled successfully. Money has been refunded to your wallet.',
      data: {
        refundedAmount: withdrawal.amount,
        newBalance: guest.wallet
      }
    });

  } catch (error) {
    console.error('Error cancelling withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel withdrawal',
      error: error.message
    });
  }
};

module.exports = {
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletOverview,
  cancelWithdrawal
};