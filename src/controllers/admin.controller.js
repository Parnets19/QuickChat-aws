const User = require('../models/User.model');
const Consultation = require('../models/Consultation.model');
const { sendStatusChangeNotification, sendVerificationNotification, sendProfileVisibilityNotification } = require('../utils/notifications');

// Get all providers with filtering and pagination
const getAllProviders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      role = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter query
    const filter = {};
    
    // Role filter
    if (role === 'provider') {
      filter.isServiceProvider = true;
    } else if (role === 'user') {
      filter.isServiceProvider = false;
    }

    // Status filter
    if (status !== 'all') {
      filter.status = status;
    }

    // Search filter
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { profession: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const providers = await User.find(filter)
      .select('-password -fcmTokens -socialLogins')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await User.countDocuments(filter);

    // Enhance provider data with consultation counts
    const enhancedProviders = await Promise.all(
      providers.map(async (provider) => {
        const consultationCount = await Consultation.countDocuments({
          providerId: provider._id
        });

        return {
          ...provider,
          consultationCount,
          totalEarnings: provider.earnings || 0,
          walletBalance: provider.wallet || 0,
          lastActiveFormatted: provider.lastActive ? new Date(provider.lastActive).toLocaleDateString() : 'Never',
          joinedDate: provider.createdAt ? new Date(provider.createdAt).toLocaleDateString() : 'Unknown'
        };
      })
    );

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
    console.error('Error fetching providers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch providers',
      error: error.message
    });
  }
};

// Get specific provider by ID
const getProviderById = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await User.findById(id)
      .select('-password -fcmTokens')
      .lean();

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Get consultation statistics
    const consultationStats = await Consultation.aggregate([
      { $match: { providerId: provider._id } },
      {
        $group: {
          _id: null,
          totalConsultations: { $sum: 1 },
          completedConsultations: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalEarnings: { $sum: '$providerEarnings' }
        }
      }
    ]);

    const stats = consultationStats[0] || {
      totalConsultations: 0,
      completedConsultations: 0,
      totalEarnings: 0
    };

    res.status(200).json({
      success: true,
      data: {
        ...provider,
        consultationStats: stats
      }
    });
  } catch (error) {
    console.error('Error fetching provider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch provider details',
      error: error.message
    });
  }
};

// Update provider information
const updateProvider = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields that shouldn't be updated via admin
    delete updateData.password;
    delete updateData.fcmTokens;
    delete updateData.socialLogins;

    const provider = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password -fcmTokens');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Provider updated successfully',
      data: provider
    });
  } catch (error) {
    console.error('Error updating provider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update provider',
      error: error.message
    });
  }
};

// Update provider status (active/suspended/inactive)
const updateProviderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, suspended, or inactive'
      });
    }

    const provider = await User.findByIdAndUpdate(
      id,
      { 
        $set: { 
          status,
          // If suspended, also hide profile and set offline
          ...(status === 'suspended' && {
            isProfileHidden: true,
            consultationStatus: 'offline',
            isOnline: false
          })
        }
      },
      { new: true }
    ).select('-password -fcmTokens');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Send notification to provider about status change
    try {
      await sendStatusChangeNotification(provider._id, status, req.io);
    } catch (notificationError) {
      console.error('Error sending status change notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(200).json({
      success: true,
      message: `Provider status updated to ${status}`,
      data: provider
    });
  } catch (error) {
    console.error('Error updating provider status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update provider status',
      error: error.message
    });
  }
};

// Toggle provider profile visibility
const toggleProviderVisibility = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await User.findById(id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Toggle visibility
    provider.isProfileHidden = !provider.isProfileHidden;
    await provider.save();

    // Send notification to provider about visibility change
    try {
      await sendProfileVisibilityNotification(provider._id, provider.isProfileHidden, req.io);
    } catch (notificationError) {
      console.error('Error sending profile visibility notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(200).json({
      success: true,
      message: `Provider profile ${provider.isProfileHidden ? 'hidden' : 'visible'}`,
      data: {
        id: provider._id,
        isProfileHidden: provider.isProfileHidden
      }
    });
  } catch (error) {
    console.error('Error toggling provider visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle provider visibility',
      error: error.message
    });
  }
};

