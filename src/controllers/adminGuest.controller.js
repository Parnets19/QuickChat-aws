const { Guest, Transaction, Consultation, Withdrawal } = require('../models');
const { logger } = require('../utils/logger');

// Get all guests with filtering and pagination
const getAllGuests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      minWallet = null,
      maxWallet = null
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== 'all') {
      filter.status = status;
    }

    if (minWallet !== null) {
      filter.wallet = { $gte: parseFloat(minWallet) };
    }

    if (maxWallet !== null) {
      filter.wallet = { ...filter.wallet, $lte: parseFloat(maxWallet) };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const guests = await Guest.find(filter)
      .select('name mobile wallet totalSpent status isOnline lastActive createdAt isMobileVerified')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get additional statistics for each guest
    const enhancedGuests = await Promise.all(
      guests.map(async (guest) => {
        const [transactionCount, consultationCount, withdrawalCount, totalWithdrawn] = await Promise.all([
          Transaction.countDocuments({ user: guest._id, userType: 'Guest' }),
          Consultation.countDocuments({ user: guest._id }),
          Withdrawal.countDocuments({ user: guest._id, userType: 'Guest' }),
          Withdrawal.aggregate([
            { 
              $match: { 
                user: guest._id, 
                userType: 'Guest', 
                status: { $in: ['approved', 'processed'] } 
              } 
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ])
        ]);

        return {
          ...guest,
          transactionCount,
          consultationCount,
          withdrawalCount,
          totalWithdrawn: totalWithdrawn[0]?.total || 0,
          lastActiveFormatted: guest.lastActive ? new Date(guest.lastActive).toLocaleDateString() : 'Never',
          joinedDate: guest.createdAt ? new Date(guest.createdAt).toLocaleDateString() : 'Unknown',
          walletStatus: guest.wallet > 0 ? 'Has Balance' : 'Empty'
        };
      })
    );

    // Get total count for pagination
    const total = await Guest.countDocuments(filter);

    // Get summary statistics
    const summary = await Guest.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalGuests: { $sum: 1 },
          totalWalletBalance: { $sum: '$wallet' },
          totalSpent: { $sum: '$totalSpent' },
          averageWallet: { $avg: '$wallet' },
          activeGuests: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
            }
          },
          onlineGuests: {
            $sum: {
              $cond: [{ $eq: ['$isOnline', true] }, 1, 0]
            }
          },
          verifiedGuests: {
            $sum: {
              $cond: [{ $eq: ['$isMobileVerified', true] }, 1, 0]
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: enhancedGuests,
      summary: summary[0] || {
        totalGuests: 0,
        totalWalletBalance: 0,
        totalSpent: 0,
        averageWallet: 0,
        activeGuests: 0,
        onlineGuests: 0,
        verifiedGuests: 0
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching guests:', error);
    logger.error('Error fetching guests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guests',
      error: error.message
    });
  }
};

// Get specific guest details
const getGuestById = async (req, res) => {
  try {
    const { id } = req.params;

    const guest = await Guest.findById(id).lean();
    
    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    // Get detailed statistics
    const [transactions, consultations, withdrawals, recentActivity] = await Promise.all([
      Transaction.find({ user: guest._id, userType: 'Guest' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Consultation.find({ user: guest._id })
        .populate('provider', 'fullName')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Withdrawal.find({ user: guest._id, userType: 'Guest' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      // Get recent activity (transactions + consultations)
      Promise.all([
        Transaction.find({ user: guest._id, userType: 'Guest' })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        Consultation.find({ user: guest._id })
          .populate('provider', 'fullName')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean()
      ])
    ]);

    // Combine and sort recent activity
    const combinedActivity = [
      ...recentActivity[0].map(t => ({ ...t, type: 'transaction' })),
      ...recentActivity[1].map(c => ({ ...c, type: 'consultation' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);

    // Calculate totals
    const totalSpentOnConsultations = consultations.reduce((sum, c) => sum + (c.totalAmount || 0), 0);
    const totalTransactionAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const totalWithdrawn = withdrawals
      .filter(w => ['approved', 'processed'].includes(w.status))
      .reduce((sum, w) => sum + (w.amount || 0), 0);

    const enhancedGuest = {
      ...guest,
      statistics: {
        totalTransactions: transactions.length,
        totalConsultations: consultations.length,
        totalWithdrawals: withdrawals.length,
        totalSpentOnConsultations,
        totalTransactionAmount,
        totalWithdrawn,
        accountAge: Math.floor((new Date() - new Date(guest.createdAt)) / (1000 * 60 * 60 * 24)), // days
        lastActiveFormatted: guest.lastActive ? new Date(guest.lastActive).toLocaleDateString() : 'Never'
      },
      recentTransactions: transactions,
      recentConsultations: consultations,
      recentWithdrawals: withdrawals,
      recentActivity: combinedActivity
    };

    res.status(200).json({
      success: true,
      data: enhancedGuest
    });
  } catch (error) {
    console.error('Error fetching guest details:', error);
    logger.error('Error fetching guest details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guest details',
      error: error.message
    });
  }
};

// Update guest information
const updateGuest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const guest = await Guest.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    logger.info(`Admin updated guest ${id}:`, updateData);

    res.status(200).json({
      success: true,
      message: 'Guest updated successfully',
      data: guest
    });
  } catch (error) {
    console.error('Error updating guest:', error);
    logger.error('Error updating guest:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update guest',
      error: error.message
    });
  }
};

// Update guest status
const updateGuestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, inactive, or suspended'
      });
    }

    const guest = await Guest.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    logger.info(`Admin updated guest ${id} status to ${status}`);

    res.status(200).json({
      success: true,
      message: `Guest status updated to ${status}`,
      data: guest
    });
  } catch (error) {
    console.error('Error updating guest status:', error);
    logger.error('Error updating guest status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update guest status',
      error: error.message
    });
  }
};

