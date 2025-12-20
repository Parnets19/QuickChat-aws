const { User, Guest, Transaction, Withdrawal, Consultation } = require('../models');
const { createNotification } = require('../utils/notifications');

// Get platform wallet overview
const getWalletOverview = async (req, res) => {
  try {
    // Get provider wallet statistics
    const providerStats = await User.aggregate([
      { $match: { isServiceProvider: true } },
      {
        $group: {
          _id: null,
          totalProviders: { $sum: 1 },
          totalWalletBalance: { $sum: '$wallet' },
          totalEarnings: { $sum: '$earnings' },
          averageBalance: { $avg: '$wallet' },
          maxBalance: { $max: '$wallet' },
        }
      }
    ]);

    // Get guest wallet statistics
    const guestStats = await Guest.aggregate([
      {
        $group: {
          _id: null,
          totalGuests: { $sum: 1 },
          totalWalletBalance: { $sum: '$wallet' },
          totalSpent: { $sum: '$totalSpent' },
          averageBalance: { $avg: '$wallet' },
          maxBalance: { $max: '$wallet' },
        }
      }
    ]);

    // Get transaction statistics
    const transactionStats = await Transaction.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        }
      }
    ]);

    // Get pending withdrawals
    const pendingWithdrawals = await Withdrawal.aggregate([
      { $match: { status: 'pending' } },
      {
        $group: {
          _id: '$userType',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        }
      }
    ]);

    // Get today's transactions
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTransactions = await Transaction.aggregate([
      { $match: { createdAt: { $gte: today } } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        }
      }
    ]);

    const overview = {
      providers: providerStats[0] || {
        totalProviders: 0,
        totalWalletBalance: 0,
        totalEarnings: 0,
        averageBalance: 0,
        maxBalance: 0,
      },
      guests: guestStats[0] || {
        totalGuests: 0,
        totalWalletBalance: 0,
        totalSpent: 0,
        averageBalance: 0,
        maxBalance: 0,
      },
      transactions: transactionStats,
      pendingWithdrawals: pendingWithdrawals,
      todayTransactions: todayTransactions,
      platformTotal: {
        totalBalance: (providerStats[0]?.totalWalletBalance || 0) + (guestStats[0]?.totalWalletBalance || 0),
        totalUsers: (providerStats[0]?.totalProviders || 0) + (guestStats[0]?.totalGuests || 0),
      }
    };

    res.status(200).json({
      success: true,
      data: overview
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

// Get all provider wallets
const getProviderWallets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'wallet',
      sortOrder = 'desc',
      minBalance = 0,
      maxBalance = null
    } = req.query;

    // Build filter query
    const filter = { isServiceProvider: true };
    
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } }
      ];
    }

    if (minBalance > 0) {
      filter.wallet = { $gte: parseFloat(minBalance) };
    }

    if (maxBalance) {
      filter.wallet = { ...filter.wallet, $lte: parseFloat(maxBalance) };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const providers = await User.find(filter)
      .select('fullName email mobile wallet earnings status lastActive createdAt')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get additional statistics for each provider
    const enhancedProviders = await Promise.all(
      providers.map(async (provider) => {
        const [transactionCount, pendingWithdrawals, totalEarningsFromTransactions] = await Promise.all([
          Transaction.countDocuments({ user: provider._id, userType: 'User' }),
          Withdrawal.countDocuments({ user: provider._id, userType: 'User', status: 'pending' }),
          Transaction.aggregate([
            { $match: { user: provider._id, userType: 'User', type: 'earning' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ])
        ]);

        return {
          ...provider,
          transactionCount,
          pendingWithdrawals,
          totalEarningsFromTransactions: totalEarningsFromTransactions[0]?.total || 0,
          lastActiveFormatted: provider.lastActive ? new Date(provider.lastActive).toLocaleDateString() : 'Never',
          joinedDate: provider.createdAt ? new Date(provider.createdAt).toLocaleDateString() : 'Unknown'
        };
      })
    );

    // Get total count for pagination
    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: enhancedProviders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching provider wallets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch provider wallets',
      error: error.message
    });
  }
};

