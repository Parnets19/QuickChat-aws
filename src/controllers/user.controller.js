const { User, Consultation, Review, Transaction } = require("../models");
const { AppError } = require("../middlewares/errorHandler");
const { uploadToCloudinary } = require("../utils/cloudinary");

// @desc    Get user profile
// @route   GET /api/users/profile/:id
// @access  Public
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-wallet -earnings -bankDetails")
      .populate("serviceCategories");

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Don't show hidden profiles
    if (user.isProfileHidden) {
      return next(new AppError("Profile not available", 404));
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      "fullName",
      "email",
      "dateOfBirth",
      "gender",
      "place",
      "address",
      "profession",
      "education",
      "hobbies",
      "skills",
      "languagesKnown",
      "bio",
    ];

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(req.user?._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload profile photo
// @route   POST /api/users/profile-photo
// @access  Private
const uploadProfilePhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError("Please upload a file", 400));
    }

    const result = await uploadToCloudinary(req.file.path, "skillhub/profiles");

    if (!result) {
      return next(new AppError("File upload failed", 500));
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      { profilePhoto: result.url },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Profile photo uploaded successfully",
      data: {
        profilePhoto: result.url,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload Aadhar documents
// @route   POST /api/users/aadhar
// @access  Private
const uploadAadhar = async (req, res, next) => {
  try {
    const { aadharNumber } = req.body;
    const files = req.files;

    if (!aadharNumber) {
      return next(new AppError("Aadhar number is required", 400));
    }

    if (!files || !files.front || !files.back) {
      return next(
        new AppError("Please upload both front and back of Aadhar card", 400)
      );
    }

    const frontResult = await uploadToCloudinary(
      files.front[0].path,
      "skillhub/aadhar"
    );
    const backResult = await uploadToCloudinary(
      files.back[0].path,
      "skillhub/aadhar"
    );

    if (!frontResult || !backResult) {
      return next(new AppError("File upload failed", 500));
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
        aadharNumber,
        aadharDocuments: {
          front: frontResult.url,
          back: backResult.url,
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Aadhar documents uploaded successfully. Verification pending.",
      data: {
        aadharNumber,
        aadharDocuments: user?.aadharDocuments,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Become a service provider
// @route   POST /api/users/become-provider
// @access  Private
const becomeProvider = async (req, res, next) => {
  try {
    const { serviceCategories, consultationModes, rates, availability } =
      req.body;

    if (!serviceCategories || serviceCategories.length === 0) {
      return next(
        new AppError("Please select at least one service category", 400)
      );
    }

    if (
      !consultationModes ||
      (!consultationModes.chat &&
        !consultationModes.audio &&
        !consultationModes.video)
    ) {
      return next(
        new AppError("Please enable at least one consultation mode", 400)
      );
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
        isServiceProvider: true,
        serviceCategories,
        consultationModes,
        rates,
        availability,
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "You are now a service provider!",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update service provider settings
// @route   PUT /api/users/provider-settings
// @access  Private
const updateProviderSettings = async (req, res, next) => {
  try {
    if (!req.user?.isServiceProvider) {
      return next(new AppError("You are not a service provider", 403));
    }

    // Get current user to preserve existing data
    const currentUser = await User.findById(req.user._id);

    const allowedFields = [
      "serviceCategories",
      "consultationModes",
      "rates",
      "availability",
      "portfolioMedia",
    ];

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // Special handling for rates to ensure nested objects are properly updated
    if (updateData.rates) {
      // Ensure the current user has the proper nested structure
      const currentRates = currentUser.rates || {};
      const currentPerMinute = currentRates.perMinute || { audio: 0, video: 0 };
      const currentPerHour = currentRates.perHour || { audio: 0, video: 0 };

      // Build the complete rates object with all nested structures
      const completeRates = {
        chat:
          updateData.rates.chat !== undefined
            ? updateData.rates.chat
            : currentRates.chat || 0,

        // Ensure perMinute object always exists with both audio and video
        perMinute: {
          audio:
            updateData.rates.perMinute?.audio !== undefined
              ? updateData.rates.perMinute.audio
              : currentPerMinute.audio,
          video:
            updateData.rates.perMinute?.video !== undefined
              ? updateData.rates.perMinute.video
              : currentPerMinute.video,
        },

        // Ensure perHour object always exists with both audio and video
        perHour: {
          audio:
            updateData.rates.perHour?.audio !== undefined
              ? updateData.rates.perHour.audio
              : currentPerHour.audio,
          video:
            updateData.rates.perHour?.video !== undefined
              ? updateData.rates.perHour.video
              : currentPerHour.video,
        },

        // Other rate fields
        defaultChargeType:
          updateData.rates.defaultChargeType ||
          currentRates.defaultChargeType ||
          "per-minute",

        // Legacy fields for backward compatibility
        audio:
          updateData.rates.audio !== undefined
            ? updateData.rates.audio
            : currentRates.audio || 0,
        video:
          updateData.rates.video !== undefined
            ? updateData.rates.video
            : currentRates.video || 0,
        chargeType:
          updateData.rates.chargeType ||
          updateData.rates.defaultChargeType ||
          currentRates.chargeType ||
          "per-minute",
      };

      // Update the user with the complete rates structure
      await User.findByIdAndUpdate(
        req.user._id,
        { $set: { rates: completeRates } },
        { new: true, runValidators: true }
      );

      // Remove rates from updateData since we handled it separately
      delete updateData.rates;
    }

    // Update other fields normally
    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    // Fetch the updated user to verify rates were saved correctly
    const updatedUser = await User.findById(req.user._id);

    res.status(200).json({
      success: true,
      message: "Provider settings updated successfully",
      data: updatedUser, // Return the freshly fetched user data
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle profile visibility
// @route   PUT /api/users/toggle-visibility
// @access  Private
const toggleProfileVisibility = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    user.isProfileHidden = !user.isProfileHidden;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Profile is now ${user.isProfileHidden ? "hidden" : "visible"}`,
      data: {
        isProfileHidden: user.isProfileHidden,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user dashboard
// @route   GET /api/users/dashboard
// @access  Private
const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const isProvider = req.user?.isServiceProvider;

    // Get upcoming consultations
    const upcomingConsultations = await Consultation.find({
      $or: [{ user: userId }, { provider: userId }],
      status: { $in: ["pending", "ongoing"] },
    })
      .populate("user", "fullName profilePhoto")
      .populate("provider", "fullName profilePhoto")
      .sort({ scheduledAt: 1 })
      .limit(5);

    // Get recent transactions
    const recentTransactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(10);

    // Get comprehensive stats
    const totalConsultations = await Consultation.countDocuments({
      $or: [{ user: userId }, { provider: userId }],
      status: "completed",
    });

    // Get provider-specific consultation count (only where user was the provider)
    const providerConsultationCount = await Consultation.countDocuments({
      provider: userId,
      status: "completed",
    });

    // Get client-specific consultation count (only where user was the client)
    const clientConsultationCount = await Consultation.countDocuments({
      user: userId,
      status: "completed",
    });

    const pendingConsultations = await Consultation.countDocuments({
      $or: [{ user: userId }, { provider: userId }],
      status: { $in: ["pending", "ongoing"] },
    });

    // Provider-specific stats
    let providerStats = {};
    if (isProvider) {
      const providerConsultations = await Consultation.find({
        provider: userId,
        status: "completed",
      })
        .populate("user", "fullName profilePhoto")
        .sort({ createdAt: -1 })
        .limit(5);

      const pendingWithdrawals = await Transaction.aggregate([
        { $match: { user: userId, type: "withdrawal", status: "pending" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const profileViews = req.user?.profileViews || 0;

      providerStats = {
        providerConsultations,
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
        profileViews,
        monthlyEarnings: req.user?.monthlyEarnings || 0,
      };
    }

    // User-specific stats
    let userStats = {};
    if (!isProvider || req.user?.hasUserFeatures) {
      const userActivity = await Transaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(5);

      const totalSpent = await Transaction.aggregate([
        {
          $match: {
            user: userId,
            type: { $in: ["consultation", "subscription"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      userStats = {
        userActivity,
        totalSpent: totalSpent[0]?.total || 0,
        subscriptionStatus: req.user?.subscriptionStatus || "Free",
        upcomingAppointments: pendingConsultations,
      };
    }

    // Get rating summary for providers
    let ratingSummary = null;
    if (isProvider) {
      const reviews = await Review.find({ provider: userId, status: "active" });
      ratingSummary = {
        average: req.user.rating?.average || 0,
        count: req.user.rating?.count || 0,
        breakdown: {
          5: reviews.filter((r) => r.rating === 5).length,
          4: reviews.filter((r) => r.rating === 4).length,
          3: reviews.filter((r) => r.rating === 3).length,
          2: reviews.filter((r) => r.rating === 2).length,
          1: reviews.filter((r) => r.rating === 1).length,
        },
      };
    }

    // Get notifications count
    const notificationsCount =
      req.user?.notifications?.filter((n) => !n.read).length || 0;

    // Performance metrics for providers
    let performanceMetrics = {};
    if (isProvider) {
      const thisMonth = new Date();
      thisMonth.setDate(1);
      thisMonth.setHours(0, 0, 0, 0);

      const monthlyConsultations = await Consultation.countDocuments({
        provider: userId,
        createdAt: { $gte: thisMonth },
      });

      const completedThisMonth = await Consultation.countDocuments({
        provider: userId,
        status: "completed",
        createdAt: { $gte: thisMonth },
      });

      performanceMetrics = {
        consultationRate:
          monthlyConsultations > 0
            ? Math.round((completedThisMonth / monthlyConsultations) * 100)
            : 0,
        clientSatisfaction: Math.round((req.user.rating?.average || 0) * 20), // Convert 5-star to percentage
        responseTime: req.user?.averageResponseTime || 78, // Default or calculated
        profileCompletion: calculateProfileCompletion(req.user),
      };
    }

    res.status(200).json({
      success: true,
      data: {
        // Common data
        upcomingConsultations,
        recentTransactions,
        stats: {
          totalConsultations,
          providerConsultationCount,
          clientConsultationCount,
          totalEarnings: req.user?.earnings || 0,
          walletBalance: req.user?.wallet || 0,
          notifications: notificationsCount,
        },
        ratingSummary,

        // Provider-specific data
        ...providerStats,
        performanceMetrics,

        // User-specific data
        ...userStats,

        // User info
        user: {
          fullName: req.user?.fullName,
          isServiceProvider: isProvider,
          profilePhoto: req.user?.profilePhoto,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to calculate profile completion percentage
const calculateProfileCompletion = (user) => {
  const requiredFields = [
    "fullName",
    "email",
    "profilePhoto",
    "bio",
    "skills",
    "languagesKnown",
    "profession",
    "place",
  ];

  let completedFields = 0;
  requiredFields.forEach((field) => {
    if (
      user[field] &&
      (Array.isArray(user[field]) ? user[field].length > 0 : true)
    ) {
      completedFields++;
    }
  });

  return Math.round((completedFields / requiredFields.length) * 100);
};

// @desc    Update bank details
// @route   PUT /api/users/bank-details
// @access  Private
const updateBankDetails = async (req, res, next) => {
  try {
    const { accountNumber, ifscCode, accountHolderName, bankName } = req.body;

    if (!accountNumber || !ifscCode || !accountHolderName || !bankName) {
      return next(new AppError("All bank details are required", 400));
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
        bankDetails: {
          accountNumber,
          ifscCode,
          accountHolderName,
          bankName,
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Bank details updated successfully",
      data: {
        bankDetails: user?.bankDetails,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search service providers
// @route   GET /api/users/search
// @access  Public
const searchProviders = async (req, res, next) => {
  try {
    // Handle optional authentication
    let currentUserId = null;
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUserId = decoded.id;
      } catch (error) {
        // Invalid token, continue as guest
      }
    }

    const {
      q, // General search query
      skill,
      category,
      language,
      profession,
      city,
      gender,
      minRating,
      maxPrice,
      consultationType,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: "active",
    };

    // Exclude current user from results if authenticated
    if (currentUserId) {
      // Convert string ID to ObjectId for proper comparison
      const mongoose = require("mongoose");
      try {
        // Validate ObjectId format before conversion
        if (mongoose.Types.ObjectId.isValid(currentUserId)) {
          query._id = { $ne: new mongoose.Types.ObjectId(currentUserId) };
        }
      } catch (error) {
        console.log("Invalid user ID format for exclusion:", currentUserId);
        // Continue without excluding user
      }
    }

    // General search query - searches across multiple fields
    if (q) {
      const searchRegex = new RegExp(q, "i");
      query.$or = [
        { fullName: searchRegex },
        { profession: searchRegex },
        { bio: searchRegex },
        { skills: { $in: [searchRegex] } },
        { languagesKnown: { $in: [searchRegex] } },
        { "place.city": searchRegex },
        { "place.state": searchRegex },
        { "place.country": searchRegex },
      ];
    }

    if (skill) {
      query.skills = { $in: [skill] };
    }

    if (category) {
      query.serviceCategories = category;
    }

    if (language) {
      query.languagesKnown = { $in: [language] };
    }

    if (profession) {
      query.profession = new RegExp(profession, "i");
    }

    if (city) {
      query["place.city"] = new RegExp(city, "i");
    }

    if (gender) {
      query.gender = gender;
    }

    if (minRating) {
      query["rating.average"] = { $gte: parseFloat(minRating) };
    }

    if (consultationType) {
      query[`consultationModes.${consultationType}`] = true;
    }

    if (maxPrice) {
      query[`rates.${consultationType || "chat"}`] = {
        $lte: parseFloat(maxPrice),
      };
    }

    const providers = await User.find(query)
      .select("-wallet -earnings -bankDetails -password")
      .populate("serviceCategories")
      .sort({ "rating.average": -1, isOnline: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: providers,
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

// @desc    Update consultation status (manual offline/online toggle)
// @route   PUT /api/users/consultation-status
// @access  Private (Service Provider only)
const updateConsultationStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['available', 'offline'].includes(status)) {
      return next(new AppError('Invalid status. Must be "available" or "offline"', 400));
    }

    // Check if provider is currently in an active consultation
    const activeConsultation = await Consultation.findOne({
      provider: req.user._id,
      status: { $in: ['ongoing', 'pending'] }
    });

    // Debug logging
    console.log('🔍 STATUS DEBUG - Provider ID:', req.user._id);
    console.log('🔍 STATUS DEBUG - Active consultation found:', activeConsultation);
    if (activeConsultation) {
      console.log('🔍 STATUS DEBUG - Consultation details:', {
        id: activeConsultation._id,
        status: activeConsultation.status,
        createdAt: activeConsultation.createdAt,
        startTime: activeConsultation.startTime,
        endTime: activeConsultation.endTime
      });
    }

    // Prevent going offline during active consultations
    if (status === 'offline' && activeConsultation) {
      // Check if the consultation is really active (has a recent startTime or is truly ongoing)
      const now = new Date();
      const consultationAge = now - new Date(activeConsultation.createdAt);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      
      // If consultation is older than 24 hours and still pending/ongoing, mark it as cancelled
      if (consultationAge > maxAge) {
        console.log('🧹 CLEANUP: Found old stuck consultation, marking as cancelled:', activeConsultation._id);
        activeConsultation.status = 'cancelled';
        activeConsultation.endTime = now;
        await activeConsultation.save();
        
        // Continue with status update since we cleaned up the stuck consultation
      } else {
        return next(new AppError('Cannot go offline during an active consultation', 400));
      }
    }

    // Update the consultation status
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { consultationStatus: status },
      { new: true }
    ).select('consultationStatus fullName');

    // Emit status change to all connected clients via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('providerStatusChanged', {
        providerId: req.user._id,
        status: status,
        providerName: user.fullName
      });
    }

    res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      data: {
        consultationStatus: user.consultationStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserProfile,
  updateProfile,
  uploadProfilePhoto,
  uploadAadhar,
  becomeProvider,
  updateProviderSettings,
  toggleProfileVisibility,
  getDashboard,
  updateBankDetails,
  searchProviders,
  updateConsultationStatus,
};
