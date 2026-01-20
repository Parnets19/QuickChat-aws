const {
  Consultation,
  User,
  Guest,
  Transaction,
  Notification,
  Rating,
} = require("../models");
const { addEarnings } = require("./earnings.controller");
const { AppError } = require("../middlewares/errorHandler");

/**
 * Precise money calculation helper to avoid floating point issues
 * @param {number} amount1 - First amount
 * @param {number} amount2 - Second amount
 * @param {string} operation - 'add', 'subtract', 'multiply', 'divide'
 * @returns {number} - Precise result rounded to 2 decimal places
 */
const preciseMoneyCalculation = (amount1, amount2, operation) => {
  // Convert to cents to avoid floating point issues
  const cents1 = Math.round(amount1 * 100);
  const cents2 = Math.round(amount2 * 100);

  let resultCents;
  switch (operation) {
    case "add":
      resultCents = cents1 + cents2;
      break;
    case "subtract":
      resultCents = cents1 - cents2;
      break;
    case "multiply":
      resultCents = Math.round((cents1 * cents2) / 100);
      break;
    case "divide":
      resultCents = Math.round((cents1 / cents2) * 100);
      break;
    default:
      throw new Error("Invalid operation");
  }

  // Convert back to rupees with exactly 2 decimal places
  return Math.round(resultCents) / 100;
};

// Platform commission rate (5%)
const PLATFORM_COMMISSION_RATE = 0.05;

// Helper function to update provider consultation status
const updateProviderStatus = async (providerId, status) => {
  try {
    await User.findByIdAndUpdate(providerId, {
      consultationStatus: status,
    });
    console.log(`📱 Provider ${providerId} status updated to: ${status}`);
  } catch (error) {
    console.error("Error updating provider status:", error);
  }
};

// Helper function to check if provider has any ongoing consultations
const checkProviderBusyStatus = async (providerId) => {
  try {
    const ongoingConsultations = await Consultation.countDocuments({
      provider: providerId,
      status: "ongoing",
    });

    const newStatus = ongoingConsultations > 0 ? "busy" : "available";
    await updateProviderStatus(providerId, newStatus);

    console.log(
      `📱 Provider ${providerId} has ${ongoingConsultations} ongoing consultations, status: ${newStatus}`
    );
    return newStatus;
  } catch (error) {
    console.error("Error checking provider busy status:", error);
    return "available";
  }
};