// Get all guest wallets
const getGuestWallets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'wallet',
      sortOrder = 'desc',
      minBalance = 0,
      maxBalance = null
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } }
      ];
    }

    if (minBalance > 0) {
      filter.wallet = { $gte: parseFloat(minBalance) };
    }

    if (maxBalance) {
      filter.wallet = { ...filter.wallet, $lte: parseFloat(maxBalance) };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const guests = await Guest.find(filter)
      .select('name mobile wallet totalSpent status lastActive createdAt')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get additional statistics for each guest
    const enhancedGuests = await Promise.all(
      guests.map(async (guest) => {
        const [transactionCount, pendingWithdrawals, consultationCount] = await Promise.all([
          Transaction.countDocuments({ user: guest._id, userType: 'Guest' }),
          Withdrawal.countDocuments({ user: guest._id, userType: 'Guest', status: 'pending' }),
          Consultation.countDocuments({ user: guest._id })
        ]);

        return {
          ...guest,
          transactionCount,
          pendingWithdrawals,
          consultationCount,
          lastActiveFormatted: guest.lastActive ? new Date(guest.lastActive).toLocaleDateString() : 'Never',
          joinedDate: guest.createdAt ? new Date(guest.createdAt).toLocaleDateString() : 'Unknown'
        };
      })
    );

    // Get total count for pagination
    const total = await Guest.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: enhancedGuests,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching guest wallets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guest wallets',
      error: error.message
    });
  }
};

