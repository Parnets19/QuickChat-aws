const { Consultation, User, Transaction, Notification, Rating } = require("../models");
const { AppError } = require("../middlewares/errorHandler");

// Helper function to populate consultation with user data (handles guest users)
const populateConsultationUser = async (consultation) => {
  if (!consultation) return consultation;
  
  // Handle array of consultations
  if (Array.isArray(consultation)) {
    return Promise.all(consultation.map(populateConsultationUser));
  }
  
  // Convert to plain object if it's a mongoose document
  const consultationObj = consultation.toObject ? consultation.toObject() : consultation;
  
  // Handle user field
  if (consultationObj.user) {
    if (typeof consultationObj.user === 'string' && consultationObj.user.startsWith('guest_')) {
      // Guest user - create a mock user object
      consultationObj.user = {
        _id: consultationObj.user,
        fullName: 'Guest User',
        profilePhoto: null,
        isGuest: true
      };
    } else if (typeof consultationObj.user === 'string' || consultationObj.user._id) {
      // Regular user - populate from database
      try {
        const userId = typeof consultationObj.user === 'string' ? consultationObj.user : consultationObj.user._id;
        const user = await User.findById(userId).select('fullName profilePhoto');
        if (user) {
          consultationObj.user = user;
        }
      } catch (error) {
        console.error('Error populating user:', error);
      }
    }
  }
  
  // Handle provider field (always ObjectId)
  if (consultationObj.provider && (typeof consultationObj.provider === 'string' || consultationObj.provider._id)) {
    try {
      const providerId = typeof consultationObj.provider === 'string' ? consultationObj.provider : consultationObj.provider._id;
      const provider = await User.findById(providerId).select('fullName profilePhoto rates');
      if (provider) {
        consultationObj.provider = provider;
      }
    } catch (error) {
      console.error('Error populating provider:', error);
    }
  }
  
  return consultationObj;
};