// Helper function to populate consultation with user data (handles guest users)
const populateConsultationUser = async (consultation) => {
  if (!consultation) return consultation;

  // Handle array of consultations
  if (Array.isArray(consultation)) {
    return Promise.all(consultation.map(populateConsultationUser));
  }

  // Convert to plain object if it's a mongoose document
  const consultationObj = consultation.toObject
    ? consultation.toObject()
    : consultation;

  // Handle user field
  if (consultationObj.user) {
    const userId =
      typeof consultationObj.user === "string"
        ? consultationObj.user
        : consultationObj.user._id;

    try {
      // First try to find as regular user
      let user = await User.findById(userId).select("fullName profilePhoto");

      if (!user) {
        // If not found as regular user, try as guest user
        const guest = await Guest.findById(userId).select("name");
        if (guest) {
          user = {
            _id: guest._id,
            fullName: guest.name,
            profilePhoto: null,
            isGuest: true,
          };
        }
      }

      if (user) {
        consultationObj.user = user;
      } else {
        // Fallback if user not found in either collection
        consultationObj.user = {
          _id: userId,
          fullName: "Unknown User",
          profilePhoto: null,
          isGuest: false,
        };
      }
    } catch (error) {
      console.error("Error populating user:", error);
      consultationObj.user = {
        _id: userId,
        fullName: "Unknown User",
        profilePhoto: null,
        isGuest: false,
      };
    }
  }

  // Handle provider field (always ObjectId)
  if (
    consultationObj.provider &&
    (typeof consultationObj.provider === "string" ||
      consultationObj.provider._id)
  ) {
    try {
      const providerId =
        typeof consultationObj.provider === "string"
          ? consultationObj.provider
          : consultationObj.provider._id;
      const provider = await User.findById(providerId).select(
        "fullName profilePhoto rates"
      );
      if (provider) {
        consultationObj.provider = provider;
      }
    } catch (error) {
      console.error("Error populating provider:", error);
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
        if (defaultChargeType === "per-minute" && provider.rates.perMinute) {
          rate =
            provider.rates.perMinute.audioVideo ||
            provider.rates.perMinute[type] ||
            provider.rates[type] ||
            0;
        } else if (defaultChargeType === "per-hour" && provider.rates.perHour) {
          rate =
            provider.rates.perHour.audioVideo ||
            provider.rates.perHour[type] ||
            0;
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
    const isProviderToProvider =
      !req.user?.isGuest &&
      req.user?.isServiceProvider &&
      provider.isServiceProvider;

    console.log("🔍 CONSULTATION DEBUG - Provider-to-provider detection:", {
      isGuest: req.user?.isGuest,
      userIsProvider: req.user?.isServiceProvider,
      targetIsProvider: provider.isServiceProvider,
      isProviderToProvider,
    });

    // Check if this is user's first-time free trial (one-time across all providers)
    let isFirstTimeFreeTrial = false;
    if (rate > 0 && (type === "audio" || type === "video")) {
      try {
        // Check if user has used their one-time free trial
        let hasUsedFreeTrial = false;

        if (req.user?.isGuest) {
          const guest = await Guest.findById(req.user.id);
          hasUsedFreeTrial = guest?.hasUsedFreeTrialCall || false;
        } else {
          const userForFreeCheck = await User.findById(req.user._id);
          hasUsedFreeTrial = userForFreeCheck?.hasUsedFreeTrialCall || false;
        }

        isFirstTimeFreeTrial = !hasUsedFreeTrial;
        console.log(
          `🎯 Free trial check: isFirstTime=${isFirstTimeFreeTrial}, hasUsed=${hasUsedFreeTrial}`
        );
      } catch (error) {
        console.error("Error checking free trial status:", error);
        isFirstTimeFreeTrial = false;
      }
    }

    // 🛡️ WALLET BALANCE VALIDATION - Updated for free trial system
    // For free trial calls, no wallet balance required!
    // For non-free-trial calls, normal wallet validation applies
    if (rate > 0 && !isFirstTimeFreeTrial) {
      let currentUser;
      if (req.user?.isGuest) {
        currentUser = await Guest.findById(req.user.id);
      } else {
        currentUser = await User.findById(req.user._id);
      }

      if (currentUser) {
        const currentBalance = currentUser.wallet || 0;
        const minimumRequired = rate; // At least one minute worth

        console.log("🛡️ WALLET BALANCE CHECK (NON-FREE-TRIAL):", {
          userId: currentUser._id,
          currentBalance,
          ratePerMinute: rate,
          minimumRequired,
          canAfford: currentBalance >= minimumRequired,
          isFirstTimeFreeTrial,
        });

        if (currentBalance < minimumRequired) {
          console.log(
            "🚨 INSUFFICIENT WALLET BALANCE - CONSULTATION REJECTED:",
            {
              userId: currentUser._id,
              currentBalance,
              requiredAmount: minimumRequired,
              shortfall: minimumRequired - currentBalance,
            }
          );

          return next(
            new AppError(
              `Insufficient wallet balance. You need at least ₹${minimumRequired} to start this consultation. Current balance: ₹${currentBalance}`,
              400
            )
          );
        }
      } else {
        return next(new AppError("User not found", 404));
      }
    } else if (isFirstTimeFreeTrial) {
      console.log("🎉 FREE TRIAL CALL - No wallet balance required!");
    }

    // Create consultation (handle guest users and provider-to-provider)
    const consultationData = {
      user: req.user?.isGuest ? req.user.id : req.user?._id,
      provider: providerId,
      type,
      rate,
      status: initialStatus,
      startTime: null, // Start time will be set when provider accepts/starts the consultation
      // NEW: Free trial system fields
      isFirstTimeFreeTrial, // Is this the user's one-time free trial?
      freeTrialUsed: false, // Has the free trial been consumed?
      entireCallFree: isFirstTimeFreeTrial, // Is entire call free?
      // OLD: Keep for backward compatibility
      isFirstMinuteFree: false, // Deprecated: always false now
      freeMinuteUsed: false, // Deprecated: always false now
    };

    // Add provider-to-provider specific fields
    if (isProviderToProvider) {
      consultationData.isProviderToProvider = true;
      consultationData.bookingProviderIsClient = true;
      consultationData.participantRoles = {
        bookingProvider: "client",
        bookedProvider: "provider",
      };

      console.log(
        "✅ CONSULTATION DEBUG - Provider-to-provider consultation detected"
      );
    }

    const consultation = await Consultation.create(consultationData);

    // 🎯 MARK FREE TRIAL AS USED IMMEDIATELY - New free trial system
    // Mark free trial as used when consultation is created (not when completed)
    // This prevents users from getting multiple free trials
    if (isFirstTimeFreeTrial && rate > 0) {
      try {
        console.log("🎯 MARKING FREE TRIAL AS USED ON CREATION:", {
          consultationId: consultation._id,
          userId: req.user?.isGuest ? req.user.id : req.user?._id,
          providerId: providerId,
          isFirstTimeFreeTrial: isFirstTimeFreeTrial,
        });

        // Determine if user is guest or regular user
        const isGuestUser = req.user?.isGuest;
        const userId = isGuestUser ? req.user.id : req.user?._id;

        if (isGuestUser) {
          await Guest.findByIdAndUpdate(userId, {
            hasUsedFreeTrialCall: true,
            freeTrialUsedAt: new Date(),
            freeTrialConsultationId: consultation._id,
          });
        } else {
          await User.findByIdAndUpdate(userId, {
            hasUsedFreeTrialCall: true,
            freeTrialUsedAt: new Date(),
            freeTrialConsultationId: consultation._id,
          });
        }

        console.log("✅ FREE TRIAL MARKED AS USED FOR USER:", userId);
      } catch (error) {
        console.error("❌ Error marking free trial as used:", error);
        // Don't fail the consultation creation if this fails
      }
    }

    // Add auto-timeout for free calls (rate = 0) and audio/video calls
    if (rate === 0 && (type === "audio" || type === "video")) {
      console.log(
        `⏰ Setting up auto-timeout for free ${type} call:`,
        consultation._id
      );

      // Set timeout for 60 seconds (1 minute)
      setTimeout(async () => {
        try {
          // Check if consultation is still pending (not accepted)
          const currentConsultation = await Consultation.findById(
            consultation._id
          );

          if (currentConsultation && currentConsultation.status === "pending") {
            console.log(
              `⏰ Auto-cancelling free call ${consultation._id} - provider didn't answer`
            );

            // Update consultation status to rejected
            currentConsultation.status = "rejected";
            currentConsultation.endTime = new Date();
            currentConsultation.endReason = "timeout_no_answer";
            currentConsultation.duration = 0;
            currentConsultation.totalAmount = 0;
            await currentConsultation.save();

            // Send timeout notification via socket
            const io = req.app.get("io"); // Get socket.io instance
            if (io) {
              // Send timeout to both caller and provider
              io.to(`user:${currentConsultation.user}`).emit(
                "consultation:call-timeout",
                {
                  consultationId: consultation._id,
                  message: "Provider did not answer the call",
                  status: "rejected",
                  reason: "timeout_no_answer",
                  timestamp: new Date().toISOString(),
                }
              );

              io.to(`user:${providerId}`).emit("consultation:call-timeout", {
                consultationId: consultation._id,
                message: "Call timed out",
                status: "rejected",
                reason: "timeout_no_answer",
                timestamp: new Date().toISOString(),
              });

              // Also broadcast to consultation rooms
              io.to(`consultation:${consultation._id}`).emit(
                "consultation:call-timeout",
                {
                  consultationId: consultation._id,
                  message: "Call timed out - no answer",
                  status: "rejected",
                  reason: "timeout_no_answer",
                  timestamp: new Date().toISOString(),
                }
              );

              console.log(
                `📡 Timeout notifications sent for consultation ${consultation._id}`
              );
            }

            console.log(
              `✅ Free call ${consultation._id} auto-cancelled due to timeout`
            );
          } else {
            console.log(
              `⏰ Free call ${consultation._id} was already answered or ended`
            );
          }
        } catch (timeoutError) {
          console.error(
            `❌ Error in auto-timeout for consultation ${consultation._id}:`,
            timeoutError
          );
        }
      }, 60000); // 60 seconds = 1 minute
    }

    // Store consultation-specific roles for provider-to-provider consultations
    if (isProviderToProvider) {
      // Update booking provider (user) - they are the client in this consultation
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          consultationRoles: {
            consultationId: consultation._id,
            role: "client",
          },
          providerToProviderConsultations: consultation._id,
        },
      });

      // Update booked provider - they are the provider in this consultation
      await User.findByIdAndUpdate(providerId, {
        $push: {
          consultationRoles: {
            consultationId: consultation._id,
            role: "provider",
          },
          providerToProviderConsultations: consultation._id,
        },
      });

      console.log(
        "✅ CONSULTATION DEBUG - Consultation roles stored for both providers"
      );
    }

    // Create notification for provider
    await Notification.create({
      user: providerId,
      title: notificationTitle,
      message: notificationMessage,
      type: "consultation",
      data: { consultationId: consultation._id },
    });

    // NOTE: Ring notifications are now handled by real-time billing controller only
    // This prevents duplicate notifications to providers
    // Real-time billing system sends the notification when consultation starts

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

    const userConsultations = await Consultation.find(userQuery).select(
      "_id user provider status type"
    );

    console.log(
      "🔍 DEBUG - User's consultations:",
      userConsultations.map((c) => ({
        id: c._id.toString(),
        user: c.user?.toString() || c.user,
        provider: c.provider?.toString() || c.provider,
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
    const consultationUserId =
      typeof consultation.user === "string"
        ? consultation.user
        : consultation.user?._id?.toString();
    const requestingUserId = req.user?.isGuest
      ? req.user.id
      : req.user?._id?.toString();

    const isUser = consultationUserId === requestingUserId;
    const isProvider =
      consultation.provider?._id?.toString() === req.user?._id?.toString();

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
    const userIdString = req.user?.isGuest
      ? req.user.id
      : req.user?._id?.toString();

    // Filter by role if specified
    if (role === "provider") {
      // Only regular users can be providers
      if (req.user?.isGuest) {
        query = { _id: { $exists: false } }; // Guest users can't be providers, return empty result
      } else {
        query = { provider: req.user?._id };
      }
    } else if (role === "client") {
      // Handle both string and ObjectId formats for user field
      query = {
        $or: [{ user: userId }, { user: userIdString }],
      };
    } else {
      // Default: return all consultations where user is either client or provider
      if (req.user?.isGuest) {
        // Guest users can only be clients, never providers
        query = {
          $or: [{ user: userId }, { user: userIdString }],
        };
      } else {
        // Regular users can be both clients and providers
        // Handle both string and ObjectId formats for user field
        query = {
          $or: [
            { user: userId },
            { user: userIdString },
            { provider: req.user?._id },
          ],
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
    const populatedConsultations = await populateConsultationUser(
      consultations
    );

    const total = await Consultation.countDocuments(query);

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

    // Update provider status to busy
    await updateProviderStatus(consultation.provider, "busy");

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
    console.log("🛑 END CONSULTATION API CALLED:", {
      consultationId: req.params.id,
      userId: req.user?.id || req.user?._id,
      userRole: req.user?.isServiceProvider ? "provider" : "client",
      timestamp: new Date().toISOString(),
    });

    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      console.log("❌ CONSULTATION NOT FOUND:", req.params.id);
      return next(new AppError("Consultation not found", 404));
    }

    console.log("📋 CONSULTATION FOUND:", {
      id: consultation._id,
      status: consultation.status,
      user: consultation.user,
      provider: consultation.provider,
      totalAmount: consultation.totalAmount,
      duration: consultation.duration,
    });

    // Either party can end consultation (handle guest users)
    const consultationUserId =
      typeof consultation.user === "string"
        ? consultation.user
        : consultation.user.toString();
    const requestingUserId = req.user?.isGuest
      ? req.user.id
      : req.user?._id.toString();
    const consultationProviderId = consultation.provider.toString();

    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === req.user?._id?.toString();

    if (!isUser && !isProvider) {
      return next(new AppError("Not authorized", 403));
    }

    // FIX FOR API 400 ERROR: Allow ending consultations in multiple states
    // Only prevent ending if consultation is already completed or cancelled
    if (["completed", "cancelled"].includes(consultation.status)) {
      console.log(
        `⚠️ Consultation already ${consultation.status}, not updating status`
      );

      // Still return success to prevent client-side errors
      return res.status(200).json({
        success: true,
        message: `Consultation already ${consultation.status}`,
        data: consultation,
      });
    }

    // Allow ending consultations in pending, ongoing, or other states
    console.log(`✅ Ending consultation with status: ${consultation.status}`);

    consultation.status = "completed";
    consultation.endTime = new Date();

    // Calculate duration and amount - FIXED TO MATCH BILLING CONTROLLER
    if (consultation.startTime) {
      // Use bothSidesAcceptedAt if available (for real-time billing), otherwise use startTime
      const billingStartTime = consultation.bothSidesAcceptedAt || consultation.startTime;
      
      // Calculate EXACT duration in seconds first
      const durationInSeconds = Math.floor(
        (consultation.endTime - billingStartTime) / 1000
      );
      
      // Round UP to nearest minute (2min 30sec = 3 minutes charged)
      const billableMinutes = Math.ceil(durationInSeconds / 60);
      
      console.log("💰 OLD CONTROLLER - DURATION CALCULATION:", {
        billingStartTime,
        endTime: consultation.endTime,
        durationInSeconds,
        billableMinutes,
        rate: consultation.rate,
      });
      
      consultation.duration = billableMinutes; // Store as whole minutes, not decimal
      
      // Use precise calculation for totalAmount
      consultation.totalAmount = preciseMoneyCalculation(
        billableMinutes,
        consultation.rate,
        "multiply"
      );

      // Add earnings to provider
      const provider = await User.findById(consultation.provider);

      if (provider && consultation.totalAmount > 0) {
        // Determine client name for transaction description
        let clientName = "Guest User";
        if (typeof consultation.user !== "string") {
          const user = await User.findById(consultation.user);
          if (user) {
            clientName = user.fullName;
          }
        }

        // Calculate platform commission and provider earnings with PRECISE calculations
        const platformCommission = preciseMoneyCalculation(
          consultation.totalAmount,
          PLATFORM_COMMISSION_RATE,
          "multiply"
        );
        const providerEarnings = preciseMoneyCalculation(
          consultation.totalAmount,
          platformCommission,
          "subtract"
        );

        console.log("💰 COMMISSION CALCULATION:", {
          totalAmount: consultation.totalAmount,
          platformCommission,
          providerEarnings,
          commissionRate: PLATFORM_COMMISSION_RATE,
        });

        // Add earnings to provider (only the provider's share, not full amount)
        await addEarnings(
          consultation.provider,
          consultation._id,
          providerEarnings, // Use provider earnings, not full amount
          `${
            consultation.type.charAt(0).toUpperCase() +
            consultation.type.slice(1)
          } Consultation - ${clientName}`,
          {
            clientName,
            consultationType: consultation.type,
            duration: consultation.duration,
            rate: consultation.rate,
            platformCommission,
            grossAmount: consultation.totalAmount,
            netAmount: providerEarnings,
          }
        );

        // For regular users (not guests), deduct from user wallet
        // NOTE: WALLET DEDUCTION IS HANDLED BY REAL-TIME BILLING SYSTEM
        // Do NOT deduct here to avoid double charging
        const consultationUserId = consultation.user.toString();
        const user = await User.findById(consultationUserId);

        console.log(
          "💸 WALLET DEDUCTION SKIPPED (HANDLED BY REAL-TIME BILLING):",
          {
            consultationUserId,
            userFound: !!user,
            userWallet: user?.wallet,
            consultationAmount: consultation.totalAmount,
            note: "Real-time billing already handled wallet deduction during call",
          }
        );

        // Only create transaction record for tracking (no wallet deduction)
        if (user && consultation.totalAmount > 0) {
          await Transaction.create({
            user: consultationUserId,
            userType: "User",
            type: "consultation_payment",
            category: "consultation",
            amount: consultation.totalAmount,
            balance: user.wallet, // Current balance (already deducted by real-time billing)
            status: "completed",
            description: `${consultation.type} consultation with ${provider.fullName}`,
            consultationId: consultation._id,
            transactionId: `CONSULT_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          });

          console.log("✅ TRANSACTION RECORD CREATED (NO WALLET DEDUCTION)");
        }
      }
    } else {
      // If no start time, set minimal duration for completed consultation
      consultation.duration = 0;
      consultation.totalAmount = 0;
    }

    await consultation.save();

    // 🆓 MARK FREE MINUTE AS USED - Fix for free minute system
    // If this was a first-time consultation with this provider, mark free minute as used
    if (consultation.isFirstMinuteFree && consultation.rate > 0) {
      try {
        console.log("🆓 MARKING FREE MINUTE AS USED:", {
          consultationId: consultation._id,
          userId: consultationUserId,
          providerId: consultation.provider,
          isFirstMinuteFree: consultation.isFirstMinuteFree,
        });

        // Determine if user is guest or regular user
        const isGuestUser = req.user?.isGuest;
        let userModel;

        if (isGuestUser) {
          userModel = await Guest.findById(consultationUserId);
        } else {
          userModel = await User.findById(consultationUserId);
        }

        if (userModel) {
          // Initialize freeMinutesUsed if it doesn't exist
          if (!userModel.freeMinutesUsed) {
            userModel.freeMinutesUsed = [];
          }

          // Check if not already marked as used
          const alreadyMarked = userModel.freeMinutesUsed.some(
            (entry) =>
              entry.providerId.toString() === consultation.provider.toString()
          );

          if (!alreadyMarked) {
            userModel.freeMinutesUsed.push({
              providerId: consultation.provider,
              consultationId: consultation._id,
              usedAt: new Date(),
            });
            await userModel.save();

            // Also update the consultation to reflect that free minute was used
            consultation.freeMinuteUsed = true;
            await consultation.save();

            console.log("✅ FREE MINUTE MARKED AS USED:", {
              userId: consultationUserId,
              providerId: consultation.provider,
              userType: isGuestUser ? "guest" : "regular",
            });
          } else {
            console.log(
              "ℹ️ Free minute already marked as used for this provider"
            );
          }
        } else {
          console.error(
            "❌ User not found for free minute marking:",
            consultationUserId
          );
        }
      } catch (freeMinuteError) {
        console.error("❌ Error marking free minute as used:", freeMinuteError);
        // Don't fail the consultation completion if free minute marking fails
      }
    }

    // Check if provider has any other ongoing consultations and update status accordingly
    await checkProviderBusyStatus(consultation.provider);

    console.log("✅ END CONSULTATION API COMPLETED SUCCESSFULLY:", {
      consultationId: consultation._id,
      finalStatus: consultation.status,
      totalAmount: consultation.totalAmount,
      duration: consultation.duration,
    });

    res.status(200).json({
      success: true,
      message: "Consultation ended",
      data: consultation,
    });
  } catch (error) {
    console.error("❌ END CONSULTATION API ERROR:", {
      consultationId: req.params?.id,
      error: error.message,
      stack: error.stack,
    });
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
    const consultationUserId =
      typeof consultation.user === "string"
        ? consultation.user
        : consultation.user.toString();
    const requestingUserId = req.user?.isGuest
      ? req.user.id
      : req.user?._id.toString();
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

// @desc    Reject consultation (provider declines call)
// @route   PUT /api/consultations/:id/reject
// @access  Private
const rejectConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Only provider can reject consultations
    const consultationProviderId = consultation.provider.toString();
    const requestingUserId = req.user?._id?.toString();

    if (consultationProviderId !== requestingUserId) {
      return next(
        new AppError("Only the provider can reject this consultation", 403)
      );
    }

    // Can only reject pending consultations
    if (consultation.status !== "pending") {
      return next(new AppError("Can only reject pending consultations", 400));
    }

    // Update consultation status to rejected
    consultation.status = "rejected";
    consultation.endTime = new Date();
    consultation.endReason = "provider_rejected";
    await consultation.save();

    // Emit socket event to notify client
    const io = req.app.get("io");
    if (io) {
      // Notify the client that call was rejected
      io.to(`user:${consultation.user}`).emit("consultation:call-rejected", {
        consultationId: consultation._id,
        reason: "Provider declined the call",
        rejectedByName: req.user.fullName || req.user.name,
        status: "rejected",
        timestamp: new Date().toISOString(),
      });

      // Also emit to consultation room
      io.to(`consultation:${consultation._id}`).emit(
        "consultation:call-rejected",
        {
          consultationId: consultation._id,
          reason: "Provider declined the call",
          rejectedByName: req.user.fullName || req.user.name,
          status: "rejected",
          timestamp: new Date().toISOString(),
        }
      );

      console.log("📡 SOCKET: Call rejection emitted to client");
    }

    res.status(200).json({
      success: true,
      message: "Consultation rejected successfully",
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

    console.log('⭐ Rating submission received:', {
      consultationId,
      stars,
      hasReview: !!review,
      tagsCount: tags?.length || 0,
      isAnonymous,
      userId: req.user?._id || req.user?.id,
      isGuest: req.user?.isGuest,
    });

    if (!stars || stars < 1 || stars > 5) {
      console.log('❌ Invalid stars value:', stars);
      return next(new AppError("Rating must be between 1 and 5 stars", 400));
    }

    const consultation = await Consultation.findById(consultationId);

    if (!consultation) {
      console.log('❌ Consultation not found:', consultationId);
      return next(new AppError("Consultation not found", 404));
    }

    console.log('✅ Consultation found:', {
      id: consultation._id,
      status: consultation.status,
      provider: consultation.provider,
      user: consultation.user,
    });

    // Check if user is part of consultation (handle guest users and providers)
    const consultationUserId =
      typeof consultation.user === "string"
        ? consultation.user
        : consultation.user.toString();
    const requestingUserId = req.user?.isGuest
      ? req.user.id
      : req.user?._id.toString();
    const consultationProviderId = consultation.provider.toString();

    const isClient = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === req.user?._id?.toString();

    console.log('🔍 User authorization check:', {
      consultationUserId,
      requestingUserId,
      consultationProviderId,
      isClient,
      isProvider,
    });

    if (!isClient && !isProvider) {
      console.log('❌ User not authorized to rate this consultation');
      return next(
        new AppError("Only participants can rate the consultation", 403)
      );
    }

    // REMOVED: Status check - allow rating regardless of consultation status
    // REMOVED: Duplicate rating check - allow multiple ratings

    // Determine who is being rated
    const ratedUserId = isProvider ? consultation.user : consultation.provider;
    const ratedUserType = isProvider ? "client" : "provider";

    console.log('✅ Creating rating:', {
      ratedUserId,
      ratedUserType,
      isProvider,
      isClient,
    });

    // Create rating
    const rating = await Rating.create({
      consultation: consultationId,
      provider: consultation.provider,
      user: req.user?.isGuest ? req.user.id : req.user?._id,
      ratedUser: ratedUserId,
      ratedUserType,
      userName: isAnonymous ? "Anonymous" : req.user?.fullName,
      stars,
      review,
      tags: tags || [],
      isAnonymous: isAnonymous || false,
    });

    console.log('✅ Rating created successfully:', rating._id);

    // Update the rated user's rating (for both providers and clients)
    const ratedUser = await User.findById(ratedUserId);
    if (ratedUser) {
      console.log('📊 Updating rating for:', {
        userId: ratedUser._id,
        userType: ratedUserType,
        currentCount: ratedUser.rating?.count || 0,
        currentAverage: ratedUser.rating?.average || 0,
      });

      // Initialize rating object if it doesn't exist
      if (!ratedUser.rating) {
        ratedUser.rating = {
          average: 0,
          count: 0,
          totalStars: 0,
          reviews: [],
        };
      }

      // Update rating statistics
      ratedUser.rating.totalStars = (ratedUser.rating.totalStars || 0) + stars;
      ratedUser.rating.count = (ratedUser.rating.count || 0) + 1;
      ratedUser.rating.average =
        ratedUser.rating.totalStars / ratedUser.rating.count;

      // Add to reviews array (keep last 50 reviews)
      if (!ratedUser.rating.reviews) {
        ratedUser.rating.reviews = [];
      }

      ratedUser.rating.reviews.unshift({
        consultationId,
        userId: req.user?.isGuest ? req.user.id : req.user?._id,
        userName: isAnonymous ? "Anonymous" : req.user?.fullName,
        stars,
        review,
        tags: tags || [],
      });

      // Keep only last 50 reviews
      if (ratedUser.rating.reviews.length > 50) {
        ratedUser.rating.reviews = ratedUser.rating.reviews.slice(0, 50);
      }

      await ratedUser.save();
      console.log('✅ User rating updated:', {
        userId: ratedUser._id,
        userType: ratedUserType,
        newAverage: ratedUser.rating.average,
        newCount: ratedUser.rating.count,
        totalStars: ratedUser.rating.totalStars,
      });
    } else {
      console.log('⚠️ Rated user not found:', ratedUserId);
    }

    // Update consultation with rating
    consultation.rating = {
      stars,
      review,
      tags: tags || [],
      submittedAt: new Date(),
    };
    await consultation.save();

    console.log('✅ Rating submission complete');

    res.status(201).json({
      success: true,
      message: "Rating submitted successfully",
      data: rating,
    });
  } catch (error) {
    console.error('❌ Error submitting rating:', error);
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
      .populate("consultation", "type createdAt")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Rating.countDocuments({ provider: providerId });

    // Get provider rating summary
    const provider = await User.findById(providerId).select("rating");

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

// @desc    Get guest consultation history
// @route   GET /api/consultations/guest-history
// @access  Private (Guest)
const getGuestConsultationHistory = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 20, status } = req.query;

    console.log("📋 Fetching guest consultation history:", {
      userId,
      page,
      limit,
      status,
    });

    // Build query for guest consultations
    const query = {
      user: userId,
      userType: "Guest",
    };

    // Add status filter if provided
    if (status && status !== "all") {
      query.status = status;
    }

    // Get consultations with pagination
    const consultations = await Consultation.find(query)
      .populate("provider", "fullName profilePhoto rates")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Consultation.countDocuments(query);

    // Format consultations with additional details
    const formattedConsultations = consultations.map((consultation) => {
      const consultationObj = consultation.toObject();

      // Calculate duration in a readable format
      let durationText = "N/A";
      if (consultationObj.duration && consultationObj.duration > 0) {
        const minutes = consultationObj.duration;
        if (minutes < 60) {
          durationText = `${minutes} min${minutes !== 1 ? "s" : ""}`;
        } else {
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          durationText = `${hours}h ${remainingMinutes}m`;
        }
      }

      // Format time range
      let timeRange = "N/A";
      if (consultationObj.startTime && consultationObj.endTime) {
        const startTime = new Date(consultationObj.startTime);
        const endTime = new Date(consultationObj.endTime);
        timeRange = `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`;
      }

      // Get consultation type icon
      const getTypeIcon = (type) => {
        switch (type) {
          case "video":
            return "video";
          case "audio":
            return "phone";
          case "chat":
            return "message-circle";
          default:
            return "help-circle";
        }
      };

      return {
        ...consultationObj,
        durationText,
        timeRange,
        typeIcon: getTypeIcon(consultationObj.type),
        providerName: consultationObj.provider?.fullName || "Unknown Provider",
        providerPhoto: consultationObj.provider?.profilePhoto,
        rate: consultationObj.rate || 0,
        formattedDate: new Date(consultationObj.createdAt).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "short",
            day: "numeric",
          }
        ),
        formattedTime: new Date(consultationObj.createdAt).toLocaleTimeString(
          "en-US",
          {
            hour: "2-digit",
            minute: "2-digit",
          }
        ),
      };
    });

    console.log(
      `✅ Found ${formattedConsultations.length} guest consultations`
    );

    res.status(200).json({
      success: true,
      data: {
        consultations: formattedConsultations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
          hasPrev: parseInt(page) > 1,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching guest consultation history:", error);
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
  rejectConsultation,
  getConsultationHistory,
  getGuestConsultationHistory,
  submitRating,
  getProviderRatings,
};