// Get all transactions with filtering
const getAllTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userType = 'all',
      type = 'all',
      category = 'all',
      status = 'all',
      search = '',
      startDate = null,
      endDate = null,
      minAmount = null,
      maxAmount = null
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (userType !== 'all') {
      filter.userType = userType;
    }

    if (type !== 'all') {
      filter.type = type;
    }

    if (category !== 'all') {
      filter.category = category;
    }

    if (status !== 'all') {
      filter.status = status;
    }

    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (minAmount) {
      filter.amount = { $gte: parseFloat(minAmount) };
    }

    if (maxAmount) {
      filter.amount = { ...filter.amount, $lte: parseFloat(maxAmount) };
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const transactions = await Transaction.find(filter)
      .populate('user', 'fullName email mobile name') // Populate both User and Guest fields
      .populate('consultationId', 'type status')
      .populate('withdrawalId', 'status bankDetails')
      .populate('processedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Search in populated data if search term provided
    let filteredTransactions = transactions;
    if (search) {
      filteredTransactions = transactions.filter(transaction => {
        const user = transaction.user;
        const searchTerm = search.toLowerCase();
        
        return (
          (user?.fullName && user.fullName.toLowerCase().includes(searchTerm)) ||
          (user?.name && user.name.toLowerCase().includes(searchTerm)) ||
          (user?.email && user.email.toLowerCase().includes(searchTerm)) ||
          (user?.mobile && user.mobile.includes(searchTerm)) ||
          transaction.description.toLowerCase().includes(searchTerm) ||
          transaction.transactionId?.toLowerCase().includes(searchTerm)
        );
      });
    }

    // Get total count for pagination
    const total = await Transaction.countDocuments(filter);

    // Get summary statistics
    const summary = await Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          totalCredit: {
            $sum: {
              $cond: [{ $in: ['$type', ['credit', 'earning', 'deposit', 'wallet_credit', 'bonus', 'refund']] }, '$amount', 0]
            }
          },
          totalDebit: {
            $sum: {
              $cond: [{ $in: ['$type', ['debit', 'withdrawal', 'consultation_payment', 'wallet_debit', 'penalty']] }, '$amount', 0]
            }
          },
          totalEarnings: {
            $sum: {
              $cond: [{ $eq: ['$type', 'earning'] }, '$amount', 0]
            }
          },
          totalWithdrawals: {
            $sum: {
              $cond: [{ $eq: ['$type', 'withdrawal'] }, '$amount', 0]
            }
          },
          totalDeposits: {
            $sum: {
              $cond: [{ $in: ['$type', ['credit', 'deposit', 'wallet_credit']] }, '$amount', 0]
            }
          },
          totalPayments: {
            $sum: {
              $cond: [{ $in: ['$type', ['consultation_payment', 'wallet_debit']] }, '$amount', 0]
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: filteredTransactions,
      summary: summary[0] || { 
        totalAmount: 0, 
        totalCredit: 0, 
        totalDebit: 0, 
        totalEarnings: 0,
        totalWithdrawals: 0,
        totalDeposits: 0,
        totalPayments: 0,
        count: 0 
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Get all withdrawal requests
const getAllWithdrawals = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'all',
      userType = 'all',
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (status !== 'all') {
      filter.status = status;
    }

    if (userType !== 'all') {
      filter.userType = userType;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const withdrawals = await Withdrawal.find(filter)
      .populate('user', 'fullName email mobile name wallet') // Populate both User and Guest fields
      .populate('reviewedBy', 'fullName email')
      .populate('processedBy', 'fullName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Search in populated data if search term provided
    let filteredWithdrawals = withdrawals;
    if (search) {
      filteredWithdrawals = withdrawals.filter(withdrawal => {
        const user = withdrawal.user;
        const searchTerm = search.toLowerCase();
        
        return (
          (user?.fullName && user.fullName.toLowerCase().includes(searchTerm)) ||
          (user?.name && user.name.toLowerCase().includes(searchTerm)) ||
          (user?.email && user.email.toLowerCase().includes(searchTerm)) ||
          (user?.mobile && user.mobile.includes(searchTerm)) ||
          withdrawal.transactionId?.toLowerCase().includes(searchTerm) ||
          withdrawal.bankDetails?.accountNumber?.includes(searchTerm)
        );
      });
    }

    // Get total count for pagination
    const total = await Withdrawal.countDocuments(filter);

    // Get summary statistics
    const summary = await Withdrawal.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: filteredWithdrawals,
      summary: summary,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawals',
      error: error.message
    });
  }
};

// Approve withdrawal request
const approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes = '' } = req.body;

    const withdrawal = await Withdrawal.findById(id).populate('user');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal request is not in pending status'
      });
    }

    // Check if user has sufficient balance
    const user = withdrawal.user;
    if (user.wallet < withdrawal.amount) {
      return res.status(400).json({
        success: false,
        message: 'User has insufficient balance for this withdrawal'
      });
    }

    // NEW POLICY: Check 75% withdrawal limit
    const maxWithdrawableAmount = Math.floor(user.wallet * 0.75);
    if (withdrawal.amount > maxWithdrawableAmount) {
      return res.status(400).json({
        success: false,
        message: `Withdrawal amount exceeds 75% limit. Maximum withdrawable: ₹${maxWithdrawableAmount}`,
        data: {
          currentBalance: user.wallet,
          maxWithdrawable: maxWithdrawableAmount,
          requestedAmount: withdrawal.amount
        }
      });
    }

    console.log('💰 ADMIN APPROVAL: Deducting withdrawal amount from wallet', {
      userId: user._id,
      currentWallet: user.wallet,
      withdrawalAmount: withdrawal.amount,
      newWallet: user.wallet - withdrawal.amount
    });

    // Deduct amount from user wallet (this is when the money is actually taken)
    user.wallet -= withdrawal.amount;
    await user.save();

    // Update withdrawal status
    withdrawal.status = 'approved';
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    withdrawal.adminNotes = adminNotes;
    await withdrawal.save();

    console.log('✅ ADMIN APPROVAL: Withdrawal approved and wallet updated', {
      withdrawalId: withdrawal._id,
      newWalletBalance: user.wallet,
      status: 'approved'
    });

    // Send notification to user
    try {
      await createNotification({
        userId: withdrawal.user._id,
        title: 'Withdrawal Approved',
        message: `Your withdrawal request of ₹${withdrawal.amount} has been approved and will be processed soon.`,
        type: 'admin',
        data: {
          withdrawalId: withdrawal._id,
          amount: withdrawal.amount,
          status: 'approved'
        },
        io: req.io
      });
    } catch (notificationError) {
      console.error('Error sending withdrawal approval notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal request approved successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve withdrawal',
      error: error.message
    });
  }
};

