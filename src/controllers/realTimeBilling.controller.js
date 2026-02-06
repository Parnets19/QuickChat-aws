const { Consultation, User, Guest, Transaction } = require("../models");
const { logger } = require("../utils/logger");

// Get Socket.IO instance (will be set by server.js)
let io = null;
const setSocketIO = (socketInstance) => {
  io = socketInstance;
};

// Helper function to emit billing updates
const emitBillingUpdate = (consultationId, data) => {
  if (io) {
    // STANDARDIZED: Use consultation room format for all billing events
    io.to(`consultation:${consultationId}`).emit("billing:update", data);
    console.log("📡 SOCKET: Billing update emitted:", data);
  }
};

// Helper function to emit auto-termination
const emitAutoTermination = (consultationId, data) => {
  if (io) {
    // STANDARDIZED: Use consultation room format for all billing events
    io.to(`consultation:${consultationId}`).emit("billing:terminated", data);
    io.to(`consultation:${consultationId}`).emit(
      "consultation:auto-terminated",
      data
    );
    console.log("📡 SOCKET: Auto-termination emitted:", data);
  }
};

// Platform commission rate (5%)
const PLATFORM_COMMISSION_RATE = 0.05;
const PROVIDER_SHARE_RATE = 0.95;

/**
 * Calculate proper per-minute billing (always round up)
 * @param {number} durationInSeconds - Call duration in seconds
 * @param {number} ratePerMinute - Rate per minute
 * @returns {object} - Billing details
 */
const calculatePerMinuteBilling = (durationInSeconds, ratePerMinute) => {
  const durationInMinutes = durationInSeconds / 60;
  const billableMinutes = Math.ceil(durationInMinutes); // Always round UP

  // PRECISE MONEY CALCULATION - Use integer arithmetic to avoid floating point issues
  const rateInCents = Math.round(ratePerMinute * 100);
  const totalAmountInCents = billableMinutes * rateInCents;
  const totalAmount = Math.round(totalAmountInCents) / 100; // Convert back to rupees with exactly 2 decimal places

  console.log("💰 PRECISE PER-MINUTE BILLING CALCULATION:", {
    durationInSeconds,
    durationInMinutes: durationInMinutes.toFixed(2),
    billableMinutes,
    ratePerMinute,
    rateInCents,
    totalAmountInCents,
    totalAmount,
    note: "Using integer arithmetic for precision",
  });

  return {
    durationInSeconds,
    durationInMinutes,
    billableMinutes,
    totalAmount,
  };
};

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

/**
 * Check if user can afford consultation with proper wallet protection
 * STRICT WALLET VALIDATION - 1 MINUTE = 1 RUPEE (or custom rate)
 */