// Get admin dashboard statistics
const getAdminStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalProviders,
      totalGuests,
      activeProviders,
      suspendedProviders,
      totalConsultations,
      todayConsultations,
      completedConsultations,
      pendingConsultations,
      totalTransactions,
      totalRevenue,
      todayRevenue,
      pendingWithdrawals,
      totalWithdrawals,
      onlineUsers,
      verifiedProviders,
      pendingKyc
    ] = await Promise.all([
      User.countDocuments({ isServiceProvider: false }),
      User.countDocuments({ isServiceProvider: true }),
      require('../models/Guest.model').countDocuments(),
      User.countDocuments({ isServiceProvider: true, status: 'active' }),
      User.countDocuments({ isServiceProvider: true, status: 'suspended' }),
      Consultation.countDocuments(),
      Consultation.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      Consultation.countDocuments({ status: 'completed' }),
      Consultation.countDocuments({ status: 'pending' }),
      require('../models/Transaction.model').countDocuments(),
      // Fix: Use Consultation model for revenue calculation instead of Transaction
      Consultation.aggregate([
        { $match: { status: 'completed', totalAmount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Consultation.aggregate([
        { 
          $match: { 
            status: 'completed',
            totalAmount: { $gt: 0 },
            createdAt: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0))
            }
          } 
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      require('../models/Withdrawal.model').countDocuments({ status: 'pending' }),
      require('../models/Withdrawal.model').countDocuments(),
      User.countDocuments({ isOnline: true }),
      User.countDocuments({ isServiceProvider: true, providerVerificationStatus: 'verified' }),
      User.countDocuments({ isServiceProvider: true, providerVerificationStatus: 'pending' })
    ]);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentUsers = await User.find({
      createdAt: { $gte: sevenDaysAgo }
    }).sort({ createdAt: -1 }).limit(10).select('fullName email createdAt isServiceProvider');

    const recentConsultations = await Consultation.find({
      createdAt: { $gte: sevenDaysAgo }
    }).sort({ createdAt: -1 }).limit(10)
      .populate('user', 'fullName')
      .populate('provider', 'fullName')
      .select('status totalAmount createdAt');

    // Get daily stats for the last 7 days
    const dailyStats = await Promise.all([
      // Daily user registrations
      User.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            users: { $sum: 1 },
            providers: {
              $sum: { $cond: [{ $eq: ['$isServiceProvider', true] }, 1, 0] }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      // Daily consultations
      Consultation.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            consultations: { $sum: 1 },
            revenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Combine daily stats
    const chartData = [];
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      last7Days.push(dateStr);
    }

    last7Days.forEach(date => {
      const userStat = dailyStats[0].find(stat => stat._id === date) || { users: 0, providers: 0 };
      const consultationStat = dailyStats[1].find(stat => stat._id === date) || { consultations: 0, revenue: 0 };
      
      chartData.push({
        date,
        name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
        users: userStat.users,
        providers: userStat.providers,
        consultations: consultationStat.consultations,
        revenue: consultationStat.revenue || 0
      });
    });

    // Get monthly revenue for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await Consultation.aggregate([
      {
        $match: {
          status: 'completed',
          totalAmount: { $gt: 0 },
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Format monthly revenue data
    const revenueData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const monthData = monthlyRevenue.find(item => 
        item._id.year === year && item._id.month === month
      );
      
      revenueData.push({
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        revenue: monthData ? monthData.revenue : 0
      });
    }

    // Get top performing providers
    const topProviders = await Consultation.aggregate([
      { $match: { status: 'completed', totalAmount: { $gt: 0 } } },
      {
        $group: {
          _id: '$provider',
          totalEarnings: { $sum: '$totalAmount' },
          consultationCount: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'provider'
        }
      },
      { $unwind: '$provider' },
      {
        $project: {
          name: '$provider.fullName',
          earnings: '$totalEarnings',
          consultations: '$consultationCount'
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers: totalUsers + totalProviders + totalGuests, // All users: regular + providers + guests
          totalProviders,
          totalGuests,
          activeProviders,
          suspendedProviders,
          verifiedProviders,
          pendingKyc,
          onlineUsers
        },
        consultations: {
          total: totalConsultations,
          today: todayConsultations,
          completed: completedConsultations,
          pending: pendingConsultations
        },
        financial: {
          totalRevenue: totalRevenue[0]?.total || 0,
          todayRevenue: todayRevenue[0]?.total || 0,
          totalTransactions,
          pendingWithdrawals,
          totalWithdrawals
        },
        charts: {
          dailyActivity: chartData,
          monthlyRevenue: revenueData
        },
        recentActivity: {
          users: recentUsers,
          consultations: recentConsultations
        },
        topProviders
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics',
      error: error.message
    });
  }
};

// Temporary endpoint to make current user admin (for testing)
const makeCurrentUserAdmin = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAdmin: true },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'User is now an admin',
      data: {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Error making user admin:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to make user admin',
      error: error.message
    });
  }
};

// Create admin user if it doesn't exist
const createAdminUser = async (req, res, next) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'Admin credentials not configured in environment variables'
      });
    }

    // Check if admin user already exists
    let adminUser = await User.findOne({ email: adminEmail });

    if (adminUser) {
      // Update existing user to be admin
      adminUser.isAdmin = true;
      adminUser.isServiceProvider = true; // Make admin also a service provider for testing
      await adminUser.save();

      return res.status(200).json({
        success: true,
        message: 'Admin user already exists and has been updated',
        data: {
          id: adminUser._id,
          email: adminUser.email,
          isAdmin: adminUser.isAdmin
        }
      });
    }

    // Create new admin user
    adminUser = new User({
      fullName: 'System Administrator',
      email: adminEmail,
      mobile: '+91 9999999999', // Default admin mobile
      password: adminPassword,
      isAdmin: true,
      isServiceProvider: true,
      isEmailVerified: true,
      isMobileVerified: true,
      status: 'active'
    });

    await adminUser.save();

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        id: adminUser._id,
        email: adminUser.email,
        isAdmin: adminUser.isAdmin
      }
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin user',
      error: error.message
    });
  }
};

