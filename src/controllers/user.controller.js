const { User, Consultation, Review, Transaction } = require("../models");
const Notification = require("../models/Notification.model");
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

    console.log("🔍 Upload Debug - File path:", req.file.path);
    console.log("🔍 Upload Debug - File name:", req.file.filename);
    console.log("🔍 Upload Debug - Original name:", req.file.originalname);

    // Ensure uploads directory exists
    const fs = require("fs");
    const path = require("path");
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("✅ Created uploads directory");
    }

    const result = await uploadToCloudinary(req.file.path, "skillhub/profiles");

    console.log("🔍 Upload Debug - Result URL:", result.url);

    if (!result || !result.url) {
      return next(new AppError("File upload failed - no URL returned", 500));
    }

    // If user is authenticated, update their profile
    if (req.user?._id) {
      const user = await User.findByIdAndUpdate(
        req.user._id,
        { profilePhoto: result.url },
        { new: true }
      );
      console.log(
        "🔍 Upload Debug - User updated:",
        user.fullName,
        "Photo:",
        user.profilePhoto
      );
    }

    res.status(200).json({
      success: true,
      message: "Profile photo uploaded successfully",
      data: {
        profilePhoto: result.url,
        url: result.url, // Ensure both formats are available
      },
    });
  } catch (error) {
    console.error("❌ Profile photo upload error:", error);
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

    if (!files || !files.front) {
      return next(new AppError("Please upload Aadhar card document", 400));
    }

    // Ensure uploads directory exists
    const fs = require("fs");
    const path = require("path");
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("✅ Created uploads directory");
    }

    const frontResult = await uploadToCloudinary(
      files.front[0].path,
      "skillhub/aadhar"
    );

    let backResult = null;
    if (files.back && files.back[0]) {
      backResult = await uploadToCloudinary(
        files.back[0].path,
        "skillhub/aadhar"
      );
    }

    if (!frontResult || !frontResult.url) {
      return next(
        new AppError("Aadhar document upload failed - no URL returned", 500)
      );
    }

    // If user is authenticated, update their profile
    let user = null;
    if (req.user?._id) {
      user = await User.findByIdAndUpdate(
        req.user._id,
        {
          aadharNumber,
          aadharDocuments: {
            front: frontResult.url,
            back: backResult ? backResult.url : "",
          },
        },
        { new: true }
      );
    }

    const aadharDocuments = {
      front: frontResult.url,
      back: backResult ? backResult.url : "",
    };

    res.status(200).json({
      success: true,
      message: "Aadhar documents uploaded successfully. Verification pending.",
      data: {
        aadharNumber,
        aadharDocuments: user?.aadharDocuments || aadharDocuments,
        front: frontResult.url, // Ensure both formats are available
        back: backResult ? backResult.url : "",
      },
    });
  } catch (error) {
    console.error("❌ Aadhar upload error:", error);
    next(error);
  }
};