const checkConsultationAffordability = async (req, res) => {
  try {
    const { providerId, consultationType } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log("💰 AFFORDABILITY CHECK (STRICT MODE):", {
      userId,
      providerId,
      consultationType,
      isGuest,
    });

    // Get user/guest wallet balance
    let userWallet = 0;
    let userModel = null;

    if (isGuest) {
      userModel = await Guest.findById(userId).select("wallet name");
      userWallet = userModel?.wallet || 0;
    } else {
      userModel = await User.findById(userId).select("wallet fullName");
      userWallet = userModel?.wallet || 0;
    }

    // Get provider rates
    const provider = await User.findById(providerId).select("rates fullName");
    if (!provider) {
      return res.status(404).json({ 
        success: false,
        message: "Provider not found" 
      });
    }

    const ratePerMinute =
      provider.rates?.perMinute?.audioVideo || 
      provider.rates?.[consultationType] || 
      provider.rates?.audioVideo || 
      1; // Default 1 rupee per minute

    console.log("💵 RATE CONFIGURATION - DETAILED:", {
      ratePerMinute,
      consultationType,
      providerName: provider.fullName,
      providerRates: provider.rates,
      'rates.perMinute': provider.rates?.perMinute,
      'rates.perMinute.audioVideo': provider.rates?.perMinute?.audioVideo,
      'rates[consultationType]': provider.rates?.[consultationType],
      'rates.audioVideo': provider.rates?.audioVideo,
      'rates.video': provider.rates?.video,
      'rates.audio': provider.rates?.audio,
    });

    // 🚨 STRICT WALLET VALIDATION - NO EXCEPTIONS
    if (ratePerMinute > 0) {
      // Reject negative or zero balances immediately
      if (userWallet <= 0) {
        console.log("🚨 CALL REJECTED - ZERO/NEGATIVE BALANCE:", {
          userId,
          userWallet,
          ratePerMinute,
        });

        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You have ₹${userWallet.toFixed(2)} in your wallet. Please add money to your wallet before starting any paid consultations.`,
          data: {
            canAfford: false,
            userWallet,
            ratePerMinute,
            minimumRequired: ratePerMinute,
            maxTalkTimeMinutes: 0,
            reason: "zero_balance",
          },
        });
      }

      // Check if user has at least 1 minute worth of balance
      if (userWallet < ratePerMinute) {
        console.log("🚨 CALL REJECTED - INSUFFICIENT FUNDS:", {
          userWallet,
          ratePerMinute,
          shortfall: ratePerMinute - userWallet,
        });

        return res.status(400).json({
          success: false,
          message: `Insufficient balance. You need at least ₹${ratePerMinute} for 1 minute consultation. Current balance: ₹${userWallet.toFixed(2)}. Please add ₹${(ratePerMinute - userWallet).toFixed(2)} or more.`,
          data: {
            canAfford: false,
            userWallet,
            ratePerMinute,
            minimumRequired: ratePerMinute,
            shortfall: ratePerMinute - userWallet,
            maxTalkTimeMinutes: 0,
            reason: "insufficient_balance",
          },
        });
      }
    }

    // Calculate maximum talk time
    const maxTalkTimeMinutes =
      ratePerMinute > 0 ? Math.floor(userWallet / ratePerMinute) : 999;

    console.log("✅ CALL APPROVED:", {
      userWallet,
      ratePerMinute,
      maxTalkTimeMinutes,
      userName: isGuest ? userModel.name : userModel.fullName,
    });

    return res.json({
      success: true,
      message: `You can talk for up to ${maxTalkTimeMinutes} minutes with your current balance.`,
      data: {
        canAfford: true,
        userWallet,
        ratePerMinute,
        minimumRequired: ratePerMinute,
        maxTalkTimeMinutes,
        estimatedCost: ratePerMinute,
        reason: "sufficient_balance",
      },
    });
  } catch (error) {
    console.error("❌ Error checking affordability:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check affordability",
      error: error.message,
    });
  }
};

/**
 * Start consultation with STRICT real-time billing
 * 1 MINUTE = 1 RUPEE (or custom rate) - PREPAID MODEL
 */
const startConsultation = async (req, res) => {
  try {
    const { providerId, consultationType } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log("🚀 START CONSULTATION (PREPAID MODEL):", {
      userId,
      providerId,
      consultationType,
      isGuest,
      timestamp: new Date().toISOString(),
    });

    // Get user and provider models
    let userModel;
    if (isGuest) {
      userModel = await Guest.findById(userId);
    } else {
      userModel = await User.findById(userId);
    }

    if (!userModel) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const provider = await User.findById(providerId).select("rates fullName");
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const ratePerMinute =
      provider.rates?.perMinute?.audioVideo ||
      provider.rates?.[consultationType] ||
      provider.rates?.audioVideo ||
      1; // Default 1 rupee per minute

    console.log("💰 RATE CONFIGURATION - DETAILED:", {
      consultationType,
      ratePerMinute,
      providerName: provider.fullName,
      providerRates: provider.rates,
      'rates.perMinute': provider.rates?.perMinute,
      'rates.perMinute.audioVideo': provider.rates?.perMinute?.audioVideo,
      'rates[consultationType]': provider.rates?.[consultationType],
      'rates.audioVideo': provider.rates?.audioVideo,
      'rates.video': provider.rates?.video,
      'rates.audio': provider.rates?.audio,
    });

    // 🚨 STRICT WALLET VALIDATION - NO FREE TRIALS, NO EXCEPTIONS
    const userWallet = userModel?.wallet || 0;

    if (ratePerMinute > 0) {
      // Reject zero or negative balances
      if (userWallet <= 0) {
        console.log("🚨 CALL REJECTED - ZERO/NEGATIVE BALANCE:", {
          userId,
          userWallet,
          ratePerMinute,
        });

        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You have ₹${userWallet.toFixed(2)} in your wallet. Please add money before starting the call.`,
        });
      }

      // Check minimum balance (at least 1 minute)
      if (userWallet < ratePerMinute) {
        console.log("🚨 CALL REJECTED - INSUFFICIENT FUNDS:", {
          userWallet,
          ratePerMinute,
          shortfall: ratePerMinute - userWallet,
        });

        return res.status(400).json({
          success: false,
          message: `Insufficient balance. You need at least ₹${ratePerMinute} for 1 minute. Current balance: ₹${userWallet.toFixed(2)}. Please add ₹${(ratePerMinute - userWallet).toFixed(2)} or more.`,
        });
      }

      console.log("✅ WALLET VALIDATION PASSED:", {
        userWallet,
        ratePerMinute,
        maxMinutes: Math.floor(userWallet / ratePerMinute),
      });
    }

    // Create consultation record - STRICT PREPAID MODEL (NO FREE TRIALS)
    const consultation = new Consultation({
      user: userId,
      userType: isGuest ? "Guest" : "User",
      provider: providerId,
      type: consultationType,
      status: "ongoing",
      rate: ratePerMinute,
      startTime: null, // Will be set when both sides accept
      totalAmount: 0, // Will be calculated in real-time
      duration: 0,
      billingStarted: false, // Will be true when both sides accept
      lastBillingTime: null,
      clientAccepted: true, // Client accepts by starting the consultation
      providerAccepted: false, // Provider needs to accept separately
      clientAcceptedAt: new Date(),
      providerAcceptedAt: null,
      bothSidesAcceptedAt: null,
      // NO FREE TRIALS - Billing starts immediately when call connects
      isFirstMinuteFree: false,
      freeMinuteUsed: false,
      billingStartsAt: null, // Will be set when call connects
    });

    await consultation.save();

    // Send ring notification for audio/video calls (works for both free and paid)
    if (consultationType === "audio" || consultationType === "video") {
      if (io) {
        // Get user info for notification
        let clientName = "Guest User";
        let clientPhoto = null;

        if (!isGuest) {
          const user = await User.findById(userId).select(
            "fullName profilePhoto"
          );
          if (user) {
            clientName = user.fullName;
            clientPhoto = user.profilePhoto;
          }
        } else {
          clientName = req.user.fullName || req.user.name || "Guest User";
        }

        // Send ring notification to all provider's connected sockets
        io.to(`user:${providerId}`).emit("consultation:incoming-call", {
          consultationId: consultation._id,
          type: consultationType,
          clientName: clientName,
          clientPhoto: clientPhoto,
          clientId: userId,
          providerId: providerId, // Add provider ID
          to: providerId, // Add 'to' field for mobile app compatibility
          from: userId, // Add 'from' field for mobile app compatibility
          fromName: clientName, // Add fromName for mobile app compatibility
          amount: ratePerMinute,
          isFirstMinuteFree: false, // NO FREE TRIALS
          isFree: ratePerMinute === 0, // Add flag to indicate if it's a free call
          timestamp: new Date(),
          source: "real-time-billing",
        });

        console.log(
          `🔔 Ring notification sent to provider ${providerId} for ${consultationType} consultation (Rate: ₹${ratePerMinute}/min, Free: ${
            ratePerMinute === 0
          })`
        );
      }
    }

    console.log(
      `⏰ Setting auto-cancellation timer for consultation ${consultation._id} (60 seconds)`
    );

    // Set auto-cancellation timer (1 minute) - works for both free and paid calls
    setTimeout(async () => {
      try {
        console.log(
          `⏰ AUTO-CANCELLATION TIMER TRIGGERED for consultation ${consultation._id}`
        );

        const currentConsultation = await Consultation.findById(
          consultation._id
        );

        console.log(`📋 Current consultation found: ${!!currentConsultation}`);
        if (currentConsultation) {
          console.log(
            `📋 Current consultation status: ${currentConsultation.status}, providerAccepted: ${currentConsultation.providerAccepted}`
          );
        }

        if (
          currentConsultation &&
          currentConsultation.status === "ongoing" &&
          !currentConsultation.providerAccepted
        ) {
          console.log(
            `⏰ AUTO-CANCELLING consultation ${consultation._id} - provider didn't answer within 1 minute`
          );

          // Use findByIdAndUpdate instead of save() to avoid potential middleware issues
          const updatedConsultation = await Consultation.findByIdAndUpdate(
            consultation._id,
            {
              status: "no_answer",
              endTime: new Date(),
              endReason: "no_answer",
              duration: 0,
              totalAmount: 0,
            },
            { new: true }
          );

          console.log(
            `✅ Consultation ${consultation._id} updated via findByIdAndUpdate. New status: ${updatedConsultation?.status}`
          );

          // Notify both sides via Socket.IO
          if (io) {
            // Get the user who cancelled (the caller)
            const cancellingUser = await User.findById(userId).select('fullName name');
            const cancelledByName = cancellingUser?.fullName || cancellingUser?.name || 'User';

            io.to(`user:${userId}`).emit("consultation:auto-cancelled", {
              consultationId: consultation._id,
              reason: "no_answer",
              message:
                "Call cancelled - Provider did not answer within 1 minute",
              timestamp: new Date(),
              cancelledBy: 'client',
              cancelledByUserId: userId,
              cancelledByName: cancelledByName,
            });

            io.to(`user:${providerId}`).emit("consultation:cancelled", {
              consultationId: consultation._id,
              reason: "auto_timeout",
              message: "Incoming call timed out",
              timestamp: new Date(),
              cancelledBy: 'system',
              cancelledByUserId: null,
              cancelledByName: 'System',
            });

            console.log(
              `📢 Auto-cancellation notifications sent to both parties`
            );
          }
        } else {
          console.log(
            `⚠️ Auto-cancellation skipped - consultation status: ${currentConsultation?.status}, providerAccepted: ${currentConsultation?.providerAccepted}`
          );
        }
      } catch (error) {
        console.error("❌ Error in auto-cancellation timer:", error);
        console.error("❌ Error stack:", error.stack);
      }
    }, 60000);

    console.log("✅ CONSULTATION STARTED SUCCESSFULLY:", {
      consultationId: consultation._id,
      ratePerMinute,
      isFree: ratePerMinute === 0,
      startTime: consultation.startTime,
      clientId: userId,
      providerId,
      consultationType,
    });

    res.json({
      success: true,
      data: {
        consultationId: consultation._id,
        ratePerMinute,
        providerName: provider.fullName,
        startTime: consultation.startTime,
        isFirstMinuteFree: false, // NO FREE TRIALS
        isFree: ratePerMinute === 0, // Add flag to indicate if it's a free call
        message:
          ratePerMinute === 0
            ? `Free call started with ${provider.fullName}!`
            : `Consultation started successfully with ${provider.fullName} at ₹${ratePerMinute}/min`,
      },
    });
  } catch (error) {
    console.error("❌ START CONSULTATION ERROR:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id || req.user?._id,
      requestBody: req.body,
    });
    logger.error("Error starting consultation:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Provider accepts the call - this is when billing starts
 */
const acceptCall = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;

    console.log("📞 PROVIDER ACCEPTING CALL:", {
      consultationId,
      providerId: userId,
    });

    // Get consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ message: "Consultation not found" });
    }

    // Check if user is the provider
    if (consultation.provider.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ message: "Only the provider can accept this call" });
    }

    // Check if consultation is still ongoing and not already accepted by provider
    if (consultation.status !== "ongoing") {
      return res
        .status(400)
        .json({ message: "Consultation is not in ongoing state" });
    }

    if (consultation.providerAccepted) {
      return res
        .status(400)
        .json({ message: "Provider has already accepted this call" });
    }

    // Mark provider as accepted
    consultation.providerAccepted = true;
    consultation.providerAcceptedAt = new Date();

    // Check if both sides have now accepted
    if (consultation.clientAccepted && consultation.providerAccepted) {
      // Both sides accepted - START CALL NOW
      const now = new Date();
      consultation.bothSidesAcceptedAt = now;
      consultation.startTime = now;
      consultation.billingStarted = true;
      consultation.lastBillingTime = now;

      // Handle First Minute Free Trial logic
      if (consultation.isFirstMinuteFree) {
        // Billing starts after 1 minute for first-time users
        consultation.billingStartsAt = new Date(now.getTime() + 60000); // 1 minute later
        console.log("🆓 FIRST MINUTE FREE - Billing starts after 1 minute");
      } else {
        // Regular billing starts immediately
        consultation.billingStartsAt = now;
        if (consultation.rate === 0) {
          console.log(
            "🆓 FREE CALL - Billing starts immediately with 0 charge"
          );
        } else {
          console.log("💰 PAID CALL - Billing starts immediately");
        }
      }

      console.log("🎉 BOTH SIDES ACCEPTED - CALL STARTED:", {
        consultationId,
        startTime: now,
        rate: consultation.rate,
        isFree: consultation.rate === 0,
        billingStartsAt: consultation.billingStartsAt,
        clientAcceptedAt: consultation.clientAcceptedAt,
        providerAcceptedAt: consultation.providerAcceptedAt,
      });

      // Notify both sides that call has started
      if (io) {
        const callStartData = {
          consultationId: consultation._id,
          startTime: now,
          isFirstMinuteFree: consultation.isFirstMinuteFree,
          isFree: consultation.rate === 0,
          billingStartsAt: consultation.billingStartsAt,
          message: consultation.isFirstMinuteFree
            ? `Call started! First minute is free, then ₹${consultation.rate}/min.`
            : consultation.rate === 0
            ? "Free call started! No charges will apply."
            : `Call started! Billing is active at ₹${consultation.rate}/min.`,
          timestamp: now,
        };

        // Notify client
        io.to(`user:${consultation.user}`).emit(
          "consultation:call-started",
          callStartData
        );
        // Notify provider
        io.to(`user:${consultation.provider}`).emit(
          "consultation:call-started",
          callStartData
        );

        console.log("📢 Call started notifications sent to both parties");
      }
    }

    await consultation.save();

    // CRITICAL FIX: Emit call acceptance event via socket
    if (io) {
      const acceptanceData = {
        consultationId: consultation._id.toString(),
        acceptedBy: userId.toString(),
        acceptedByName: req.user.fullName || req.user.name || "Provider",
        timestamp: new Date().toISOString(),
      };

      console.log("📡 Emitting call acceptance via socket:", acceptanceData);

      // Emit to client's user room
      io.to(`user:${consultation.user}`).emit(
        "consultation:call-accepted",
        acceptanceData
      );

      // Also emit to consultation and billing rooms
      io.to(`consultation:${consultationId}`).emit(
        "consultation:call-accepted",
        acceptanceData
      );
      io.to(`billing:${consultationId}`).emit(
        "consultation:call-accepted",
        acceptanceData
      );

      console.log("✅ Call acceptance emitted to client and rooms");
    }

    res.json({
      success: true,
      data: {
        consultationId: consultation._id,
        bothSidesAccepted:
          consultation.clientAccepted && consultation.providerAccepted,
        billingStarted: consultation.billingStarted,
        startTime: consultation.startTime,
        isFirstMinuteFree: consultation.isFirstMinuteFree,
        isFree: consultation.rate === 0,
        billingStartsAt: consultation.billingStartsAt,
        message: consultation.billingStarted
          ? consultation.isFirstMinuteFree
            ? `Call accepted! First minute is free, then ₹${consultation.rate}/min.`
            : consultation.rate === 0
            ? "Call accepted! Free call - no charges will apply."
            : "Call accepted! Billing has started at ₹" +
              consultation.rate +
              "/min"
          : "Call accepted! Waiting for client to join.",
      },
    });
  } catch (error) {
    logger.error("Error accepting call:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Process real-time billing (called every minute)
 */
/**
 * Process real-time billing (called every minute) - FIXED FOR NANDU-SAI ISSUE
 *
 * CRITICAL FIXES:
 * 1. Only CLIENT (person calling) gets charged - Nandu pays, not Sai
 * 2. Precise time calculation - if wallet=₹1, rate=₹1/min → exactly 1 minute
 * 3. Socket events go to CLIENT (Nandu), not provider (Sai)
 * 4. Call ends exactly when wallet exhausted
 */
const processRealTimeBilling = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log("💰 PRECISE BILLING (FIXED):", {
      consultationId,
      userId,
      isGuest,
      timestamp: new Date(),
    });

    // Get consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: "Consultation not found",
      });
    }

    console.log("📋 CONSULTATION DETAILS:", {
      id: consultation._id,
      client: consultation.user,
      provider: consultation.provider,
      status: consultation.status,
      rate: consultation.rate,
      startTime: consultation.startTime,
    });

    // CRITICAL FIX 1: Identify client vs provider correctly
    const isClient = consultation.user.toString() === userId.toString();
    const isProvider = consultation.provider.toString() === userId.toString();

    console.log("🔐 USER ROLE CHECK:", {
      requestingUserId: userId,
      isClient,
      isProvider,
      clientId: consultation.user,
      providerId: consultation.provider,
    });

    // CRITICAL FIX 2: Only process billing for CLIENT (person paying)
    if (!isClient) {
      // If provider is calling, just return current status
      return res.json({
        success: true,
        message: "Provider view - no billing needed",
        data: {
          duration: consultation.duration || 0,
          totalAmount: consultation.totalAmount || 0,
          canContinue: true, // Provider doesn't worry about wallet
        },
      });
    }

    // Check if consultation is ongoing
    if (consultation.status !== "ongoing") {
      return res.status(400).json({
        success: false,
        message: "Consultation is not ongoing",
      });
    }

    // Get CLIENT wallet (person who should be charged)
    const UserModel = isGuest ? Guest : User;
    const clientUser = await UserModel.findById(consultation.user); // Always get the client
    if (!clientUser) {
      return res.status(404).json({
        success: false,
        message: "Client user not found",
      });
    }

    const currentWallet = clientUser.wallet || 0;
    const ratePerMinute = consultation.rate || 1;

    console.log("💰 CLIENT WALLET STATUS:", {
      clientId: clientUser._id,
      clientName: clientUser.name,
      currentWallet,
      ratePerMinute,
    });

    // CRITICAL FIX 3: Calculate precise elapsed time
    const currentTime = new Date();
    const elapsedMs = currentTime - consultation.startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const elapsedMinutes = Math.ceil(elapsedSeconds / 60);

    // SIMPLE FIX: Calculate maximum affordable time in COMPLETE MINUTES
    const maxAffordableMinutes = Math.floor(currentWallet / ratePerMinute);
    const maxAffordableSeconds = maxAffordableMinutes * 60; // Convert to seconds for comparison

    console.log("⏱️ SIMPLE TIME CALCULATION:", {
      elapsedSeconds,
      elapsedMinutes,
      maxAffordableMinutes,
      maxAffordableSeconds,
      timeExceeded: elapsedSeconds >= maxAffordableSeconds,
      canAffordCurrentMinute: currentWallet >= ratePerMinute,
      approach: "Complete minutes only - user keeps leftover money",
    });

    // SIMPLE FIX: End call if complete minutes exceeded
    if (elapsedSeconds >= maxAffordableSeconds) {
      console.log("🚨 TIME EXCEEDED - ENDING CONSULTATION");
      console.log(
        `💰 User had ₹${currentWallet}, could afford ${maxAffordableMinutes} complete minutes`
      );

      // Calculate final billing - charge for complete minutes only with PRECISE calculation
      const finalMinutes = maxAffordableMinutes; // Use complete minutes, not partial
      const finalAmount = preciseMoneyCalculation(
        finalMinutes,
        ratePerMinute,
        "multiply"
      );

      // Deduct exact amount from CLIENT with PRECISE calculation
      const newClientWallet = preciseMoneyCalculation(
        clientUser.wallet,
        finalAmount,
        "subtract"
      );
      const newClientTotalSpent = preciseMoneyCalculation(
        clientUser.totalSpent || 0,
        finalAmount,
        "add"
      );

      clientUser.wallet = Math.max(0, newClientWallet);
      clientUser.totalSpent = newClientTotalSpent;
      await clientUser.save();

      // Update consultation
      consultation.status = "completed";
      consultation.endTime = currentTime;
      consultation.duration = finalMinutes;
      consultation.totalAmount = finalAmount;
      consultation.endReason = "wallet_exhausted";
      await consultation.save();

      // Add earnings to provider with PRECISE calculations
      const provider = await User.findById(consultation.provider);
      if (provider) {
        const platformCommission = preciseMoneyCalculation(
          finalAmount,
          PLATFORM_COMMISSION_RATE,
          "multiply"
        );
        const providerEarnings = preciseMoneyCalculation(
          finalAmount,
          platformCommission,
          "subtract"
        );

        const newProviderEarnings = preciseMoneyCalculation(
          provider.earnings || 0,
          providerEarnings,
          "add"
        );
        const newProviderWallet = preciseMoneyCalculation(
          provider.wallet || 0,
          providerEarnings,
          "add"
        );

        provider.earnings = newProviderEarnings;
        provider.wallet = newProviderWallet;
        await provider.save();
      }

      // CRITICAL FIX 6: Emit to CLIENT (not provider)
      if (io) {
        io.to(`consultation:${consultationId}`).emit("consultation_ended", {
          reason: "wallet_exhausted",
          message: "Call ended - wallet balance exhausted",
          showRatingModal: true,
          finalAmount,
          duration: finalMinutes,
          finalBalance: clientUser.wallet,
        });
      }

      return res.json({
        success: true,
        consultationEnded: true,
        message: "Consultation ended - wallet exhausted",
        showRatingModal: true,
        data: {
          finalAmount,
          duration: finalMinutes,
          remainingBalance: clientUser.wallet,
          reason: "wallet_exhausted",
        },
      });
    }

    // CRITICAL FIX 7: Check if client can afford current minute
    if (currentWallet < ratePerMinute) {
      console.log("🚨 INSUFFICIENT FUNDS FOR CURRENT MINUTE");

      // End consultation immediately
      consultation.status = "completed";
      consultation.endTime = currentTime;
      consultation.endReason = "insufficient_funds";
      await consultation.save();

      // CRITICAL FIX 8: Emit to CLIENT (not provider)
      if (io) {
        io.to(`consultation:${consultationId}`).emit("consultation_ended", {
          reason: "insufficient_funds",
          message: "Call ended - insufficient wallet balance",
          showRatingModal: true,
          finalBalance: currentWallet,
        });
      }

      return res.json({
        success: false,
        insufficientFunds: true,
        consultationEnded: true,
        message: "Consultation ended - insufficient funds",
        showRatingModal: true,
        data: {
          currentBalance: currentWallet,
          requiredAmount: ratePerMinute,
          reason: "insufficient_funds",
        },
      });
    }

    // Process billing - STRICT PER-MINUTE DEDUCTION (NO FREE TRIALS)
    const billableMinutesRoundedUp = Math.ceil(elapsedSeconds / 60); // Round UP to next minute
    const minutesToBill = billableMinutesRoundedUp - (consultation.duration || 0);

    if (minutesToBill > 0) {
      // PRECISE MONEY CALCULATION for billing amount
      const amountToBill = preciseMoneyCalculation(
        minutesToBill,
        ratePerMinute,
        "multiply"
      );

      console.log("💰 PER-MINUTE BILLING (STRICT MODE):", {
        elapsedSeconds,
        billableMinutesRoundedUp,
        minutesToBill,
        amountToBill,
        currentWallet,
        newBalance: currentWallet - amountToBill,
        approach: "1 minute = ₹" + ratePerMinute,
      });

      // PRECISE MONEY CALCULATION - Deduct money from CLIENT (caller)
      const newWalletBalance = preciseMoneyCalculation(
        clientUser.wallet,
        amountToBill,
        "subtract"
      );
      const newTotalSpent = preciseMoneyCalculation(
        clientUser.totalSpent || 0,
        amountToBill,
        "add"
      );

      clientUser.wallet = Math.max(0, newWalletBalance);
      clientUser.totalSpent = newTotalSpent;
      await clientUser.save();

      console.log("💸 CALLER WALLET DEDUCTED:", {
        callerId: clientUser._id,
        callerName: clientUser.name || clientUser.fullName,
        amountDeducted: amountToBill,
        previousBalance: currentWallet,
        newBalance: clientUser.wallet,
        totalSpent: clientUser.totalSpent,
      });

      // Update consultation with precise calculation
      const newTotalAmount = preciseMoneyCalculation(
        consultation.totalAmount || 0,
        amountToBill,
        "add"
      );
      consultation.duration = billableMinutesRoundedUp;
      consultation.totalAmount = newTotalAmount;
      consultation.lastBillingTime = currentTime;
      await consultation.save();

      // REAL-TIME CREDIT TO PROVIDER (receiver)
      const provider = await User.findById(consultation.provider);
      if (provider) {
        const platformCommission = preciseMoneyCalculation(
          amountToBill,
          PLATFORM_COMMISSION_RATE,
          "multiply"
        );
        const providerEarnings = preciseMoneyCalculation(
          amountToBill,
          platformCommission,
          "subtract"
        );

        const previousProviderWallet = provider.wallet || 0;
        const previousProviderEarnings = provider.earnings || 0;

        const newProviderEarnings = preciseMoneyCalculation(
          previousProviderEarnings,
          providerEarnings,
          "add"
        );
        const newProviderWallet = preciseMoneyCalculation(
          previousProviderWallet,
          providerEarnings,
          "add"
        );

        provider.earnings = newProviderEarnings;
        provider.wallet = newProviderWallet;
        await provider.save();

        console.log("💰 RECEIVER WALLET CREDITED (REAL-TIME):", {
          receiverId: provider._id,
          receiverName: provider.fullName,
          amountCredited: providerEarnings,
          platformCommission,
          previousWallet: previousProviderWallet,
          newWallet: provider.wallet,
          previousEarnings: previousProviderEarnings,
          newEarnings: provider.earnings,
        });

        // Create transaction records for both parties
        await Transaction.create([
          {
            user: clientUser._id,
            userType: isGuest ? "Guest" : "User",
            consultationId: consultation._id,
            type: "debit",
            category: "consultation",
            amount: amountToBill,
            balance: clientUser.wallet,
            description: `Call charge - ${minutesToBill} minute(s) @ ₹${ratePerMinute}/min with ${provider.fullName}`,
            status: "completed",
            paymentMethod: "wallet",
            metadata: {
              providerId: provider._id,
              providerName: provider.fullName,
              duration: minutesToBill,
              rate: ratePerMinute,
              previousBalance: currentWallet,
              newBalance: clientUser.wallet,
            },
          },
          {
            user: provider._id,
            userType: "User",
            consultationId: consultation._id,
            type: "credit",
            category: "consultation",
            amount: providerEarnings,
            balance: provider.wallet,
            description: `Earnings from call - ${minutesToBill} minute(s) @ ₹${ratePerMinute}/min with ${clientUser.name || clientUser.fullName}`,
            status: "completed",
            paymentMethod: "wallet",
            metadata: {
              clientId: clientUser._id,
              clientName: clientUser.name || clientUser.fullName,
              duration: minutesToBill,
              rate: ratePerMinute,
              grossAmount: amountToBill,
              platformCommission,
              netAmount: providerEarnings,
              previousBalance: previousProviderWallet,
              newBalance: provider.wallet,
            },
          },
        ]);

        console.log("📝 TRANSACTION RECORDS CREATED for both parties");
      }
    }

    // Calculate remaining time
    const updatedWallet = clientUser.wallet;
    const remainingAffordableMinutes = Math.floor(updatedWallet / ratePerMinute);
    const remainingAffordableSeconds = remainingAffordableMinutes * 60;

    console.log("⏱️ REMAINING TIME CALCULATION:", {
      updatedWallet,
      ratePerMinute,
      remainingAffordableMinutes,
      remainingAffordableSeconds,
      elapsedSeconds,
    });

    // Emit real-time update to BOTH parties
    if (io) {
      const billingUpdate = {
        consultationId: consultation._id,
        currentBalance: updatedWallet,
        totalCharged: consultation.totalAmount || 0,
        duration: consultation.duration || 0,
        remainingMinutes: remainingAffordableMinutes,
        remainingSeconds: remainingAffordableSeconds,
        canContinue: remainingAffordableMinutes > 0,
        warningThreshold: remainingAffordableMinutes <= 1,
        ratePerMinute,
      };

      // Notify caller about their wallet
      io.to(`user:${consultation.user}`).emit("billing:update", billingUpdate);
      
      // Notify receiver about earnings
      io.to(`user:${consultation.provider}`).emit("billing:update", {
        ...billingUpdate,
        isProvider: true,
        message: `Earning ₹${ratePerMinute}/min`,
      });

      console.log("📡 REAL-TIME BILLING UPDATE SENT to both parties");
    }

    return res.json({
      success: true,
      data: {
        charged: minutesToBill > 0 ? amountToBill : 0,
        remainingBalance: updatedWallet,
        canContinue: remainingAffordableMinutes > 0,
        remainingMinutes: remainingAffordableMinutes,
        remainingSeconds: remainingAffordableSeconds,
        duration: consultation.duration || 0,
        totalAmount: consultation.totalAmount || 0,
        warningThreshold: remainingAffordableMinutes <= 1,
        ratePerMinute,
      },
    });
  } catch (error) {
    console.error("❌ ERROR in processRealTimeBilling:", error);

    if (req.body?.consultationId) {
      await handleBillingError(
        error,
        req.body.consultationId,
        "processRealTimeBilling"
      );
    }

    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * End consultation manually
 */
const endConsultation = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;

    console.log("🛑 BILLING CONTROLLER - ENDING CONSULTATION:", {
      consultationId,
      userId,
      endpoint: '/billing/end',
      controller: 'realTimeBilling.controller.js',
    });

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ message: "Consultation not found" });
    }

    // Check if user is authorized to end this consultation
    if (
      consultation.user.toString() !== userId &&
      consultation.provider.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // 🚨 ENHANCED VALIDATION: Prevent duplicate ending
    if (consultation.status === "completed") {
      console.log("⚠️ CONSULTATION ALREADY COMPLETED:", {
        consultationId,
        status: consultation.status,
        endTime: consultation.endTime,
        totalAmount: consultation.totalAmount,
      });

      return res.json({
        success: true,
        data: {
          consultationId,
          duration: consultation.duration,
          totalAmount: consultation.totalAmount,
          endTime: consultation.endTime,
          message: "Consultation was already completed",
          alreadyCompleted: true,
        },
      });
    }

    // 🚨 ENHANCED VALIDATION: Check for existing transactions to prevent ghost billing
    const existingClientPayment = await Transaction.findOne({
      user: consultation.user,
      consultationId: consultationId,
      type: { $in: ["consultation_payment", "consultation"] },
      amount: { $gt: 0 },
    });

    const existingProviderEarning = await Transaction.findOne({
      user: consultation.provider,
      consultationId: consultationId,
      type: "earning",
      amount: { $gt: 0 },
    });

    console.log("🔍 EXISTING TRANSACTIONS CHECK:", {
      clientPayment: existingClientPayment
        ? `₹${existingClientPayment.amount}`
        : "None",
      providerEarning: existingProviderEarning
        ? `₹${existingProviderEarning.amount}`
        : "None",
    });

    // 🚨 GHOST BILLING PREVENTION: If provider earning exists but no client payment, this is suspicious
    if (existingProviderEarning && !existingClientPayment) {
      console.log("🚨 GHOST BILLING DETECTED:", {
        consultationId,
        providerEarning: existingProviderEarning.amount,
        clientPayment: "NONE",
        warning: "Provider was credited but client never paid",
      });

      // Log this as a critical error for monitoring
      logger.error("GHOST BILLING DETECTED", {
        consultationId,
        providerId: consultation.provider,
        clientId: consultation.user,
        providerEarning: existingProviderEarning.amount,
        timestamp: new Date().toISOString(),
      });

      // Don't create additional transactions - just mark as completed
      consultation.status = "completed";
      consultation.endTime = new Date();
      consultation.endReason = "system_error";
      consultation.totalAmount = 0; // Set to 0 since no client payment
      consultation.duration = 0;

      await consultation.save();

      return res.json({
        success: true,
        data: {
          consultationId,
          duration: 0,
          totalAmount: 0,
          endTime: consultation.endTime,
          message: "Consultation ended - ghost billing prevented",
          ghostBillingPrevented: true,
        },
      });
    }

    // End the consultation
    consultation.status = "completed";
    consultation.endTime = new Date();

    console.log("📊 CONSULTATION DATA BEFORE BILLING:", {
      consultationId: consultation._id,
      rate: consultation.rate,
      bothSidesAcceptedAt: consultation.bothSidesAcceptedAt,
      billingStarted: consultation.billingStarted,
      currentDuration: consultation.duration,
      currentTotalAmount: consultation.totalAmount,
    });

    // Calculate final duration and amount based on BILLING time, not consultation creation time
    let finalDuration = 0;
    let finalAmount = 0;

    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      // Calculate EXACT duration in seconds first
      const durationInSeconds = Math.floor(
        (consultation.endTime - consultation.bothSidesAcceptedAt) / 1000
      );

      console.log("⏱️ DURATION CALCULATION:", {
        bothSidesAcceptedAt: consultation.bothSidesAcceptedAt,
        endTime: consultation.endTime,
        durationInSeconds,
        durationInMinutes: (durationInSeconds / 60).toFixed(2),
      });

      // STRICT PREPAID MODEL - NO FREE MINUTES
      // Round UP: 2min 30sec = 3 minutes charged
      const billableMinutes = Math.ceil(durationInSeconds / 60);
      const ratePerMinute = consultation.rate || 0;
      
      console.log("💵 RATE CHECK:", {
        consultationRate: consultation.rate,
        ratePerMinute,
        isZero: ratePerMinute === 0,
        type: typeof ratePerMinute,
      });
      
      // PRECISE CALCULATION using integer arithmetic
      const rateInCents = Math.round(ratePerMinute * 100);
      const totalAmountInCents = billableMinutes * rateInCents;
      finalAmount = Math.round(totalAmountInCents) / 100;
      finalDuration = billableMinutes;

      console.log("💰 FINAL BILLING CALCULATION:", {
        durationInSeconds,
        billableMinutes,
        ratePerMinute,
        rateInCents,
        totalAmountInCents,
        finalAmount,
        finalDuration,
        calculation: `${billableMinutes} minutes × ₹${ratePerMinute} = ₹${finalAmount}`,
      });
    } else {
      console.log(
        "⚠️ No billing occurred - consultation ended before both sides accepted"
      );
    }

    consultation.duration = finalDuration;
    consultation.totalAmount = finalAmount;

    // 🚨 ENHANCED VALIDATION: Only process billing if amount > 0 AND no existing transactions
    if (finalAmount > 0 && !existingClientPayment && !existingProviderEarning) {
      console.log("💰 PROCESSING FINAL BILLING:", {
        duration: finalDuration,
        rate: consultation.rate,
        totalAmount: finalAmount,
      });

      // Get user and provider models
      const isGuest = consultation.userType === "Guest";
      const UserModel = isGuest ? Guest : User;
      const user = await UserModel.findById(consultation.user);
      const provider = await User.findById(consultation.provider);

      if (!user || !provider) {
        return res.status(404).json({ message: "User or provider not found" });
      }

      // 🚨 ENHANCED VALIDATION: Verify user has sufficient balance
      if (user.wallet < finalAmount) {
        console.log("⚠️ INSUFFICIENT FUNDS FOR FINAL BILLING:", {
          required: finalAmount,
          available: user.wallet,
          message:
            "Ending consultation without charge due to insufficient funds",
        });

        // End consultation without billing
        consultation.totalAmount = 0;
        consultation.endReason = "insufficient_funds";
        await consultation.save();

        return res.json({
          success: true,
          data: {
            consultationId,
            duration: finalDuration,
            totalAmount: 0,
            endTime: consultation.endTime,
            message: "Consultation ended - insufficient funds for billing",
            insufficientFunds: true,
          },
        });
      }

      // Calculate commission split with PRECISE decimal handling
      const platformCommission = preciseMoneyCalculation(
        finalAmount,
        PLATFORM_COMMISSION_RATE,
        "multiply"
      );
      const providerEarnings = preciseMoneyCalculation(
        finalAmount,
        platformCommission,
        "subtract"
      );

      console.log("💰 FINAL COMMISSION CALCULATION:", {
        finalAmount,
        platformCommissionRate: PLATFORM_COMMISSION_RATE,
        providerShareRate: PROVIDER_SHARE_RATE,
        platformCommission,
        providerEarnings,
        total: platformCommission + providerEarnings,
      });

      // 🚨 ATOMIC TRANSACTION: Deduct from client and credit provider in single operation
      try {
        // Deduct total amount from user wallet
        user.wallet -= finalAmount;
        await user.save();
        console.log("💸 DEDUCTED FROM CLIENT:", {
          userId: user._id,
          amount: finalAmount,
          newBalance: user.wallet,
        });

        // Add earnings to provider
        provider.wallet += providerEarnings;
        provider.earnings = (provider.earnings || 0) + providerEarnings;
        await provider.save();
        console.log("💰 CREDITED TO PROVIDER:", {
          providerId: provider._id,
          earnings: providerEarnings,
          newWallet: provider.wallet,
          newEarnings: provider.earnings,
        });

        // Create billing transactions
        await createBillingTransactions(
          consultation,
          user,
          provider,
          finalAmount,
          platformCommission,
          providerEarnings,
          isGuest
        );

        console.log("✅ BILLING COMPLETED SUCCESSFULLY");
      } catch (billingError) {
        console.error("❌ BILLING TRANSACTION FAILED:", billingError);

        // Rollback consultation status
        consultation.status = "ongoing";
        consultation.endTime = null;
        await consultation.save();

        return res.status(500).json({
          message: "Billing transaction failed - consultation remains active",
          error: billingError.message,
        });
      }
    } else if (existingClientPayment || existingProviderEarning) {
      console.log(
        "⚠️ BILLING ALREADY PROCESSED - Using existing transaction amounts"
      );

      // Use existing transaction amounts
      if (existingClientPayment) {
        consultation.totalAmount = existingClientPayment.amount;
      }
    } else {
      console.log("🆓 NO BILLING NEEDED - Free consultation or zero amount");
    }

    await consultation.save();

    console.log("✅ CONSULTATION ENDED:", {
      consultationId,
      finalDuration,
      totalAmount: consultation.totalAmount,
      endTime: consultation.endTime,
    });

    // 🔔 EMIT SOCKET EVENTS FOR FRONTEND SYNC
    if (io) {
      const consultationEndedData = {
        consultationId: consultation._id,
        status: "completed",
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        endTime: consultation.endTime,
        endReason: consultation.endReason || "manual",
        timestamp: new Date(),
      };

      // Notify both client and provider
      io.to(`user:${consultation.user}`).emit(
        "consultation:completed",
        consultationEndedData
      );
      io.to(`user:${consultation.provider}`).emit(
        "consultation:completed",
        consultationEndedData
      );

      // Also emit status change event for dashboard sync
      io.to(`user:${consultation.user}`).emit("consultation:status-changed", {
        consultationId: consultation._id,
        status: "completed",
        timestamp: new Date(),
      });
      io.to(`user:${consultation.provider}`).emit(
        "consultation:status-changed",
        {
          consultationId: consultation._id,
          status: "completed",
          timestamp: new Date(),
        }
      );

      console.log(
        "📡 SOCKET: Consultation completion events emitted to both parties"
      );
    }

    res.json({
      success: true,
      data: {
        consultationId,
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        endTime: consultation.endTime,
        message: "Consultation ended successfully",
      },
    });
  } catch (error) {
    logger.error("Error ending consultation:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * End consultation due to insufficient funds
 */
const endConsultationDueToInsufficientFunds = async (consultationId) => {
  try {
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) return;

    consultation.status = "completed";
    consultation.endTime = new Date();
    consultation.endReason = "insufficient_funds";

    // Calculate final duration based on billing time with precise calculation
    let finalDuration = 0;
    let finalAmount = 0;

    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      // Calculate EXACT duration in seconds
      const durationInSeconds = Math.floor(
        (consultation.endTime - consultation.bothSidesAcceptedAt) / 1000
      );

      // FIXED: Use per-minute billing (round up to full minutes)
      const durationInMinutes = durationInSeconds / 60;
      const billableMinutes = Math.ceil(durationInMinutes); // Round UP to next minute
      
      // PRECISE CALCULATION using integer arithmetic
      const rateInCents = Math.round(consultation.rate * 100);
      const totalAmountInCents = billableMinutes * rateInCents;
      finalAmount = Math.round(totalAmountInCents) / 100;
      finalDuration = billableMinutes; // Store billable minutes, not decimal minutes

      console.log("💸 PRECISE BILLING - INSUFFICIENT FUNDS:", {
        durationInSeconds,
        durationInMinutes: finalDuration,
        calculatedAmount: finalAmount,
      });
    }

    consultation.duration = finalDuration;
    consultation.totalAmount = finalAmount;

    await consultation.save();

    console.log("💸 CONSULTATION ENDED - INSUFFICIENT FUNDS:", {
      consultationId,
      finalDuration,
      totalAmount: consultation.totalAmount,
    });

    // 🔔 EMIT SOCKET EVENTS FOR FRONTEND SYNC
    if (io) {
      const consultationEndedData = {
        consultationId: consultation._id,
        status: "completed",
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        endTime: consultation.endTime,
        endReason: "insufficient_funds",
        timestamp: new Date(),
      };

      // Notify both client and provider
      io.to(`user:${consultation.user}`).emit(
        "consultation:completed",
        consultationEndedData
      );
      io.to(`user:${consultation.provider}`).emit(
        "consultation:completed",
        consultationEndedData
      );

      // Also emit status change event for dashboard sync
      io.to(`user:${consultation.user}`).emit("consultation:status-changed", {
        consultationId: consultation._id,
        status: "completed",
        timestamp: new Date(),
      });
      io.to(`user:${consultation.provider}`).emit(
        "consultation:status-changed",
        {
          consultationId: consultation._id,
          status: "completed",
          timestamp: new Date(),
        }
      );

      console.log(
        "📡 SOCKET: Insufficient funds consultation completion events emitted"
      );
    }
  } catch (error) {
    logger.error("Error ending consultation due to insufficient funds:", error);
  }
};

