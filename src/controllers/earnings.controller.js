const { User, EarningsTransaction, WithdrawalRequest, Consultation } = require('../models');
const { logger } = require('../utils/logger');

// Get earnings overview
const getEarningsOverview = async (req, res) => {
  try {
    console.log('🔍 BACKEND: Getting earnings overview for user:', req.user.id || req.user._id);
    const userId = req.user.id || req.user._id;

    // Get user with wallet and earnings
    const user = await User.findById(userId).select('wallet earnings');
    console.log('👤 BACKEND: User found:', user ? 'Yes' : 'No');
    if (user) {
      console.log('💰 BACKEND: User wallet:', user.wallet, 'earnings:', user.earnings);
    }
    
    if (!user) {
      console.log('❌ BACKEND: User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    // Get current month earnings
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    console.log('📅 BACKEND: Checking monthly earnings from', startOfMonth, 'to', endOfMonth);
    console.log('📅 BACKEND: Current date:', now);

    // Check earnings from both sources: transactions and completed consultations
    
    // 1. From earnings transactions
    const monthlyEarningsFromTransactions = await EarningsTransaction.aggregate([
      {
        $match: {
          userId: user._id,
          type: 'earning',
          status: 'completed',
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    // 2. From completed consultations this month
    const monthlyEarningsFromConsultations = await Consultation.aggregate([
      {
        $match: {
          provider: user._id,
          status: 'completed',
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    const transactionEarnings = monthlyEarningsFromTransactions[0]?.total || 0;
    const consultationEarnings = monthlyEarningsFromConsultations[0]?.total || 0;
    const totalMonthlyEarnings = transactionEarnings + consultationEarnings;

    console.log('📊 BACKEND: Monthly earnings from transactions:', transactionEarnings);
    console.log('📊 BACKEND: Monthly earnings from consultations:', consultationEarnings);
    console.log('📊 BACKEND: Total monthly earnings:', totalMonthlyEarnings);

    // Get pending earnings (from ongoing consultations)
    const pendingEarnings = await Consultation.aggregate([
      {
        $match: {
          provider: user._id,
          status: 'ongoing'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Get total withdrawn amount
    const totalWithdrawn = await WithdrawalRequest.aggregate([
      {
        $match: {
          userId: user._id,
          status: { $in: ['processed', 'processing'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$netAmount' }
        }
      }
    ]);

    const stats = {
      totalEarnings: user.earnings || 0,
      walletBalance: user.wallet || 0,
      thisMonth: totalMonthlyEarnings,
      pending: pendingEarnings[0]?.total || 0,
      withdrawn: totalWithdrawn[0]?.total || 0
    };

    // Check if user has any completed consultations
    const completedConsultations = await Consultation.find({
      provider: user._id,
      status: 'completed'
    }).limit(5);

    console.log('📋 BACKEND: Completed consultations:', completedConsultations.length);
    
    // If user has no earnings but has completed consultations, let's add them
    if (user.earnings === 0 && completedConsultations.length > 0) {
      console.log('🔧 BACKEND: User has completed consultations but no earnings, updating...');
      
      let totalEarningsToAdd = 0;
      for (const consultation of completedConsultations) {
        if (consultation.totalAmount && consultation.totalAmount > 0) {
          totalEarningsToAdd += consultation.totalAmount;
          
          // Check if transaction already exists
          const existingTransaction = await EarningsTransaction.findOne({
            userId: user._id,
            consultationId: consultation._id
          });
          
          if (!existingTransaction) {
            // Create earnings transaction
            await EarningsTransaction.create({
              userId: user._id,
              consultationId: consultation._id,
              type: 'earning',
              amount: consultation.totalAmount,
              description: `${consultation.type.charAt(0).toUpperCase() + consultation.type.slice(1)} Consultation`,
              status: 'completed',
              metadata: {
                consultationType: consultation.type,
                duration: consultation.duration,
                rate: consultation.rate
              }
            });
            console.log('✅ BACKEND: Created earnings transaction for consultation:', consultation._id);
          }
        }
      }
      
      if (totalEarningsToAdd > 0) {
        // Update user earnings and wallet
        user.earnings = (user.earnings || 0) + totalEarningsToAdd;
        user.wallet = (user.wallet || 0) + totalEarningsToAdd;
        await user.save();
        
        console.log('✅ BACKEND: Updated user earnings:', user.earnings, 'wallet:', user.wallet);
        
        // Update stats
        stats.totalEarnings = user.earnings;
        stats.walletBalance = user.wallet;
      }
    }

    console.log('📊 BACKEND: Final stats being sent:', stats);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting earnings overview:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get transaction history
const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type, status } = req.query;

    const query = { userId };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await EarningsTransaction.find(query)
      .populate('consultationId', 'type duration')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await EarningsTransaction.countDocuments(query);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Error getting transaction history:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get withdrawal history
const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    const query = { userId };
    if (status) query.status = status;

    const withdrawals = await WithdrawalRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await WithdrawalRequest.countDocuments(query);

    res.json({
      success: true,
      data: {
        withdrawals,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Error getting withdrawal history:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Request withdrawal
const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, bankAccountId } = req.body;

    // Validate amount
    if (!amount || amount < 500) {
      return res.status(400).json({ message: 'Minimum withdrawal amount is ₹500' });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check wallet balance
    if (user.wallet < amount) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    // Check if user has bank details
    if (!user.bankDetails || !user.bankDetails.accountNumber) {
      return res.status(400).json({ message: 'Please add bank details first' });
    }

    // Calculate processing fee (2%)
    const processingFee = Math.round(amount * 0.02);
    const netAmount = amount - processingFee;

    // Create withdrawal request
    const withdrawal = new WithdrawalRequest({
      userId,
      amount,
      processingFee,
      netAmount,
      bankDetails: user.bankDetails,
      status: 'pending'
    });

    await withdrawal.save();

    // Deduct amount from wallet
    user.wallet -= amount;
    await user.save();

    // Create transaction record
    const transaction = new EarningsTransaction({
      userId,
      type: 'withdrawal',
      amount: -amount,
      description: `Withdrawal request - ${user.bankDetails.bankName} ****${user.bankDetails.accountNumber.slice(-4)}`,
      status: 'pending'
    });

    await transaction.save();

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        withdrawalId: withdrawal._id,
        amount,
        processingFee,
        netAmount,
        status: 'pending'
      }
    });

  } catch (error) {
    logger.error('Error requesting withdrawal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Add earnings (called when consultation is completed)
const addEarnings = async (userId, consultationId, amount, description, metadata = {}) => {
  try {
    // Update user earnings and wallet
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.earnings = (user.earnings || 0) + amount;
    user.wallet = (user.wallet || 0) + amount;
    await user.save();

    // Create transaction record
    const transaction = new EarningsTransaction({
      userId,
      consultationId,
      type: 'earning',
      amount,
      description,
      status: 'completed',
      metadata
    });

    await transaction.save();

    logger.info(`Added earnings: ₹${amount} for user ${userId}`);
    return transaction;

  } catch (error) {
    logger.error('Error adding earnings:', error);
    throw error;
  }
};

// Get earnings chart data
const getEarningsChart = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { period = 'month' } = req.query; // month, week, year

    let startDate, groupBy;
    const now = new Date();

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = { $dayOfYear: '$createdAt' };
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        groupBy = { $month: '$createdAt' };
        break;
      default: // month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        groupBy = { $dayOfMonth: '$createdAt' };
    }

    const user = await User.findById(userId);
    const chartData = await EarningsTransaction.aggregate([
      {
        $match: {
          userId: user._id,
          type: 'earning',
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: groupBy,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.json({
      success: true,
      data: chartData
    });

  } catch (error) {
    logger.error('Error getting earnings chart:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Debug endpoint to check user data
const debugUserEarnings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    const user = await User.findById(userId).select('wallet earnings fullName isServiceProvider');
    const consultations = await Consultation.find({ provider: userId }).limit(10);
    const transactions = await EarningsTransaction.find({ userId }).limit(10);
    
    res.json({
      success: true,
      debug: {
        user: {
          id: user._id,
          name: user.fullName,
          isProvider: user.isServiceProvider,
          wallet: user.wallet,
          earnings: user.earnings
        },
        consultationsCount: consultations.length,
        consultations: consultations.map(c => ({
          id: c._id,
          type: c.type,
          status: c.status,
          totalAmount: c.totalAmount,
          duration: c.duration,
          createdAt: c.createdAt
        })),
        transactionsCount: transactions.length,
        transactions: transactions.map(t => ({
          id: t._id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          createdAt: t.createdAt
        }))
      }
    });
    
  } catch (error) {
    logger.error('Error in debug endpoint:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Fix wallet data for a user
const fixUserWallet = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    console.log('🔧 FIXING WALLET: Starting wallet fix for user:', userId);
    
    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('👤 CURRENT USER DATA:', {
      name: user.fullName,
      wallet: user.wallet,
      earnings: user.earnings
    });
    
    // Calculate total earnings from completed consultations
    const completedConsultations = await Consultation.find({
      provider: userId,
      status: 'completed'
    });
    
    let totalEarningsFromConsultations = 0;
    for (const consultation of completedConsultations) {
      if (consultation.totalAmount && consultation.totalAmount > 0) {
        totalEarningsFromConsultations += consultation.totalAmount;
      }
    }
    
    console.log('💰 CALCULATED EARNINGS:', {
      completedConsultations: completedConsultations.length,
      totalEarningsFromConsultations
    });
    
    // Calculate total withdrawals
    const totalWithdrawn = await WithdrawalRequest.aggregate([
      {
        $match: {
          userId: user._id,
          status: { $in: ['processed', 'processing'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    const withdrawnAmount = totalWithdrawn[0]?.total || 0;
    
    // Calculate correct wallet balance
    const correctWalletBalance = totalEarningsFromConsultations - withdrawnAmount;
    
    console.log('🔧 WALLET CALCULATION:', {
      totalEarnings: totalEarningsFromConsultations,
      totalWithdrawn: withdrawnAmount,
      correctWalletBalance
    });
    
    // Update user data
    user.earnings = totalEarningsFromConsultations;
    user.wallet = Math.max(0, correctWalletBalance); // Ensure wallet is never negative
    await user.save();
    
    console.log('✅ WALLET FIXED:', {
      newEarnings: user.earnings,
      newWallet: user.wallet
    });
    
    res.json({
      success: true,
      message: 'Wallet data fixed successfully',
      data: {
        oldData: {
          earnings: req.body.oldEarnings || 'unknown',
          wallet: req.body.oldWallet || 'unknown'
        },
        newData: {
          earnings: user.earnings,
          wallet: user.wallet
        },
        calculations: {
          totalEarningsFromConsultations,
          withdrawnAmount,
          correctWalletBalance
        }
      }
    });
    
  } catch (error) {
    logger.error('Error fixing wallet:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add money to wallet (recharge)
const addMoneyToWallet = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount, description = 'Wallet Recharge' } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    console.log('💳 WALLET RECHARGE:', { userId, amount, description });
    
    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Add money to wallet
    user.wallet = (user.wallet || 0) + amount;
    await user.save();
    
    // Create transaction record
    const transaction = new EarningsTransaction({
      userId,
      type: 'recharge',
      amount,
      description,
      status: 'completed',
      metadata: {
        rechargeMethod: 'manual', // Later will be 'phonepe'
        previousBalance: user.wallet - amount,
        newBalance: user.wallet
      }
    });
    
    await transaction.save();
    
    console.log('✅ WALLET RECHARGED:', {
      amount,
      newBalance: user.wallet
    });
    
    res.json({
      success: true,
      message: 'Money added to wallet successfully',
      data: {
        amount,
        newBalance: user.wallet,
        transaction: transaction._id
      }
    });
    
  } catch (error) {
    logger.error('Error adding money to wallet:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Check if user can afford consultation
const checkConsultationAffordability = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { providerId, consultationType, estimatedDuration } = req.body;
    
    // Get user wallet balance
    const user = await User.findById(userId).select('wallet');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get provider rates
    const provider = await User.findById(providerId).select('rates');
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }
    
    // Calculate estimated cost
    const rate = provider.rates?.audioVideo || provider.rates?.[consultationType] || 0;
    const estimatedCost = (estimatedDuration || 30) * rate; // Default 30 minutes
    
    // Calculate maximum talk time with current balance
    const maxTalkTime = rate > 0 ? Math.floor(user.wallet / rate) : 0;
    
    const canAfford = user.wallet >= estimatedCost;
    
    res.json({
      success: true,
      data: {
        walletBalance: user.wallet,
        rate,
        estimatedCost,
        canAfford,
        maxTalkTime,
        estimatedDuration: estimatedDuration || 30
      }
    });
    
  } catch (error) {
    logger.error('Error checking consultation affordability:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add test earnings (for testing purposes)
const addTestEarnings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount = 500 } = req.body;
    
    console.log('🧪 BACKEND: Adding test earnings for user:', userId, 'amount:', amount);
    
    // Add test earnings
    const transaction = await addEarnings(
      userId,
      null, // No consultation ID for test
      amount,
      'Test Earnings - Video Consultation',
      {
        clientName: 'Test Client',
        consultationType: 'video',
        duration: 30,
        rate: amount / 30
      }
    );
    
    console.log('✅ BACKEND: Test earnings added:', transaction);
    
    res.json({
      success: true,
      message: 'Test earnings added successfully',
      data: transaction
    });
    
  } catch (error) {
    logger.error('Error adding test earnings:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getEarningsOverview,
  getTransactionHistory,
  getWithdrawalHistory,
  requestWithdrawal,
  addEarnings,
  getEarningsChart,
  debugUserEarnings,
  addTestEarnings,
  fixUserWallet,
  addMoneyToWallet,
  checkConsultationAffordability
};