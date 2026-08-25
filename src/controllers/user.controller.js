const { User, Consultation, Review, Transaction } = require("../models");
const Notification = require("../models/Notification.model");
const { AppError } = require("../middlewares/errorHandler");
const { createAdminNotification } = require("../utils/notifications");
const { uploadToCloudinary } = require("../utils/cloudinary");
const fs = require("fs");
const path = require("path");

// Absolute path to uploads directory — avoids process.cwd() returning /root
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o755 });
}

// @desc    Get user profile
// @route   GET /api/users/profile/:id
// @access  Public
const getUserProfile = async (req, res, next) => {
  try {
    // Validate ObjectId format before querying
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return next(new AppError("Invalid user ID", 400));
    }

    const user = await User.findById(req.params.id)
      .select("-wallet -earnings -bankDetails")
      .populate("serviceCategories");

    if (!user) {
      // Return a minimal response for deleted/non-existent users
      return res.status(200).json({
        success: true,
        data: {
          _id: req.params.id,
          fullName: 'Deleted User',
          isOnline: false,
          consultationStatus: 'offline',
          isDeleted: true,
        },
      });
    }

    // Don't show hidden profiles
    if (user.isProfileHidden) {
      return next(new AppError("Profile not available", 404));
    }

    // Don't show unverified provider profiles to others
    if (user.isServiceProvider && user.providerVerificationStatus !== 'verified') {
      return next(new AppError("This provider's profile is not yet available", 404));
    }

    // Increment profile views (don't count self-views)
    const viewerId = req.user?._id?.toString();
    if (user.isServiceProvider && viewerId !== req.params.id) {
      User.findByIdAndUpdate(req.params.id, { $inc: { profileViews: 1 } }).catch(() => {});
    }

    const userData = user.toObject();

    // Attach the intro video (stored as the provider's earliest Reel)
    try {
      const Reel = require("../models/Reel.model");
      const introReel = await Reel.findOne({ user: req.params.id, isActive: true })
        .sort({ createdAt: 1 })
        .select("videoUrl thumbnailUrl caption tags createdAt")
        .lean();
      if (introReel?.videoUrl) {
        userData.introReel = introReel;
      }
    } catch (reelErr) {
      console.error("Could not load intro reel (non-critical):", reelErr.message);
    }

    res.status(200).json({
      success: true,
      data: userData,
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
      "portfolioLinks",
    ];

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // Fetch old data BEFORE update for audit log
    const oldUser = await User.findById(req.user?._id).lean();

    const user = await User.findByIdAndUpdate(req.user?._id, updateData, {
      new: true,
      runValidators: true,
    });

    // Log profile changes (fire-and-forget)
    if (oldUser && Object.keys(updateData).length > 0) {
      const ProfileEditLog = require('../models/ProfileEditLog.model');
      const changes = [];
      for (const field of Object.keys(updateData)) {
        const oldVal = oldUser[field];
        const newVal = updateData[field];
        // Only log if value actually changed
        const oldStr = JSON.stringify(oldVal || '');
        const newStr = JSON.stringify(newVal || '');
        if (oldStr !== newStr) {
          changes.push({
            field,
            oldValue: oldVal || null,
            newValue: newVal || null,
          });
        }
      }
      if (changes.length > 0) {
        ProfileEditLog.create({
          user: user._id,
          userName: user.fullName,
          userMobile: user.mobile,
          changes,
          ip: req.ip || req.headers['x-forwarded-for'] || '',
          userAgent: req.headers['user-agent'] || '',
        }).catch(err => console.error('ProfileEditLog error:', err));
      }
    }

    // Notify admin about the profile update (fire-and-forget)
    createAdminNotification({
      title: 'Profile Updated',
      message: `${user.fullName || 'A user'} has updated their profile.`,
      type: 'profile_update',
      triggeredBy: user._id,
      affectedUser: user._id,
      data: {
        userId: user._id,
        updatedFields: Object.keys(updateData),
      },
      io: req.io,
    }).catch((err) => console.error('Admin notification error (updateProfile):', err));

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
    const files = req.files;

    if (!files || !files.front) {
      return next(new AppError("Please upload Aadhar card document", 400));
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

    // Log file details for debugging
    console.log('📤 Portfolio upload request:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
      path: req.file.path,
    });

    // Validate file size (100MB max)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (req.file.size > maxSize) {
      return next(new AppError(`File size exceeds 100MB limit. Your file: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`, 400));
    }

    // Validate video duration if it's a video (optional, needs ffprobe)
    const isVideo = req.file.mimetype.startsWith('video/');
    
    console.log(`🚀 Uploading ${isVideo ? 'video' : 'image'} to Cloudinary...`);

    const result = await uploadToCloudinary(
      req.file.path,
      "skillhub/portfolio"
    );

    if (!result || !result.url) {
      console.error('❌ Cloudinary returned no URL');
      return next(
        new AppError("Portfolio upload failed - no URL returned", 500)
      );
    }

    // Log successful upload
    console.log('✅ Portfolio uploaded:', {
      url: result.url,
      type: isVideo ? 'video' : 'image',
      fallback: result.fallback || false,
      duration: result.duration || 'N/A',
    });

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
      console.log('✅ Portfolio added to user profile');
    }

    res.status(200).json({
      success: true,
      message: `Portfolio ${isVideo ? 'video' : 'image'} uploaded successfully`,
      data: {
        url: result.url,
        type: isVideo ? "video" : "image",
        fallback: result.fallback || false,
        duration: result.duration || null,
      },
    });
  } catch (error) {
    console.error("❌ Portfolio upload error:", {
      message: error.message,
      stack: error.stack,
      file: req.file ? {
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      } : 'No file',
    });
    
    // Provide more specific error message
    if (error.message.includes('timeout')) {
      return next(new AppError("Upload timeout - file may be too large or network is slow. Please try a smaller video.", 408));
    }
    if (error.message.includes('File size')) {
      return next(error);
    }
    
    next(new AppError(`Upload failed: ${error.message}`, 500));
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
      "professionVideo",
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
        live:
          updateData.rates.live !== undefined
            ? updateData.rates.live
            : currentRates.live || 0,
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

    // Log provider settings changes (fire-and-forget)
    const ProfileEditLog = require('../models/ProfileEditLog.model');
    const provChanges = [];
    const oldData = currentUser.toObject();
    const fieldsToCheck = [...allowedFields, 'rates'];
    for (const field of fieldsToCheck) {
      const oldVal = oldData[field];
      const newVal = updatedUser[field];
      const oldStr = JSON.stringify(oldVal || '');
      const newStr = JSON.stringify(newVal || '');
      if (oldStr !== newStr) {
        provChanges.push({
          field,
          oldValue: oldVal || null,
          newValue: newVal || null,
        });
      }
    }
    if (provChanges.length > 0) {
      ProfileEditLog.create({
        user: updatedUser._id,
        userName: updatedUser.fullName,
        userMobile: updatedUser.mobile,
        changes: provChanges,
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        userAgent: req.headers['user-agent'] || '',
      }).catch(err => console.error('ProfileEditLog error:', err));
    }

    // Notify admin about the provider settings update (fire-and-forget)
    createAdminNotification({
      title: 'Provider Settings Updated',
      message: `${updatedUser.fullName || 'A provider'} has updated their provider settings.`,
      type: 'profile_update',
      triggeredBy: updatedUser._id,
      affectedUser: updatedUser._id,
      data: {
        userId: updatedUser._id,
        updatedFields: Object.keys(updateData),
      },
      io: req.io,
    }).catch((err) => console.error('Admin notification error (updateProviderSettings):', err));

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

      // Enrich with Guest names when populate returns null (Mixed type field)
      const Guest = require('../models/Guest.model');
      const guestIds = providerConsultations
        .filter(c => c.userType === 'Guest' && c.user && !c.user?.fullName)
        .map(c => c.user.toString());
      const uniqueGuestIds = [...new Set(guestIds)];
      const guests = uniqueGuestIds.length > 0
        ? await Guest.find({ _id: { $in: uniqueGuestIds } }).select('name mobile').lean()
        : [];
      const guestMap = {};
      guests.forEach(g => { guestMap[g._id.toString()] = g; });

      // Enrich with regular User names when populate fails (user stored as string)
      const regularUserIds = providerConsultations
        .filter(c => {
          // If user is already populated (has fullName), skip
          if (c.user && typeof c.user === 'object' && c.user.fullName) return false;
          // If it's a guest, skip (handled above)
          if (c.userType === 'Guest') return false;
          // User field exists but wasn't populated
          return !!c.user;
        })
        .map(c => typeof c.user === 'string' ? c.user : (c.user?._id || c.user).toString());
      const uniqueRegularUserIds = [...new Set(regularUserIds)];
      const regularUsers = uniqueRegularUserIds.length > 0
        ? await User.find({ _id: { $in: uniqueRegularUserIds } }).select('fullName profilePhoto').lean()
        : [];
      const regularUserMap = {};
      regularUsers.forEach(u => { regularUserMap[u._id.toString()] = u; });

      const enrichedProviderConsultations = providerConsultations.map(c => {
        const plain = c.toObject ? c.toObject() : c;
        // Check if user is already populated with fullName
        if (plain.user && typeof plain.user === 'object' && plain.user.fullName) {
          return plain; // Already has name, skip
        }
        // User needs enrichment
        const userIdStr = typeof plain.user === 'string' ? plain.user : (plain.user?._id || plain.user || '').toString();
        if (plain.userType === 'Guest') {
          const guest = guestMap[userIdStr];
          if (guest) {
            plain.user = { _id: guest._id, fullName: guest.name, profilePhoto: null, isGuest: true };
          } else {
            plain.user = { _id: userIdStr, fullName: 'Guest User', profilePhoto: null, isGuest: true };
          }
        } else if (userIdStr) {
          const regularUser = regularUserMap[userIdStr];
          if (regularUser) {
            plain.user = { _id: regularUser._id, fullName: regularUser.fullName, profilePhoto: regularUser.profilePhoto };
          }
        }
        return plain;
      });

      const pendingWithdrawals = await Transaction.aggregate([
        { $match: { user: userId, type: "withdrawal", status: "pending" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const profileViews = req.user?.profileViews || 0;

      providerStats = {
        providerConsultations: enrichedProviderConsultations,
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
    const clientConsultationsRaw = await Consultation.find({
      user: userIdString, // Use string format since database stores as strings
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(); // Use lean() for plain objects

    // Manually enrich provider names (populate can fail on Mixed fields)
    const clientProviderIds = clientConsultationsRaw
      .map(c => (c.provider || '').toString())
      .filter(id => id && id.length === 24);
    const uniqueClientProviderIds = [...new Set(clientProviderIds)];
    const clientProviderLookup = uniqueClientProviderIds.length > 0
      ? await User.find({ _id: { $in: uniqueClientProviderIds } }).select('fullName profilePhoto').lean()
      : [];
    const clientProviderMap = {};
    clientProviderLookup.forEach(p => { clientProviderMap[p._id.toString()] = p; });

    const clientConsultations = clientConsultationsRaw.map(c => {
      const provIdStr = (c.provider || '').toString();
      const prov = clientProviderMap[provIdStr];
      if (prov) {
        c.provider = { _id: prov._id, fullName: prov.fullName, profilePhoto: prov.profilePhoto };
      }
      return c;
    });

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

    if (!accountNumber || !accountHolderName || !bankName) {
      return next(new AppError("Account number, account holder name, and bank name are required", 400));
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
      minPrice,
      maxPrice,
      consultationType,
      recommended,
      sortBy,     // rating | fees_asc | fees_desc | name_asc | name_desc
      lat,        // user latitude for proximity sort/filter
      lng,        // user longitude for proximity sort/filter
      radius,     // max distance in km (default 50km when using location coords)
      sortByDistance,
      nearby,     // flag: true when user wants nearby providers
      page = 1,
      limit = 20,
    } = req.query;

    const query = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: "active",
      providerVerificationStatus: "verified", // Only show verified providers
      isDeleted: { $ne: true }, // Never show deleted/anonymized accounts
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
      // Search across all place sub-fields: village, town, city, state
      const locationRegex = new RegExp(city, "i");
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { "place.village": locationRegex },
          { "place.town":    locationRegex },
          { "place.city":    locationRegex },
          { "place.state":   locationRegex },
          { "place.country": locationRegex },
        ],
      });
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

    if (minPrice) {
      query['rates.perMinute.audioVideo'] = {
        ...(query['rates.perMinute.audioVideo'] || {}),
        $gte: parseFloat(minPrice),
      };
    }

    if (maxPrice) {
      query['rates.perMinute.audioVideo'] = {
        ...(query['rates.perMinute.audioVideo'] || {}),
        $lte: parseFloat(maxPrice),
      };
    }

    if (recommended === 'true' || recommended === true) {
      query.isRecommended = true;
    }

    // ── Build sort object from sortBy param ──────────────────────────────────
    const buildSortObj = () => {
      switch (sortBy) {
        case 'rating':     return { 'rating.average': -1, isOnline: -1 };
        case 'fees_asc':   return { 'rates.perMinute.audioVideo': 1,  'rating.average': -1 };
        case 'fees_desc':  return { 'rates.perMinute.audioVideo': -1, 'rating.average': -1 };
        case 'name_asc':   return { fullName: 1 };
        case 'name_desc':  return { fullName: -1 };
        default:           return { 'rating.average': -1, isOnline: -1 };
      }
    };

    let providers;

    // ── Determine if we should use distance-based filtering ──────────────────
    const useDistanceFilter = (sortByDistance === 'true' || nearby === 'true') && lat && lng;

    if (useDistanceFilter) {
      // ── Proximity filter + sort: fetch matching, filter by radius, sort by distance ──
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      // Default radius: 50km, max: 500km
      const maxRadiusKm = Math.min(parseFloat(radius) || 50, 500);
      const maxRadiusMeters = maxRadiusKm * 1000;

      const calcDistMeters = (p) => {
        const pLat = p.place?.coordinates?.lat;
        const pLng = p.place?.coordinates?.lng;
        if (!pLat || !pLng) return -1; // no coordinates stored
        const dLat = (pLat - userLat) * 111320;
        const dLng = (pLng - userLng) * 111320 * Math.cos((userLat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng);
      };

      // Save city filter info before removing it (for fallback)
      let savedCityFilter = city || null;

      // When using nearby/distance filter, skip the text-based city filter
      // because we're filtering by coordinates instead
      if (nearby === 'true' || sortByDistance === 'true') {
        // Remove city-based text filter if it was added (we use radius instead)
        if (query.$and) {
          query.$and = query.$and.filter(condition => {
            // Remove the $or condition that matches place fields (city filter)
            if (condition.$or) {
              const isPlaceFilter = condition.$or.some(c =>
                Object.keys(c).some(k => k.startsWith('place.'))
              );
              return !isPlaceFilter;
            }
            return true;
          });
          if (query.$and.length === 0) delete query.$and;
        }
      }

      const allMatching = await User.find(query)
        .select('-wallet -earnings -bankDetails -password')
        .populate('serviceCategories')
        .limit(1000); // cap to avoid memory issues

      // Separate providers WITH coordinates (can calculate distance) from those WITHOUT
      const withCoords = [];
      const withoutCoords = [];
      for (const p of allMatching) {
        const dist = calcDistMeters(p);
        if (dist >= 0) {
          withCoords.push({ provider: p, distance: dist });
        } else {
          withoutCoords.push(p);
        }
      }

      // Filter providers with coordinates by radius
      const withinRadius = withCoords.filter(({ distance }) => distance <= maxRadiusMeters);

      // Sort by distance, then by rating for providers within ~1km of each other
      withinRadius.sort((a, b) => {
        if (Math.abs(a.distance - b.distance) < 1000) {
          return (b.provider.rating?.average || 0) - (a.provider.rating?.average || 0);
        }
        return a.distance - b.distance;
      });

      // ── Fallback for providers WITHOUT coordinates: text-based city/state match ──
      // Only include them if their place text matches the searched location
      let fallbackProviders = [];
      if (withoutCoords.length > 0) {
        // Use city param from frontend (e.g., "Sampangi Rama Nagar, Bengaluru, Karnataka")
        // Split by comma and try each part individually for broader matching
        const locationText = savedCityFilter || '';
        if (locationText) {
          const locationParts = locationText.split(',').map(s => s.trim()).filter(Boolean);
          fallbackProviders = withoutCoords.filter(p => {
            const place = p.place || {};
            const placeValues = [
              place.village || '',
              place.town || '',
              place.city || '',
              place.state || '',
              place.country || '',
            ].map(v => v.toLowerCase());

            // Match if ANY part of the user's location text matches any place field
            return locationParts.some(part => {
              const partLower = part.toLowerCase();
              return placeValues.some(val => val && (val.includes(partLower) || partLower.includes(val)));
            });
          });
        }
        // NO "show all" fallback — strict location matching only

        // Sort fallback providers by rating
        fallbackProviders.sort((a, b) =>
          (b.rating?.average || 0) - (a.rating?.average || 0)
        );
      }

      // Combine: distance-sorted providers first, then fallback providers
      const combinedProviders = [
        ...withinRadius.map(({ provider }) => provider),
        ...fallbackProviders,
      ];

      // Paginate after filtering and sorting
      const startIdx = (parseInt(page) - 1) * parseInt(limit);
      providers = combinedProviders.slice(startIdx, startIdx + parseInt(limit));

      // Use combined count for pagination
      const filteredTotal = combinedProviders.length;
      return res.status(200).json({
        success: true,
        data: providers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredTotal,
          pages: Math.ceil(filteredTotal / parseInt(limit)),
        },
      });
    } else {
      // ── Sort by the requested sort option (no distance filtering) ──
      providers = await User.find(query)
        .select('-wallet -earnings -bankDetails -password')
        .populate('serviceCategories')
        .sort(buildSortObj())
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit));
    }

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
      "profilePhoto aadharDocuments portfolioMedia portfolioLinks aadharNumber isAadharVerified"
    );

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Helper function to ensure full URL
    const ensureFullUrl = (url) => {
      if (!url) return null;
      if (url.startsWith("http")) return url;
      const baseUrl = process.env.BASE_URL || "https://quickchatindia.com";
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
          fullPath = path.join(__dirname, "../../", fileName);
        } else {
          fullPath = path.join(__dirname, "../../uploads", fileName);
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
        portfolioLinks: user.portfolioLinks || [],
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

// ── Deactivate account (user-initiated) ──────────────────────────────────────
const deactivateAccount = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: 'inactive',
          // NOTE: isProfileHidden is NOT set here — admin controls visibility separately.
          // status: 'inactive' already removes the user from search results.
          isOnline: false,
          consultationStatus: 'offline',
          fcmTokens: [], // Clear push tokens so no notifications
          deactivatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!user) return next(new AppError('User not found', 404));

    // Notify via socket if connected
    if (req.io) {
      req.io.to(`user:${userId}`).emit('account:deactivated');
    }

    // Notify admin panel
    const { createAdminNotification } = require('../utils/notifications');
    await createAdminNotification({
      title: 'User Deactivated Account',
      message: `${user.fullName} has deactivated their account.`,
      type: 'account_deactivated',
      triggeredBy: userId,
      affectedUser: userId,
      io: req.io,
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Account deactivated successfully. Log in again to reactivate.',
    });
  } catch (error) {
    next(error);
  }
};