// Add money to guest wallet (admin function)
const addMoneyToGuestWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description = 'Admin wallet credit' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    const guest = await Guest.findById(id);
    
    if (!guest) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found'
      });
    }

    // Update guest wallet
    const previousBalance = guest.wallet || 0;
    guest.wallet = previousBalance + parseFloat(amount);
    await guest.save();

    // Create transaction record
    const transaction = new Transaction({
      user: guest._id,
      userType: 'Guest',
      type: 'credit',
      category: 'adjustment',
      amount: parseFloat(amount),
      balance: guest.wallet,
      description,
      status: 'completed',
      metadata: {
        adminCredit: true,
        adminId: req.user._id,
        previousBalance,
        newBalance: guest.wallet
      }
    });

    await transaction.save();

    logger.info(`Admin added ₹${amount} to guest ${id} wallet`);

    res.status(200).json({
      success: true,
      message: `₹${amount} added to guest wallet successfully`,
      data: {
        guest: {
          id: guest._id,
          name: guest.name,
          previousBalance,
          newBalance: guest.wallet,
          amountAdded: parseFloat(amount)
        },
        transaction: transaction
      }
    });
  } catch (error) {
    console.error('Error adding money to guest wallet:', error);
    logger.error('Error adding money to guest wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add money to guest wallet',
      error: error.message
    });
  }
};

// Get guest statistics for dashboard
const getGuestStatistics = async (req, res) => {
  try {
    const stats = await Guest.aggregate([
      {
        $group: {
          _id: null,
          totalGuests: { $sum: 1 },
          activeGuests: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          suspendedGuests: {
            $sum: { $cond: [{ $eq: ['$status', 'suspended'] }, 1, 0] }
          },
          verifiedGuests: {
            $sum: { $cond: [{ $eq: ['$isMobileVerified', true] }, 1, 0] }
          },
          onlineGuests: {
            $sum: { $cond: [{ $eq: ['$isOnline', true] }, 1, 0] }
          },
          totalWalletBalance: { $sum: '$wallet' },
          totalSpent: { $sum: '$totalSpent' },
          averageWallet: { $avg: '$wallet' },
          averageSpent: { $avg: '$totalSpent' }
        }
      }
    ]);

    // Get recent registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRegistrations = await Guest.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Get top spenders
    const topSpenders = await Guest.find({ totalSpent: { $gt: 0 } })
      .sort({ totalSpent: -1 })
      .limit(5)
      .select('name mobile totalSpent wallet')
      .lean();

    const result = {
      ...(stats[0] || {
        totalGuests: 0,
        activeGuests: 0,
        suspendedGuests: 0,
        verifiedGuests: 0,
        onlineGuests: 0,
        totalWalletBalance: 0,
        totalSpent: 0,
        averageWallet: 0,
        averageSpent: 0
      }),
      recentRegistrations,
      topSpenders
    };

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching guest statistics:', error);
    logger.error('Error fetching guest statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guest statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllGuests,
  getGuestById,
  updateGuest,
  updateGuestStatus,
  addMoneyToGuestWallet,
  getGuestStatistics
};