// Get all KYC requests with filtering
const getKycRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'all',
      search = ''
    } = req.query;

    // Build filter query - only service providers
    const filter = { isServiceProvider: true };
    
    // Status filter
    if (status !== 'all') {
      filter.providerVerificationStatus = status;
    }

    // Search filter
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { aadharNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const kycRequests = await User.find(filter)
      .select('-password -fcmTokens -socialLogins') // Exclude sensitive fields only
      .populate('verifiedBy', 'fullName email')
      .populate('serviceCategories')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: kycRequests,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching KYC requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch KYC requests',
      error: error.message
    });
  }
};

// Get specific KYC request by ID
const getKycRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const kycRequest = await User.findById(id)
      .select('fullName email mobile dateOfBirth gender place profession education hobbies skills languagesKnown bio aadharNumber aadharDocuments profilePhoto portfolioMedia portfolioLinks serviceCategories consultationModes rates availability bankDetails providerVerificationStatus verificationNotes verifiedAt verifiedBy createdAt updatedAt')
      .populate('verifiedBy', 'fullName email')
      .populate('serviceCategories')
      .lean();

    if (!kycRequest) {
      return res.status(404).json({
        success: false,
        message: 'KYC request not found'
      });
    }

    res.status(200).json({
      success: true,
      data: kycRequest
    });
  } catch (error) {
    console.error('Error fetching KYC request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch KYC request details',
      error: error.message
    });
  }
};

// Verify/Approve KYC request
const verifyKycRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be verified or rejected'
      });
    }

    const updateData = {
      providerVerificationStatus: status,
      verificationNotes: notes || '',
      verifiedAt: new Date(),
      verifiedBy: req.user._id
    };

    // If verified, also mark Aadhar as verified
    if (status === 'verified') {
      updateData.isAadharVerified = true;
    }

    const provider = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).select('-password -fcmTokens');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Send notification to provider about verification status
    try {
      await sendVerificationNotification(provider._id, status, notes, req.io);
    } catch (notificationError) {
      console.error('Error sending verification notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(200).json({
      success: true,
      message: `Provider ${status === 'verified' ? 'verified' : 'rejected'} successfully`,
      data: provider
    });
  } catch (error) {
    console.error('Error verifying KYC request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify KYC request',
      error: error.message
    });
  }
};