// ── Reactivate account (user-initiated) ──────────────────────────────────────
const reactivateAccount = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: 'active',
          // NOTE: isProfileHidden is intentionally NOT reset here.
          // The user may have hidden their profile before deactivating — preserve that choice.
          deactivatedAt: null,
          reactivatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!user) return next(new AppError('User not found', 404));

    res.status(200).json({
      success: true,
      message: 'Account reactivated successfully.',
      data: { status: user.status },
    });
  } catch (error) {
    next(error);
  }
};

// ── Request account deletion ──────────────────────────────────────────────────
const requestAccountDeletion = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { reason } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: 'inactive',
          // NOTE: isProfileHidden is NOT set here — admin controls visibility separately.
          isOnline: false,
          consultationStatus: 'offline',
          fcmTokens: [],
          deletionRequested: true,
          deletionRequestedAt: new Date(),
          deletionReason: reason || '',
        },
      },
      { new: true }
    );

    if (!user) return next(new AppError('User not found', 404));

    // Notify admin via socket
    if (req.io) {
      req.io.emit('admin:deletion_request', {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        reason: reason || '',
        requestedAt: new Date(),
      });
    }

    // Create admin notification
    const { createAdminNotification } = require('../utils/notifications');
    await createAdminNotification({
      title: 'Account Deletion Request',
      message: `${user.fullName} has requested account deletion.${reason ? ` Reason: ${reason}` : ''}`,
      type: 'deletion_request',
      triggeredBy: userId,
      affectedUser: userId,
      io: req.io,
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Deletion request submitted. Admin will review within 48 hours.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all distinct location values from verified providers
// @route   GET /api/users/locations
// @access  Public
const getLocations = async (req, res, next) => {
  try {
    // Aggregate all non-empty place sub-fields from verified, active providers
    const results = await User.aggregate([
      {
        $match: {
          isServiceProvider: true,
          isProfileHidden: false,
          status: "active",
          providerVerificationStatus: "verified",
        },
      },
      {
        $project: {
          places: {
            $filter: {
              input: [
                "$place.village",
                "$place.town",
                "$place.city",
                "$place.state",
              ],
              as: "p",
              cond: { $and: [{ $ne: ["$$p", null] }, { $ne: ["$$p", ""] }] },
            },
          },
        },
      },
      { $unwind: "$places" },
      { $group: { _id: { $toLower: "$places" }, display: { $first: "$places" } } },
      { $sort: { display: 1 } },
    ]);

    const locations = results.map((r) => r.display).filter(Boolean);

    res.status(200).json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all distinct filter options (professions, skills, languages) from ALL verified providers
// @route   GET /api/users/filter-options
// @access  Public
const getFilterOptions = async (req, res, next) => {
  try {
    const baseMatch = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: 'active',
      providerVerificationStatus: 'verified',
    };

    const [professions, skills, languages] = await Promise.all([
      // Distinct professions
      User.aggregate([
        { $match: { ...baseMatch, profession: { $exists: true, $ne: '', $ne: null } } },
        { $group: { _id: { $toLower: { $trim: { input: '$profession' } } }, display: { $first: { $trim: { input: '$profession' } } } } },
        { $sort: { display: 1 } },
      ]),
      // Distinct skills
      User.aggregate([
        { $match: baseMatch },
        { $unwind: '$skills' },
        { $match: { skills: { $exists: true, $ne: '', $ne: null } } },
        { $group: { _id: { $toLower: { $trim: { input: '$skills' } } }, display: { $first: { $trim: { input: '$skills' } } } } },
        { $sort: { display: 1 } },
      ]),
      // Distinct languages
      User.aggregate([
        { $match: baseMatch },
        { $unwind: '$languagesKnown' },
        { $match: { languagesKnown: { $exists: true, $ne: '', $ne: null } } },
        { $group: { _id: { $toLower: { $trim: { input: '$languagesKnown' } } }, display: { $first: { $trim: { input: '$languagesKnown' } } } } },
        { $sort: { display: 1 } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        profession: professions.map(p => p.display).filter(Boolean),
        skill:      skills.map(s => s.display).filter(Boolean),
        language:   languages.map(l => l.display).filter(Boolean),
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
  getLocations,
  getFilterOptions,
  getUserDocuments,
  updateDocument,
  deleteDocument,
  updateConsultationStatus,
  getVerificationStatus,
  deactivateAccount,
  reactivateAccount,
  requestAccountDeletion,
};