// @desc    Upload portfolio media
// @route   POST /api/users/portfolio
// @access  Private
const uploadPortfolio = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError("Please upload a file", 400));
    }

    // Ensure uploads directory exists
    const fs = require("fs");
    const path = require("path");
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("✅ Created uploads directory");
    }

    const result = await uploadToCloudinary(
      req.file.path,
      "skillhub/portfolio"
    );

    if (!result || !result.url) {
      return next(
        new AppError("Portfolio upload failed - no URL returned", 500)
      );
    }

    // If user is authenticated, add to their portfolio
    if (req.user?._id) {
      const user = await User.findById(req.user._id);

      if (!user.portfolioMedia) {
        user.portfolioMedia = [];
      }

      // Determine media type based on file extension
      const fileExtension = req.file.originalname
        .split(".")
        .pop()
        .toLowerCase();
      const mediaType = ["jpg", "jpeg", "png", "gif", "webp"].includes(
        fileExtension
      )
        ? "image"
        : "video";

      user.portfolioMedia.push({
        type: mediaType,
        url: result.url,
      });

      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "Portfolio media uploaded successfully",
      data: {
        url: result.url,
        type: req.file.mimetype.startsWith("image/") ? "image" : "video",
      },
    });
  } catch (error) {
    console.error("❌ Portfolio upload error:", error);
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
        providerVerificationStatus: "pending", // Set to pending when becoming provider
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
      console.log(
        "🔍 BACKEND DEBUG: Received rates data:",
        JSON.stringify(updateData.rates, null, 2)
      );

      // Ensure the current user has the proper nested structure
      const currentRates = currentUser.rates || {};
      const currentPerMinute = currentRates.perMinute || {
        audioVideo: 0,
        audio: 0,
        video: 0,
      };
      const currentPerHour = currentRates.perHour || {
        audioVideo: 0,
        audio: 0,
        video: 0,
      };

      console.log(
        "🔍 BACKEND DEBUG: Current rates in DB:",
        JSON.stringify(currentRates, null, 2)
      );

      // Build the complete rates object with all nested structures
      const completeRates = {
        chat:
          updateData.rates.chat !== undefined
            ? updateData.rates.chat
            : currentRates.chat || 0,

        // Ensure perMinute object always exists with audioVideo and legacy fields
        perMinute: {
          audioVideo:
            updateData.rates.perMinute?.audioVideo !== undefined
              ? updateData.rates.perMinute.audioVideo
              : currentPerMinute.audioVideo || 0,
          // Legacy fields for backward compatibility
          audio:
            updateData.rates.perMinute?.audio !== undefined
              ? updateData.rates.perMinute.audio
              : updateData.rates.perMinute?.audioVideo !== undefined
              ? updateData.rates.perMinute.audioVideo
              : currentPerMinute.audio || 0,
          video:
            updateData.rates.perMinute?.video !== undefined
              ? updateData.rates.perMinute.video
              : updateData.rates.perMinute?.audioVideo !== undefined
              ? updateData.rates.perMinute.audioVideo
              : currentPerMinute.video || 0,
        },

        // Ensure perHour object always exists with audioVideo and legacy fields
        perHour: {
          audioVideo:
            updateData.rates.perHour?.audioVideo !== undefined
              ? updateData.rates.perHour.audioVideo
              : currentPerHour.audioVideo || 0,
          // Legacy fields for backward compatibility
          audio:
            updateData.rates.perHour?.audio !== undefined
              ? updateData.rates.perHour.audio
              : updateData.rates.perHour?.audioVideo !== undefined
              ? updateData.rates.perHour.audioVideo
              : currentPerHour.audio || 0,
          video:
            updateData.rates.perHour?.video !== undefined
              ? updateData.rates.perHour.video
              : updateData.rates.perHour?.audioVideo !== undefined
              ? updateData.rates.perHour.audioVideo
              : currentPerHour.video || 0,
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
            : updateData.rates.perMinute?.audioVideo !== undefined ||
              updateData.rates.perHour?.audioVideo !== undefined
            ? updateData.rates.defaultChargeType === "per-minute"
              ? updateData.rates.perMinute?.audioVideo || 0
              : updateData.rates.perHour?.audioVideo || 0
            : currentRates.audio || 0,
        video:
          updateData.rates.video !== undefined
            ? updateData.rates.video
            : updateData.rates.perMinute?.audioVideo !== undefined ||
              updateData.rates.perHour?.audioVideo !== undefined
            ? updateData.rates.defaultChargeType === "per-minute"
              ? updateData.rates.perMinute?.audioVideo || 0
              : updateData.rates.perHour?.audioVideo || 0
            : currentRates.video || 0,
        chargeType:
          updateData.rates.chargeType ||
          updateData.rates.defaultChargeType ||
          currentRates.chargeType ||
          "per-minute",
      };

      console.log(
        "🔍 BACKEND DEBUG: Complete rates to save:",
        JSON.stringify(completeRates, null, 2)
      );

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

    // Convert ObjectId to string for query since database stores user IDs as strings
    const userIdString = userId.toString();

    // Get upcoming consultations
    const upcomingConsultations = await Consultation.find({
      $or: [{ user: userIdString }, { provider: userId }], // user as string, provider as ObjectId
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
      $or: [{ user: userIdString }, { provider: userId }], // user as string, provider as ObjectId
      status: "completed",
    });

    // Get provider-specific consultation count (only where user was the provider)
    const providerConsultationCount = await Consultation.countDocuments({
      provider: userId, // provider is stored as ObjectId
      status: "completed",
    });

    // Get client-specific consultation count (only where user was the client)
    const clientConsultationCount = await Consultation.countDocuments({
      user: userIdString, // Use string format since database stores as strings
      status: "completed",
    });

    const pendingConsultations = await Consultation.countDocuments({
      $or: [{ user: userIdString }, { provider: userId }], // user as string, provider as ObjectId
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

    // User-specific stats - Always calculate for all users
    const userActivity = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5);

    const totalSpent = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          type: {
            $in: [
              "consultation",
              "consultation_payment",
              "subscription",
              "recharge",
            ],
          },
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // Get consultations where user was the client (spent money)
    const clientConsultations = await Consultation.find({
      user: userIdString, // Use string format since database stores as strings
      status: "completed",
    })
      .populate("provider", "fullName profilePhoto")
      .sort({ createdAt: -1 })
      .limit(5);

    const userStats = {
      userActivity,
      clientConsultations,
      totalSpent: totalSpent[0]?.total || req.user?.totalSpent || 0,
      subscriptionStatus: req.user?.subscriptionStatus || "Free",
      upcomingAppointments: pendingConsultations,
    };

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
    const notificationsCount = await Notification.countDocuments({
      user: userId, // Use ObjectId format since notifications store user as ObjectId
      isRead: false,
    });

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
          totalSpent: userStats.totalSpent,
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
      providerVerificationStatus: "verified", // Only show verified providers
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

// @desc    Get user documents
// @route   GET /api/users/documents
// @access  Private
const getUserDocuments = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      "profilePhoto aadharDocuments portfolioMedia aadharNumber isAadharVerified"
    );

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Helper function to ensure full URL
    const ensureFullUrl = (url) => {
      if (!url) return null;
      if (url.startsWith("http")) return url;
      const baseUrl = process.env.BASE_URL || "https://skillhub-a00h.onrender.com";
      return url.startsWith("/") ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
    };

    // Format documents for frontend
    const documents = [];
    const currentDate = new Date().toISOString();

    // Helper function to get file size
    const getFileSize = async (filePath) => {
      try {
        const fs = require("fs");
        const path = require("path");

        // Extract filename from URL - handle both full URLs and relative paths
        let fileName = filePath;

        // If it's a full URL, extract the path part
        if (filePath.includes("http://") || filePath.includes("https://")) {
          const url = new URL(filePath);
          fileName = url.pathname; // Gets /uploads/photo-123.png
        }

        // Remove leading slash if present
        if (fileName.startsWith("/")) {
          fileName = fileName.substring(1);
        }

        // Handle Windows backslashes
        fileName = fileName.replace(/\\/g, "/");

        // If the path already includes 'uploads/', use it as is
        // Otherwise, prepend 'uploads/'
        let fullPath;
        if (fileName.startsWith("uploads/")) {
          fullPath = fileName;
        } else {
          fullPath = path.join("uploads", fileName);
        }

        console.log(
          `🔍 File size check - Original: ${filePath}, Resolved: ${fullPath}`
        );

        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          const fileSizeInBytes = stats.size;

          // Convert to human readable format
          if (fileSizeInBytes < 1024) {
            return `${fileSizeInBytes} B`;
          } else if (fileSizeInBytes < 1024 * 1024) {
            return `${(fileSizeInBytes / 1024).toFixed(1)} KB`;
          } else {
            return `${(fileSizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
          }
        } else {
          console.log(`⚠️ File not found: ${fullPath}`);
        }
        return null;
      } catch (error) {
        console.error(`❌ Error getting file size:`, error.message);
        return null;
      }
    };

    // Profile Photo
    if (user.profilePhoto) {
      const fileSize = await getFileSize(user.profilePhoto);
      documents.push({
        id: "profile-photo",
        name: "Profile Photo",
        type: "profile",
        url: ensureFullUrl(user.profilePhoto),
        size: fileSize,
        date: user.updatedAt || user.createdAt || currentDate,
        status: "verified",
      });
    }

    // Aadhar Documents
    if (user.aadharDocuments?.front) {
      const fileSize = await getFileSize(user.aadharDocuments.front);
      documents.push({
        id: "aadhar-front",
        name: "Aadhar Card (Front)",
        type: "id",
        url: ensureFullUrl(user.aadharDocuments.front),
        size: fileSize,
        date: user.updatedAt || user.createdAt || currentDate,
        status: user.isAadharVerified ? "verified" : "pending",
        aadharNumber: user.aadharNumber,
      });
    }

    if (user.aadharDocuments?.back) {
      const fileSize = await getFileSize(user.aadharDocuments.back);
      documents.push({
        id: "aadhar-back",
        name: "Aadhar Card (Back)",
        type: "id",
        url: ensureFullUrl(user.aadharDocuments.back),
        size: fileSize,
        date: user.updatedAt || user.createdAt || currentDate,
        status: user.isAadharVerified ? "verified" : "pending",
        aadharNumber: user.aadharNumber,
      });
    }

    // Portfolio Media
    if (user.portfolioMedia && user.portfolioMedia.length > 0) {
      for (let index = 0; index < user.portfolioMedia.length; index++) {
        const media = user.portfolioMedia[index];
        const fileSize = await getFileSize(media.url);
        documents.push({
          id: `portfolio-${index}`,
          name: `Portfolio ${media.type === "image" ? "Image" : "Video"} ${
            index + 1
          }`,
          type: "portfolio",
          url: ensureFullUrl(media.url),
          size: fileSize,
          date: user.updatedAt || user.createdAt || currentDate,
          status: "verified",
          mediaType: media.type,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        documents,
        summary: {
          total: documents.length,
          verified: documents.filter((d) => d.status === "verified").length,
          pending: documents.filter((d) => d.status === "pending").length,
          rejected: documents.filter((d) => d.status === "rejected").length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update document (re-upload)
// @route   PUT /api/users/documents/:documentId
// @access  Private
const updateDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { documentType } = req.body;

    if (!req.file) {
      return next(new AppError("Please upload a file", 400));
    }

    const result = await uploadToCloudinary(
      req.file.path,
      `skillhub/${documentType}`
    );

    if (!result) {
      return next(new AppError("File upload failed", 500));
    }

    const user = await User.findById(req.user._id);

    // Update the appropriate document based on documentId
    if (documentId === "profile-photo") {
      user.profilePhoto = result.url;
    } else if (documentId === "aadhar-front") {
      if (!user.aadharDocuments) user.aadharDocuments = {};
      user.aadharDocuments.front = result.url;
      user.isAadharVerified = false; // Reset verification status
    } else if (documentId === "aadhar-back") {
      if (!user.aadharDocuments) user.aadharDocuments = {};
      user.aadharDocuments.back = result.url;
      user.isAadharVerified = false; // Reset verification status
    } else if (documentId.startsWith("portfolio-")) {
      const index = parseInt(documentId.split("-")[1]);
      if (user.portfolioMedia && user.portfolioMedia[index]) {
        user.portfolioMedia[index].url = result.url;
      }
    } else {
      return next(new AppError("Invalid document ID", 400));
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Document updated successfully",
      data: {
        documentId,
        url: result.url,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete document
// @route   DELETE /api/users/documents/:documentId
// @access  Private
const deleteDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const user = await User.findById(req.user._id);

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Delete the appropriate document based on documentId
    if (documentId === "profile-photo") {
      user.profilePhoto = null;
    } else if (documentId === "aadhar-front") {
      if (user.aadharDocuments) {
        user.aadharDocuments.front = null;
      }
    } else if (documentId === "aadhar-back") {
      if (user.aadharDocuments) {
        user.aadharDocuments.back = null;
      }
    } else if (documentId.startsWith("portfolio-")) {
      const index = parseInt(documentId.split("-")[1]);
      if (user.portfolioMedia && user.portfolioMedia[index]) {
        user.portfolioMedia.splice(index, 1);
      }
    } else {
      return next(new AppError("Invalid document ID", 400));
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
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

    if (!status || !["available", "offline"].includes(status)) {
      return next(
        new AppError('Invalid status. Must be "available" or "offline"', 400)
      );
    }

    // Check if provider is currently in an active consultation
    const activeConsultation = await Consultation.findOne({
      provider: req.user._id,
      status: { $in: ["ongoing", "pending"] },
    });

    // Debug logging
    console.log("🔍 STATUS DEBUG - Provider ID:", req.user._id);
    console.log(
      "🔍 STATUS DEBUG - Active consultation found:",
      activeConsultation
    );
    if (activeConsultation) {
      console.log("🔍 STATUS DEBUG - Consultation details:", {
        id: activeConsultation._id,
        status: activeConsultation.status,
        createdAt: activeConsultation.createdAt,
        startTime: activeConsultation.startTime,
        endTime: activeConsultation.endTime,
      });
    }

    // Prevent going offline during active consultations
    if (status === "offline" && activeConsultation) {
      // Check if the consultation is really active (has a recent startTime or is truly ongoing)
      const now = new Date();
      const consultationAge = now - new Date(activeConsultation.createdAt);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      // If consultation is older than 24 hours and still pending/ongoing, mark it as cancelled
      if (consultationAge > maxAge) {
        console.log(
          "🧹 CLEANUP: Found old stuck consultation, marking as cancelled:",
          activeConsultation._id
        );
        activeConsultation.status = "cancelled";
        activeConsultation.endTime = now;
        await activeConsultation.save();

        // Continue with status update since we cleaned up the stuck consultation
      } else {
        return next(
          new AppError("Cannot go offline during an active consultation", 400)
        );
      }
    }

    // Update the consultation status
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { consultationStatus: status },
      { new: true }
    ).select("consultationStatus fullName");

    // Emit status change to all connected clients via socket
    const io = req.app.get("io");
    if (io) {
      io.emit("providerStatusChanged", {
        providerId: req.user._id,
        status: status,
        providerName: user.fullName,
      });
    }

    res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      data: {
        consultationStatus: user.consultationStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider verification status
// @route   GET /api/users/verification-status
// @access  Private (Service Provider only)
const getVerificationStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select(
        "providerVerificationStatus verificationNotes verifiedAt verifiedBy isServiceProvider"
      )
      .populate("verifiedBy", "fullName email");

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    if (!user.isServiceProvider) {
      return next(new AppError("Not a service provider", 403));
    }

    res.status(200).json({
      success: true,
      data: {
        status: user.providerVerificationStatus,
        notes: user.verificationNotes,
        verifiedAt: user.verifiedAt,
        verifiedBy: user.verifiedBy,
        isVerified: user.providerVerificationStatus === "verified",
        canAccessFeatures: user.providerVerificationStatus === "verified",
      },
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
  uploadPortfolio,
  becomeProvider,
  updateProviderSettings,
  toggleProfileVisibility,
  getDashboard,
  updateBankDetails,
  searchProviders,
  getUserDocuments,
  updateDocument,
  deleteDocument,
  updateConsultationStatus,
  getVerificationStatus,
};