// @desc    Create consultation booking
// @route   POST /api/consultations
// @access  Private
const createConsultation = async (req, res, next) => {
  console.log("🚨 CREATE CONSULTATION CALLED");
  console.log("Request body:", req.body);
  console.log("User:", req.user?.isGuest ? "Guest User" : req.user?.fullName);
  try {
    const { providerId, type, paymentCompleted } = req.body;

    if (!providerId || !type) {
      return next(
        new AppError("Provider ID and consultation type are required", 400)
      );
    }

    const provider = await User.findById(providerId);

    if (!provider || !provider.isServiceProvider) {
      return next(new AppError("Provider not found", 404));
    }

    // Check if consultation mode is enabled
    if (!provider.consultationModes?.[type]) {
      return next(
        new AppError(
          `${type} consultation is not available for this provider`,
          400
        )
      );
    }

    // Check if provider is busy (in another call)
    if (provider.isInCall && (type === "audio" || type === "video")) {
      return next(
        new AppError("Provider is currently busy in another call", 400)
      );
    }

    // Get rate based on provider's unified rate structure
    let rate = 0;

    if (provider.rates) {
      const defaultChargeType =
        provider.rates.defaultChargeType || "per-minute";

      if (type === "chat") {
        rate = provider.rates.chat || 0;
      } else if (type === "audio" || type === "video") {
        // Use unified audioVideo rate for both audio and video
        if (
          defaultChargeType === "per-minute" &&
          provider.rates.perMinute
        ) {
          rate = provider.rates.perMinute.audioVideo || 
                 provider.rates.perMinute[type] || 
                 provider.rates[type] || 0;
        } else if (defaultChargeType === "per-hour" && provider.rates.perHour) {
          rate = provider.rates.perHour.audioVideo || 
                 provider.rates.perHour[type] || 0;
        } else {
          // Fallback to legacy rate structure
          rate = provider.rates[type] || 0;
        }
      }
    }

    // Get user info (handle both regular users and guests)
    let user;
    if (req.user?.isGuest) {
      // For guest users, use the user object from auth middleware
      user = req.user;
    } else {
      // For regular users, fetch from database
      user = await User.findById(req.user?._id);
      if (!user) {
        return next(new AppError("User not found", 404));
      }
    }

    // Determine initial status based on payment
    let initialStatus = "pending";
    let notificationTitle = "New Consultation Request";
    let notificationMessage = `New ${type} consultation request from ${user.fullName}`;
    let responseMessage = "Consultation request sent successfully";

    // If payment is completed (for audio/video), keep status as pending until provider accepts
    // The provider still needs to accept/start the consultation even after payment
    if (paymentCompleted && (type === "audio" || type === "video")) {
      // Keep as pending - provider still needs to accept
      initialStatus = "pending";
      notificationTitle = "New Paid Consultation Request";
      notificationMessage = `${user.fullName} has paid for a ${type} consultation. Accept to start the session.`;
      responseMessage =
        "Payment completed. Consultation request sent to provider.";
    }

    // Detect provider-to-provider consultation
    const isProviderToProvider = !req.user?.isGuest && 
                                 req.user?.isServiceProvider && 
                                 provider.isServiceProvider;
    
    console.log("🔍 CONSULTATION DEBUG - Provider-to-provider detection:", {
      isGuest: req.user?.isGuest,
      userIsProvider: req.user?.isServiceProvider,
      targetIsProvider: provider.isServiceProvider,
      isProviderToProvider
    });

    // Create consultation (handle guest users and provider-to-provider)
    const consultationData = {
      user: req.user?.isGuest ? req.user.id : req.user?._id,
      provider: providerId,
      type,
      rate,
      status: initialStatus,
      startTime: null, // Start time will be set when provider accepts/starts the consultation
    };

    // Add provider-to-provider specific fields
    if (isProviderToProvider) {
      consultationData.isProviderToProvider = true;
      consultationData.bookingProviderIsClient = true;
      consultationData.participantRoles = {
        bookingProvider: 'client',
        bookedProvider: 'provider'
      };
      
      console.log("✅ CONSULTATION DEBUG - Provider-to-provider consultation detected");
    }

    const consultation = await Consultation.create(consultationData);

    // Store consultation-specific roles for provider-to-provider consultations
    if (isProviderToProvider) {
      // Update booking provider (user) - they are the client in this consultation
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          consultationRoles: {
            consultationId: consultation._id,
            role: 'client'
          },
          providerToProviderConsultations: consultation._id
        }
      });

      // Update booked provider - they are the provider in this consultation
      await User.findByIdAndUpdate(providerId, {
        $push: {
          consultationRoles: {
            consultationId: consultation._id,
            role: 'provider'
          },
          providerToProviderConsultations: consultation._id
        }
      });

      console.log("✅ CONSULTATION DEBUG - Consultation roles stored for both providers");
    }

    // Create notification for provider
    await Notification.create({
      user: providerId,
      title: notificationTitle,
      message: notificationMessage,
      type: "consultation",
      data: { consultationId: consultation._id },
    });

    res.status(201).json({
      success: true,
      message: responseMessage,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get consultation by ID
// @route   GET /api/consultations/:id
// @access  Private
const getConsultation = async (req, res, next) => {
  console.log("🚨 CONSULTATION CONTROLLER CALLED - getConsultation");
  try {
    console.log("🔍 DEBUG - getConsultation called with:", {
      consultationId: req.params.id,
      userId: req.user?._id,
      userIdString: req.user?._id?.toString(),
      userRole: req.user?.isServiceProvider ? "provider" : "client",
      isGuest: req.user?.isGuest,
      userFullName: req.user?.fullName,
    });

    // First, let's check if this is a valid MongoDB ObjectId
    const mongoose = require("mongoose");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("❌ DEBUG - Invalid ObjectId format:", req.params.id);
      return next(new AppError("Invalid consultation ID format", 400));
    }

    // Debug: Find all consultations for this user (handle guest users)
    const userId = req.user?.isGuest ? req.user.id : req.user._id;
    
    // Build query that handles both ObjectId and string user IDs
    let userQuery;
    if (req.user?.isGuest) {
      // For guest users, only check user field as string (guests can't be providers)
      userQuery = { user: userId };
    } else {
      // For regular users, check both user and provider fields
      userQuery = {
        $or: [{ user: userId }, { provider: req.user._id }],
      };
    }
    
    const userConsultations = await Consultation.find(userQuery)
      .select("_id user provider status type");

    console.log(
      "🔍 DEBUG - User's consultations:",
      userConsultations.map((c) => ({
        id: c._id.toString(),
        user: c.user?.fullName,
        provider: c.provider?.fullName,
        status: c.status,
        type: c.type,
      }))
    );

    const consultation = await Consultation.findById(req.params.id);
    const populatedConsultation = await populateConsultationUser(consultation);

    if (!consultation) {
      console.log("❌ DEBUG - Consultation not found:", req.params.id);
      return next(new AppError("Consultation not found", 404));
    }

    console.log("🔍 DEBUG - Consultation found:", {
      consultationUser: consultation.user?._id?.toString(),
      consultationProvider: consultation.provider?._id?.toString(),
      requestingUser: req.user?._id?.toString(),
      status: consultation.status,
    });

    // Check if user is part of consultation (handle guest users)
    const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user?._id?.toString();
    const requestingUserId = req.user?.isGuest ? req.user.id : req.user?._id?.toString();
    
    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultation.provider?._id?.toString() === req.user?._id?.toString();

    console.log("🔍 DEBUG - Authorization check:", {
      isUser,
      isProvider,
      authorized: isUser || isProvider,
      consultationUserType: typeof consultation.user?._id,
      consultationProviderType: typeof consultation.provider?._id,
      requestUserType: typeof req.user?._id,
    });

    // TEMPORARY: Allow service providers to access any consultation for testing
    const isServiceProvider = req.user?.isServiceProvider;
    const allowForTesting =
      isServiceProvider && process.env.NODE_ENV === "development";

    if (!isUser && !isProvider && !allowForTesting) {
      console.log("❌ DEBUG - Authorization failed");
      return next(new AppError("Not authorized", 403));
    }

    if (allowForTesting && !isUser && !isProvider) {
      console.log(
        "⚠️ DEBUG - Access granted for testing (service provider in development mode)"
      );
    }

    console.log("✅ DEBUG - Authorization successful");
    res.status(200).json({
      success: true,
      data: populatedConsultation,
    });
  } catch (error) {
    console.error("❌ DEBUG - getConsultation error:", error);
    next(error);
  }
};

// @desc    Get user's consultations
// @route   GET /api/consultations
// @access  Private
const getMyConsultations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, role } = req.query;

    let query;
    const userId = req.user?.isGuest ? req.user.id : req.user?._id;

    // Filter by role if specified
    if (role === "provider") {
      // Only regular users can be providers
      if (req.user?.isGuest) {
        query = { _id: { $exists: false } }; // Guest users can't be providers, return empty result
      } else {
        query = { provider: req.user?._id };
      }
    } else if (role === "client") {
      query = { user: userId };
    } else {
      // Default: return all consultations where user is either client or provider
      if (req.user?.isGuest) {
        // Guest users can only be clients, never providers
        query = { user: userId };
      } else {
        // Regular users can be both clients and providers
        query = {
          $or: [{ user: userId }, { provider: req.user?._id }],
        };
      }
    }

    if (status) {
      query.status = status;
    }

    const consultations = await Consultation.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    // Populate consultations with user data (handles guest users)
    const populatedConsultations = await populateConsultationUser(consultations);

    const total = await Consultation.countDocuments(query);

    // Debug logging
    console.log(
      `Consultation query for user ${req.user?._id} with role ${role}:`,
      query
    );
    console.log(`Found ${consultations.length} consultations`);
    consultations.forEach((consultation) => {
      console.log(
        `Consultation ${consultation._id}: user=${consultation.user?._id}, provider=${consultation.provider?._id}`
      );
    });

    res.status(200).json({
      success: true,
      data: populatedConsultations,
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

// @desc    Get consultation history
// @route   GET /api/consultations/history
// @access  Private
const getConsultationHistory = async (req, res, next) => {
  try {
    const consultations = await Consultation.find({
      $or: [{ user: req.user?._id }, { provider: req.user?._id }],
      status: "completed",
    })
      .populate("user", "fullName profilePhoto")
      .populate("provider", "fullName profilePhoto")
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      data: consultations,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Start consultation
// @route   PUT /api/consultations/:id/start
// @access  Private
const startConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Only provider can start consultation
    if (consultation.provider.toString() !== req.user?._id?.toString()) {
      return next(new AppError("Not authorized", 403));
    }

    consultation.status = "ongoing";
    consultation.startTime = new Date();
    await consultation.save();

    res.status(200).json({
      success: true,
      message: "Consultation started",
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    End consultation
// @route   PUT /api/consultations/:id/end
// @access  Private
const endConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Either party can end consultation (handle guest users)
    const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
    const requestingUserId = req.user?.isGuest ? req.user.id : req.user?._id.toString();
    const consultationProviderId = consultation.provider.toString();
    
    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === req.user?._id?.toString();
    
    if (!isUser && !isProvider) {
      return next(new AppError("Not authorized", 403));
    }

    // Only allow ending consultations that are ongoing
    if (consultation.status !== "ongoing") {
      return next(new AppError("Can only end ongoing consultations", 400));
    }

    consultation.status = "completed";
    consultation.endTime = new Date();

    // Calculate duration and amount
    if (consultation.startTime) {
      const duration = Math.ceil(
        (consultation.endTime.getTime() - consultation.startTime.getTime()) /
          (1000 * 60)
      );
      consultation.duration = duration;
      consultation.totalAmount = duration * consultation.rate;

      // Transfer money to provider (skip for guest users as they don't have wallets)
      const provider = await User.findById(consultation.provider);
      
      // Only handle wallet transactions for regular users, not guests
      if (!req.user?.isGuest && typeof consultation.user !== 'string') {
        const user = await User.findById(consultation.user);
        
        if (user && provider) {
          user.wallet -= consultation.totalAmount;
          provider.earnings += consultation.totalAmount;

          await user.save();
          await provider.save();

          // Create transaction
          await Transaction.create({
            user: consultation.user,
            type: "debit",
            category: "consultation",
            amount: consultation.totalAmount,
            balanceBefore: user.wallet + consultation.totalAmount,
            balanceAfter: user.wallet,
            status: "completed",
            description: `${consultation.type} consultation with ${provider.fullName}`,
          });
        }
      } else if (provider) {
        // For guest users, just update provider earnings (payment was handled separately)
        provider.earnings += consultation.totalAmount;
        await provider.save();
      }
    }

    await consultation.save();

    res.status(200).json({
      success: true,
      message: "Consultation ended",
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel consultation
// @route   PUT /api/consultations/:id/cancel
// @access  Private
const cancelConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Both user and provider can cancel pending consultations (handle guest users)
    const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
    const requestingUserId = req.user?.isGuest ? req.user.id : req.user?._id.toString();
    const consultationProviderId = consultation.provider.toString();
    
    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === req.user?._id?.toString();

    if (!isUser && !isProvider) {
      return next(new AppError("Not authorized", 403));
    }

    if (consultation.status !== "pending") {
      return next(
        new AppError("Cannot cancel ongoing or completed consultations", 400)
      );
    }

    consultation.status = "cancelled";
    await consultation.save();

    // Different message based on who cancelled
    const message = isUser
      ? "Consultation cancelled"
      : "Consultation request rejected";

    res.status(200).json({
      success: true,
      message,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit rating for consultation
// @route   POST /api/consultations/:id/rating
// @access  Private
const submitRating = async (req, res, next) => {
  try {
    const { stars, review, tags, isAnonymous } = req.body;
    const consultationId = req.params.id;

    if (!stars || stars < 1 || stars > 5) {
      return next(new AppError("Rating must be between 1 and 5 stars", 400));
    }

    const consultation = await Consultation.findById(consultationId);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Check if user is part of consultation (handle guest users)
    const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
    const requestingUserId = req.user?.isGuest ? req.user.id : req.user?._id.toString();
    
    if (consultationUserId !== requestingUserId) {
      return next(new AppError("Only the client can rate the consultation", 403));
    }

    // Check if consultation is completed
    if (consultation.status !== "completed") {
      return next(new AppError("Can only rate completed consultations", 400));
    }

    // Check if already rated
    const existingRating = await Rating.findOne({ consultation: consultationId });
    if (existingRating) {
      return next(new AppError("Consultation already rated", 400));
    }

    // Create rating
    const rating = await Rating.create({
      consultation: consultationId,
      provider: consultation.provider,
      user: req.user?.isGuest ? req.user.id : req.user?._id,
      userName: isAnonymous ? "Anonymous" : req.user?.fullName,
      stars,
      review,
      tags: tags || [],
      isAnonymous: isAnonymous || false,
    });

    // Update provider's rating
    const provider = await User.findById(consultation.provider);
    if (provider) {
      provider.rating.totalStars += stars;
      provider.rating.count += 1;
      provider.rating.average = provider.rating.totalStars / provider.rating.count;
      
      // Add to reviews array (keep last 50 reviews)
      provider.rating.reviews.unshift({
        consultationId,
        userId: req.user?.isGuest ? req.user.id : req.user?._id,
        userName: isAnonymous ? "Anonymous" : req.user?.fullName,
        stars,
        review,
        tags: tags || [],
      });
      
      // Keep only last 50 reviews
      if (provider.rating.reviews.length > 50) {
        provider.rating.reviews = provider.rating.reviews.slice(0, 50);
      }
      
      await provider.save();
    }

    // Update consultation with rating
    consultation.rating = {
      stars,
      review,
      tags: tags || [],
      submittedAt: new Date(),
    };
    await consultation.save();

    res.status(201).json({
      success: true,
      message: "Rating submitted successfully",
      data: rating,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider ratings
// @route   GET /api/consultations/provider/:providerId/ratings
// @access  Public
const getProviderRatings = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const providerId = req.params.providerId;

    const ratings = await Rating.find({ provider: providerId })
      .populate('consultation', 'type createdAt')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Rating.countDocuments({ provider: providerId });
    
    // Get provider rating summary
    const provider = await User.findById(providerId).select('rating');

    res.status(200).json({
      success: true,
      data: {
        ratings,
        summary: provider?.rating || { average: 0, count: 0 },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createConsultation,
  getConsultation,
  getMyConsultations,
  startConsultation,
  endConsultation,
  cancelConsultation,
  getConsultationHistory,
  submitRating,
  getProviderRatings,
};