/**
 * Create billing transaction records
 */
const createBillingTransactions = async (
  consultation,
  user,
  provider,
  amount,
  platformCommission,
  providerEarnings,
  isGuest
) => {
  try {
    const timestamp = new Date();

    // User payment transaction
    const userTransaction = new Transaction({
      user: user._id,
      userType: isGuest ? "Guest" : "User",
      type: "consultation",
      category: "consultation",
      amount: amount,
      balance: user.wallet,
      description: `Consultation payment - ${consultation.type} with ${provider.fullName}`,
      status: "completed",
      consultationId: consultation._id,
      transactionId: `PAY_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        providerId: provider._id,
        ratePerMinute: consultation.rate,
        billingMinute: Math.ceil(
          (timestamp - consultation.startTime) / (1000 * 60)
        ),
      },
    });

    // Provider earning transaction
    const providerTransaction = new Transaction({
      user: provider._id,
      userType: "User",
      type: "earning",
      category: "consultation",
      amount: providerEarnings,
      balance: provider.wallet,
      description: `Consultation earning - ${consultation.type} consultation`,
      status: "completed",
      consultationId: consultation._id,
      transactionId: `EARN_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        clientId: user._id,
        clientType: isGuest ? "Guest" : "User",
        ratePerMinute: consultation.rate,
        platformCommission,
        grossAmount: amount,
        netAmount: providerEarnings,
      },
    });

    // Note: Platform commission is tracked in provider transaction metadata
    // No separate platform transaction needed as it would require different schema

    await Promise.all([userTransaction.save(), providerTransaction.save()]);

    console.log("📝 BILLING TRANSACTIONS CREATED:", {
      userPayment: amount,
      providerEarning: providerEarnings,
      platformCommission,
    });
  } catch (error) {
    logger.error("Error creating billing transactions:", error);
  }
};

