const User = require('../models/User.model');
const Consultation = require('../models/Consultation.model');

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

    // TODO: Send notification to provider about status change
    // TODO: Log admin action

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
      activeProviders,
      suspendedProviders,
      totalConsultations,
      todayConsultations
    ] = await Promise.all([
      User.countDocuments({ isServiceProvider: false }),
      User.countDocuments({ isServiceProvider: true }),
      User.countDocuments({ isServiceProvider: true, status: 'active' }),
      User.countDocuments({ isServiceProvider: true, status: 'suspended' }),
      Consultation.countDocuments(),
      Consultation.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          providers: totalProviders,
          activeProviders,
          suspendedProviders
        },
        consultations: {
          total: totalConsultations,
          today: todayConsultations
        }
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
      .select('fullName email mobile aadharNumber aadharDocuments profilePhoto portfolioMedia providerVerificationStatus verificationNotes verifiedAt verifiedBy createdAt updatedAt')
      .populate('verifiedBy', 'fullName email')
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
      .select('fullName email mobile dateOfBirth gender place profession education hobbies skills languagesKnown bio aadharNumber aadharDocuments profilePhoto portfolioMedia serviceCategories consultationModes rates availability bankDetails providerVerificationStatus verificationNotes verifiedAt verifiedBy createdAt updatedAt')
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

    // TODO: Send notification to provider about verification status
    // TODO: Log admin action

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
  bulkVerifyExistingProviders
};