// Reject withdrawal request
const rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason = 'No reason provided' } = req.body;

    const withdrawal = await Withdrawal.findById(id).populate('user');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal request is not in pending status'
      });
    }

    // Update withdrawal status (no wallet changes needed since money wasn't deducted yet)
    withdrawal.status = 'rejected';
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    withdrawal.rejectionReason = rejectionReason;
    await withdrawal.save();

    console.log('❌ ADMIN REJECTION: Withdrawal rejected, no wallet changes', {
      withdrawalId: withdrawal._id,
      userId: withdrawal.user._id,
      amount: withdrawal.amount,
      reason: rejectionReason
    });

    // Send notification to user
    try {
      await createNotification({
        userId: withdrawal.user._id,
        title: 'Withdrawal Rejected',
        message: `Your withdrawal request of ₹${withdrawal.amount} has been rejected. Reason: ${rejectionReason}`,
        type: 'admin',
        data: {
          withdrawalId: withdrawal._id,
          amount: withdrawal.amount,
          status: 'rejected',
          reason: rejectionReason
        },
        io: req.io
      });
    } catch (notificationError) {
      console.error('Error sending withdrawal rejection notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal request rejected successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject withdrawal',
      error: error.message
    });
  }
};

// Process approved withdrawal (mark as processed)
const processWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionId, paymentMethod = 'bank_transfer', notes = '' } = req.body;

    const withdrawal = await Withdrawal.findById(id).populate('user');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal request must be approved before processing'
      });
    }

    // Deduct amount from user wallet
    const UserModel = withdrawal.userType === 'User' ? User : Guest;
    const user = await UserModel.findById(withdrawal.user._id);
    
    if (user.wallet < withdrawal.amount) {
      return res.status(400).json({
        success: false,
        message: 'User has insufficient balance for this withdrawal'
      });
    }

    // Update user wallet
    user.wallet -= withdrawal.amount;
    await user.save();

    // Create transaction record
    const transaction = new Transaction({
      user: withdrawal.user._id,
      userType: withdrawal.userType,
      type: 'withdrawal',
      category: 'withdrawal',
      amount: withdrawal.amount,
      balance: user.wallet,
      description: `Withdrawal processed - ${paymentMethod}`,
      status: 'completed',
      withdrawalId: withdrawal._id,
      paymentMethod: paymentMethod,
      transactionId: transactionId,
      processedBy: req.user._id,
      processedAt: new Date(),
      metadata: {
        withdrawalDetails: {
          bankDetails: withdrawal.bankDetails,
          paymentMethod: paymentMethod,
          adminNotes: notes
        }
      }
    });
    await transaction.save();

    // Update withdrawal status
    withdrawal.status = 'processed';
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();
    withdrawal.transactionId = transactionId;
    withdrawal.paymentMethod = paymentMethod;
    withdrawal.notes = notes;
    await withdrawal.save();

    // Send notification to user
    try {
      await createNotification({
        userId: withdrawal.user._id,
        title: 'Withdrawal Processed',
        message: `Your withdrawal of ₹${withdrawal.amount} has been processed successfully. Transaction ID: ${transactionId}`,
        type: 'admin',
        data: {
          withdrawalId: withdrawal._id,
          amount: withdrawal.amount,
          status: 'processed',
          transactionId: transactionId
        },
        io: req.io
      });
    } catch (notificationError) {
      console.error('Error sending withdrawal processed notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal processed successfully',
      data: {
        withdrawal,
        transaction,
        newBalance: user.wallet
      }
    });
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: error.message
    });
  }
};

module.exports = {
  getWalletOverview,
  getProviderWallets,
  getGuestWallets,
  getAllTransactions,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawal
};