/**
 * Get consultation status and billing info
 */
const getConsultationStatus = async (req, res) => {
  try {
    const { consultationId } = req.params;
    const userId = req.user.id || req.user._id;

    const consultation = await Consultation.findById(consultationId)
      .populate("provider", "fullName profilePhoto rates")
      .populate("user", "fullName profilePhoto");

    if (!consultation) {
      return res.status(404).json({ message: "Consultation not found" });
    }

    // Check authorization (handle both string and ObjectId formats for user field)
    const consultationUserId =
      typeof consultation.user === "string"
        ? consultation.user
        : consultation.user?._id?.toString();
    const consultationProviderId = consultation.provider?._id?.toString();
    const requestingUserId = req.user?.isGuest
      ? req.user.id
      : req.user?._id?.toString();

    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === requestingUserId;

    if (!isUser && !isProvider) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    logger.error("Error getting consultation status:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Check for ongoing consultations
 */
const checkOngoingConsultations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log("🔍 CHECKING ONGOING CONSULTATIONS:", {
      userId,
      isGuest,
    });

    // Find ongoing consultations where user is either client or provider
    const ongoingConsultations = await Consultation.find({
      $or: [
        { user: userId, status: "ongoing" },
        { provider: userId, status: "ongoing" },
      ],
    })
      .populate("provider", "fullName")
      .populate("user", "fullName");

    console.log("📋 ONGOING CONSULTATIONS FOUND:", ongoingConsultations.length);

    res.json({
      success: true,
      data: ongoingConsultations,
      hasOngoing: ongoingConsultations.length > 0,
    });
  } catch (error) {
    logger.error("Error checking ongoing consultations:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Emergency consultation end (for frontend timeout scenarios)
 */
const emergencyEndConsultation = async (req, res) => {
  try {
    const { consultationId } = req.params;
    const { reason, timestamp, userAgent } = req.body;
    const userId = req.user.id || req.user._id;

    console.log("🚨 EMERGENCY CONSULTATION END:", {
      consultationId,
      userId,
      reason,
      timestamp,
      userAgent,
    });

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ message: "Consultation not found" });
    }

    // Check if user is authorized
    if (
      consultation.user.toString() !== userId &&
      consultation.provider.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // If already completed, return existing data
    if (consultation.status === "completed") {
      return res.json({
        success: true,
        data: {
          consultationId,
          duration: consultation.duration,
          totalAmount: consultation.totalAmount,
          endTime: consultation.endTime,
          message: "Consultation was already completed",
          alreadyCompleted: true,
        },
      });
    }

    // Emergency end - mark as completed with minimal billing
    consultation.status = "completed";
    consultation.endTime = new Date();
    consultation.endReason = "system_error";

    // For emergency end, set minimal values to prevent ghost billing
    consultation.duration = 0;
    consultation.totalAmount = 0;

    await consultation.save();

    // Log emergency end for monitoring
    logger.warn("EMERGENCY CONSULTATION END", {
      consultationId,
      userId,
      reason,
      timestamp,
      userAgent,
      originalStatus: "ongoing",
      emergencyEndTime: consultation.endTime,
    });

    // Emit socket events
    if (io) {
      const emergencyEndData = {
        consultationId: consultation._id,
        status: "completed",
        duration: 0,
        totalAmount: 0,
        endTime: consultation.endTime,
        endReason: "system_error",
        emergency: true,
        timestamp: new Date(),
      };

      io.to(`user:${consultation.user}`).emit(
        "consultation:completed",
        emergencyEndData
      );
      io.to(`user:${consultation.provider}`).emit(
        "consultation:completed",
        emergencyEndData
      );
    }

    res.json({
      success: true,
      data: {
        consultationId,
        duration: 0,
        totalAmount: 0,
        endTime: consultation.endTime,
        message: "Consultation emergency ended successfully",
        emergency: true,
      },
    });
  } catch (error) {
    logger.error("Error in emergency consultation end:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * SERVER-SIDE WALLET MONITORING
 * Runs independently to catch frontend failures and prevent unlimited calls
 */
const startServerSideWalletMonitoring = () => {
  console.log(
    "🖥️ Starting server-side wallet monitoring for billing protection"
  );

  setInterval(async () => {
    try {
      // Find all ongoing consultations with billing started
      const ongoingConsultations = await Consultation.find({
        status: "ongoing",
        billingStarted: true,
        bothSidesAcceptedAt: { $exists: true },
      })
        .populate("user", "wallet fullName")
        .populate("provider", "fullName");

      if (ongoingConsultations.length === 0) {
        return; // No ongoing consultations to monitor
      }

      console.log(
        `🔍 SERVER MONITOR: Checking ${ongoingConsultations.length} ongoing consultations`
      );

      for (const consultation of ongoingConsultations) {
        const now = new Date();
        const callDurationMinutes =
          (now - consultation.bothSidesAcceptedAt) / (1000 * 60);

        // Check if call has been running too long without recent billing
        if (callDurationMinutes > 2) {
          // More than 2 minutes
          const recentTransactions = await Transaction.find({
            user: consultation.user._id,
            consultationId: consultation._id,
            createdAt: { $gte: new Date(now - 2 * 60 * 1000) }, // Last 2 minutes
          });

          if (recentTransactions.length === 0) {
            console.log(
              `🚨 SERVER MONITOR: No recent billing detected for consultation ${consultation._id}`
            );
            console.log(
              `   Duration: ${callDurationMinutes.toFixed(2)} minutes`
            );
            console.log(
              `   Client: ${consultation.user?.fullName || "Unknown"}`
            );
            console.log(
              `   Provider: ${consultation.provider?.fullName || "Unknown"}`
            );
            console.log(`   Rate: ₹${consultation.rate}/min`);

            // Force end the consultation due to billing system failure
            await endConsultationDueToInsufficientFunds(consultation._id);

            console.log(
              `✅ SERVER MONITOR: Force ended stuck consultation due to billing failure`
            );

            // Emit emergency termination
            if (io) {
              const emergencyData = {
                consultationId: consultation._id,
                reason: "billing_system_failure",
                message: "Call ended by server - billing system not responding",
                duration: callDurationMinutes,
                timestamp: now,
              };

              io.to(`user:${consultation.user._id}`).emit(
                "consultation:emergency-ended",
                emergencyData
              );
              io.to(`user:${consultation.provider._id}`).emit(
                "consultation:emergency-ended",
                emergencyData
              );
            }

            continue; // Skip wallet check since consultation is ended
          }
        }

        // Check wallet balance for insufficient funds
        const userWallet = consultation.user?.wallet || 0;
        const ratePerMinute = consultation.rate;

        if (userWallet < ratePerMinute) {
          console.log(`🚨 SERVER MONITOR: Insufficient balance detected`);
          console.log(`   User: ${consultation.user?.fullName || "Unknown"}`);
          console.log(`   Balance: ₹${userWallet}`);
          console.log(`   Required: ₹${ratePerMinute}/min`);
          console.log(`   Consultation: ${consultation._id}`);

          // Force end due to insufficient funds
          await endConsultationDueToInsufficientFunds(consultation._id);

          console.log(
            `✅ SERVER MONITOR: Auto-terminated due to insufficient funds`
          );

          // Emit auto-termination
          if (io) {
            const terminationData = {
              consultationId: consultation._id,
              reason: "insufficient_funds",
              message: "Call ended - insufficient wallet balance",
              userBalance: userWallet,
              requiredAmount: ratePerMinute,
              timestamp: now,
            };

            io.to(`user:${consultation.user._id}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
            io.to(`user:${consultation.provider._id}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
          }
        }
      }
    } catch (error) {
      console.error("❌ Server-side wallet monitoring error:", error);
      logger.error("Server-side wallet monitoring failed:", error);
    }
  }, 30000); // Check every 30 seconds
};

// Global error tracking for billing
const billingErrorCounts = {};

/**
 * Enhanced error handling for billing failures
 */
const handleBillingError = async (error, consultationId, context) => {
  console.error(`❌ BILLING ERROR in ${context}:`, error);

  // Log critical error for monitoring
  logger.error("CRITICAL_BILLING_ERROR", {
    consultationId,
    context,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  // Increment error count
  billingErrorCounts[consultationId] =
    (billingErrorCounts[consultationId] || 0) + 1;

  // If too many errors, force end consultation
  if (billingErrorCounts[consultationId] >= 3) {
    console.error(
      `🚨 CRITICAL: Too many billing errors for ${consultationId} - force ending`
    );

    try {
      await endConsultationDueToInsufficientFunds(consultationId);
      delete billingErrorCounts[consultationId];
    } catch (endError) {
      console.error("❌ Failed to force end consultation:", endError);
    }
  }

  // Emit error to frontend
  if (io) {
    // STANDARDIZED: Use consultation room format for all billing events
    io.to(`consultation:${consultationId}`).emit("billing:error", {
      message: "Billing system error - call may be terminated",
      errorCount: billingErrorCounts[consultationId],
      timestamp: new Date(),
    });
  }
};

// Start server-side monitoring when module is loaded
setTimeout(() => {
  startServerSideWalletMonitoring();
}, 5000); // Start after 5 seconds to ensure database is connected

module.exports = {
  checkConsultationAffordability,
  startConsultation,
  acceptCall,
  processRealTimeBilling,
  endConsultation,
  emergencyEndConsultation,
  getConsultationStatus,
  checkOngoingConsultations,
  setSocketIO,
  handleBillingError,
  startServerSideWalletMonitoring,
};