// Bulk verify existing providers (for migration)
const bulkVerifyExistingProviders = async (req, res) => {
  try {
    // Find all existing service providers who don't have verification status set
    const existingProviders = await User.find({
      isServiceProvider: true,
      $or: [
        { providerVerificationStatus: { $exists: false } },
        { providerVerificationStatus: 'pending' }
      ]
    });

    console.log(`Found ${existingProviders.length} existing providers to verify`);

    // Update all existing providers to verified status
    const updateResult = await User.updateMany(
      {
        isServiceProvider: true,
        $or: [
          { providerVerificationStatus: { $exists: false } },
          { providerVerificationStatus: 'pending' }
        ]
      },
      {
        $set: {
          providerVerificationStatus: 'verified',
          verificationNotes: 'Bulk verified - existing provider',
          verifiedAt: new Date(),
          verifiedBy: req.user._id,
          isAadharVerified: true
        }
      }
    );

    res.status(200).json({
      success: true,
      message: `Successfully verified ${updateResult.modifiedCount} existing providers`,
      data: {
        foundProviders: existingProviders.length,
        modifiedCount: updateResult.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error bulk verifying providers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk verify providers',
      error: error.message
    });
  }
};

// Fix user roles - assign proper roles based on user data
const fixUserRoles = async (req, res) => {
  try {
    console.log('🔧 Starting user role fix...');

    // Get all users with null roles
    const usersWithNullRoles = await User.find({ 
      $or: [
        { role: null },
        { role: { $exists: false } },
        { role: '' }
      ]
    });

    console.log(`Found ${usersWithNullRoles.length} users with null/missing roles`);
    
    let providersFixed = 0;
    let usersFixed = 0;

    for (const user of usersWithNullRoles) {
      let newRole = 'user'; // default role
      
      // Check if user has provider-like fields
      if (user.profession || user.experience || user.callRate || user.isServiceProvider) {
        newRole = 'provider';
        providersFixed++;
      } else {
        usersFixed++;
      }
      
      // Update the user's role
      await User.findByIdAndUpdate(user._id, { role: newRole });
      console.log(`Updated ${user.fullName || user.email} to role: ${newRole}`);
    }

    // Get updated counts
    const totalProviders = await User.countDocuments({ role: 'provider' });
    const totalUsers = await User.countDocuments({ role: 'user' });

    console.log('✅ User roles fixed successfully');

    res.status(200).json({
      success: true,
      message: 'User roles have been fixed successfully',
      data: {
        usersProcessed: usersWithNullRoles.length,
        providersFixed,
        usersFixed,
        finalCounts: {
          totalProviders,
          totalUsers
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fixing user roles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix user roles',
      error: error.message
    });
  }
};

// Get all reports and blocks
const getReportsAndBlocks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type = 'all', // 'reports', 'blocks', or 'all'
      status = 'all', // 'pending', 'reviewed', 'resolved', or 'all'
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Get all users with reports or blocks
    const users = await User.find({
      $or: [
        { 'reportedUsers.0': { $exists: true } },
        { 'blockedUsers.0': { $exists: true } }
      ]
    })
    .select('fullName email mobile reportedUsers blockedUsers')
    .populate('reportedUsers.userId', 'fullName email mobile profilePhoto')
    .populate('blockedUsers.userId', 'fullName email mobile profilePhoto')
    .lean();

    // Flatten and format the data
    let allItems = [];

    users.forEach(user => {
      // Add reports
      if (type === 'all' || type === 'reports') {
        user.reportedUsers?.forEach(report => {
          if (status === 'all' || report.status === status) {
            allItems.push({
              type: 'report',
              id: report._id,
              reporter: {
                id: user._id,
                name: user.fullName,
                email: user.email,
                mobile: user.mobile
              },
              reported: report.userId,
              reason: report.reason,
              description: report.description,
              status: report.status,
              date: report.reportedAt,
              createdAt: report.reportedAt
            });
          }
        });
      }

      // Add blocks
      if (type === 'all' || type === 'blocks') {
        user.blockedUsers?.forEach(block => {
          allItems.push({
            type: 'block',
            id: block._id,
            blocker: {
              id: user._id,
              name: user.fullName,
              email: user.email,
              mobile: user.mobile
            },
            blocked: block.userId,
            reason: block.reason,
            date: block.blockedAt,
            createdAt: block.blockedAt
          });
        });
      }
    });

    // Sort
    allItems.sort((a, b) => {
      const aVal = a[sortBy] || a.date;
      const bVal = b[sortBy] || b.date;
      return sortOrder === 'desc' 
        ? new Date(bVal) - new Date(aVal)
        : new Date(aVal) - new Date(bVal);
    });

    // Paginate
    const skip = (page - 1) * limit;
    const paginatedItems = allItems.slice(skip, skip + parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        items: paginatedItems,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(allItems.length / limit),
          totalItems: allItems.length,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reports and blocks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports and blocks',
      error: error.message
    });
  }
};

// Update report status
const updateReportStatus = async (req, res) => {
  try {
    const { userId, reportId } = req.params;
    const { status } = req.body;

    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be pending, reviewed, or resolved'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const report = user.reportedUsers.id(reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    report.status = status;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Report status updated successfully',
      data: report
    });
  } catch (error) {
    console.error('Error updating report status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update report status',
      error: error.message
    });
  }
};

module.exports = {
  getAllProviders,
  getProviderById,
  updateProvider,
  updateProviderStatus,
  toggleProviderVisibility,
  getAdminStats,
  makeCurrentUserAdmin,
  createAdminUser,
  getKycRequests,
  getKycRequestById,
  verifyKycRequest,
  bulkVerifyExistingProviders,
  fixUserRoles,
  getReportsAndBlocks,
  updateReportStatus
};