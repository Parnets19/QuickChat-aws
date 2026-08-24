const { Consultation, User, Guest, Transaction } = require("../models");
const { logger } = require("../utils/logger");

// Get Socket.IO instance (will be set by server.js)
let io = null;
const setSocketIO = (socketInstance) => {
  io = socketInstance;
};

// Store active call termination timers (consultationId -> timeout)
const activeCallTimers = new Map();

// Cancel a call timer (called when call is manually ended)
const cancelCallTimer = (consultationId) => {
  const timerId = activeCallTimers.get(consultationId);
  if (timerId) {
    clearTimeout(timerId);
    activeCallTimers.delete(consultationId);
    console.log(`⏰ Call timer cancelled for ${consultationId}`);
  }
};

// Set a pre-calculated call termination timer
const setCallTerminationTimer = async (consultationId, maxDurationSeconds, userBalance, ratePerMinute) => {
  // Cancel any existing timer for this consultation
  cancelCallTimer(consultationId);

  console.log(`⏰ Setting call termination timer:`, {
    consultationId,
    maxDurationSeconds,
    maxDurationMinutes: (maxDurationSeconds / 60).toFixed(1),
    userBalance,
    ratePerMinute,
  });

  const timerId = setTimeout(async () => {
    try {
      console.log(`⏰ TIMER FIRED: Auto-terminating consultation ${consultationId} (max duration reached)`);
      
      // Verify consultation is still ongoing before terminating
      const consultation = await Consultation.findById(consultationId);
      if (!consultation || consultation.status !== 'ongoing') {
        console.log(`⏰ Consultation ${consultationId} already ended, skipping timer termination`);
        activeCallTimers.delete(consultationId);
        return;
      }

      // End the consultation
      await endConsultationDueToInsufficientFunds(consultationId);

      // Emit termination events to all rooms
      if (io) {
        const terminationData = {
          consultationId,
          reason: "insufficient_funds",
          message: "Call ended - wallet balance exhausted",
          userBalance: 0,
          requiredAmount: ratePerMinute,
          timestamp: new Date(),
        };

        io.to(`user:${consultation.user}`).emit("consultation:auto-terminated", terminationData);
        io.to(`user:${consultation.provider}`).emit("consultation:auto-terminated", terminationData);
        io.to(`consultation:${consultationId}`).emit("consultation:auto-terminated", terminationData);
        io.to(`billing:${consultationId}`).emit("consultation:auto-terminated", terminationData);
        console.log(`⏰ Auto-termination emitted for ${consultationId}`);
      }

      activeCallTimers.delete(consultationId);
    } catch (error) {
      console.error(`❌ Error in call termination timer for ${consultationId}:`, error);
      activeCallTimers.delete(consultationId);
    }
  }, maxDurationSeconds * 1000);

  activeCallTimers.set(consultationId, timerId);
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

// Platform commission rate (10%)
const PLATFORM_COMMISSION_RATE = 0.10;
const PROVIDER_SHARE_RATE = 0.90;

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

    // 🚨 WALLET VALIDATION
    const userWallet = userModel?.wallet || 0;

    if (ratePerMinute > 0) {
      // Reject zero or negative balances
      if (userWallet <= 0) {
        console.log("🚨 CALL REJECTED - ZERO/NEGATIVE BALANCE:", { userId, userWallet, ratePerMinute });
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You have ₹${userWallet.toFixed(2)} in your wallet. Please add money before starting the call.`,
        });
      }

      // Check minimum balance (at least 1 minute)
      if (userWallet < ratePerMinute) {
        console.log("🚨 CALL REJECTED - INSUFFICIENT FUNDS:", { userWallet, ratePerMinute });
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. You need at least ₹${ratePerMinute} for 1 minute. Current balance: ₹${userWallet.toFixed(2)}. Please add ₹${(ratePerMinute - userWallet).toFixed(2)} or more.`,
        });
      }

      console.log("✅ WALLET VALIDATION PASSED:", { userWallet, ratePerMinute, maxMinutes: Math.floor(userWallet / ratePerMinute) });
    }

    // Create consultation record
    const consultation = new Consultation({
      user: userId,
      userType: isGuest ? "Guest" : "User",
      provider: providerId,
      type: consultationType,
      status: "ongoing",
      rate: ratePerMinute,
      startTime: null,
      totalAmount: 0,
      duration: 0,
      billingStarted: false,
      lastBillingTime: null,
      clientAccepted: true,
      providerAccepted: false,
      clientAcceptedAt: new Date(),
      providerAcceptedAt: null,
      bothSidesAcceptedAt: null,
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
          isFree: ratePerMinute === 0,
          timestamp: new Date(),
          source: "real-time-billing",
        });

        console.log(
          `🔔 Ring notification sent to provider ${providerId} for ${consultationType} consultation (Rate: ₹${ratePerMinute}/min, Free: ${
            ratePerMinute === 0
          })`
        );

        // ── FCM Push Notification for background/killed state ─────────────
        // Socket only works when app is in foreground. FCM ensures the provider
        // gets notified even when the app is in background or killed.
        try {
          const provider = await User.findById(providerId).select("fcmTokens fullName");
          if (provider && provider.fcmTokens && provider.fcmTokens.length > 0) {
            const { sendPushNotification, sendMulticastNotification } = require("../utils/firebase");
            const callTitle = `Incoming ${consultationType === "video" ? "Video" : "Audio"} Call`;
            const callBody = `${clientName} is calling you`;
            const callData = {
              type: "consultation",
              action: "incoming_call",
              consultationId: consultation._id.toString(),
              consultationType,
              callType: consultationType,
              callerId: userId.toString(),
              fromName: clientName,
              to: providerId.toString(),
              clientPhoto: clientPhoto || "",
              rate: ratePerMinute.toString(),
              amount: ratePerMinute.toString(),
            };

            if (provider.fcmTokens.length === 1) {
              await sendPushNotification({
                title: callTitle,
                body: callBody,
                token: provider.fcmTokens[0],
                data: callData,
              });
            } else {
              await sendMulticastNotification({
                title: callTitle,
                body: callBody,
                token: provider.fcmTokens,
                data: callData,
              });
            }
            console.log(`📲 FCM push sent to provider ${providerId} (${provider.fcmTokens.length} device(s))`);
          } else {
            console.log(`⚠️ Provider ${providerId} has no FCM tokens — push skipped`);
          }
        } catch (fcmError) {
          // Non-critical — socket notification already sent
          console.error("⚠️ FCM push for incoming call failed (non-critical):", fcmError.message);
        }
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
        isFree: ratePerMinute === 0,
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

      if (consultation.rate === 0) {
        console.log(
          "🆓 FREE CALL - Billing starts immediately with 0 charge"
        );
      } else {
        console.log("💰 PAID CALL - Billing starts immediately");
      }

      console.log("🎉 BOTH SIDES ACCEPTED - CALL STARTED:", {
        consultationId,
        startTime: now,
        rate: consultation.rate,
        isFree: consultation.rate === 0,
        clientAcceptedAt: consultation.clientAcceptedAt,
        providerAcceptedAt: consultation.providerAcceptedAt,
      });

      // Notify both sides that call has started
      if (io) {
        const callStartData = {
          consultationId: consultation._id,
          startTime: now,
          isFree: consultation.rate === 0,
          message: consultation.rate === 0
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

    // START PRE-CALCULATED TERMINATION TIMER
    // Calculate max call duration based on wallet balance
    if (consultation.clientAccepted && consultation.providerAccepted && consultation.rate > 0) {
      try {
        const isGuest = consultation.userType === "Guest";
        const UserModel = isGuest ? Guest : User;
        const clientUser = await UserModel.findById(consultation.user).select("wallet");
        
        if (clientUser) {
          const maxMinutes = Math.floor(clientUser.wallet / consultation.rate);
          const maxDurationSeconds = maxMinutes * 60;
          
          if (maxDurationSeconds > 0) {
            await setCallTerminationTimer(
              consultation._id.toString(),
              maxDurationSeconds,
              clientUser.wallet,
              consultation.rate
            );
            console.log(`⏰ Call will auto-terminate in ${maxMinutes} minutes (₹${clientUser.wallet} / ₹${consultation.rate}/min)`);
          } else {
            // Can't even afford 1 minute — terminate immediately
            console.log(`🚨 User can't afford even 1 minute — terminating immediately`);
            setTimeout(() => endConsultationDueToInsufficientFunds(consultation._id.toString()), 5000);
          }
        }
      } catch (timerError) {
        console.error("⚠️ Error setting call timer (non-critical):", timerError);
        // Server monitor will still catch this as a safety net
      }
    }

    // CRITICAL FIX: Emit call acceptance event via socket
    if (io) {
      const acceptanceData = {
        consultationId: consultation._id.toString(),
        acceptedBy: userId.toString(),
        acceptedByName: req.user.fullName || req.user.name || "Provider",
        timestamp: new Date().toISOString(),
        source: req.body.source || req.headers['x-client-platform'] || 'unknown',
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
        isFree: consultation.rate === 0,
        message: consultation.billingStarted
          ? consultation.rate === 0
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

    // BILLING SAFETY GUARD: Do NOT process per-minute billing if WebRTC
    // has not confirmed connected. This prevents charging for calls where
    // both sides accepted but the media connection never established.
    if (!consultation.webrtcConnectedAt) {
      console.log(`⚠️ BILLING BLOCKED — webrtcConnectedAt not set for ${consultationId}. WebRTC not confirmed connected yet.`);
      return res.json({
        success: true,
        message: "Billing paused — waiting for WebRTC connection confirmation",
        data: {
          consultationId,
          billingBlocked: true,
          reason: "webrtc_not_connected",
        },
      });
    }

    // BILLING SAFETY GUARD: Explicit billingStarted check
    if (!consultation.billingStarted) {
      console.log(`⚠️ BILLING BLOCKED — billingStarted is false for ${consultationId}`);
      return res.json({
        success: true,
        message: "Billing not started yet",
        data: { consultationId, billingBlocked: true },
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
    // BILLING CLOCK = WEBRTC CONNECTION TIME. Per-minute billing is already gated
    // above on webrtcConnectedAt being set, so we measure elapsed time from the
    // moment media connected (both sides can talk) — NOT from accept/ringing.
    const currentTime = new Date();
    const billingStartTime =
      consultation.webrtcConnectedAt || consultation.startTime;
    const elapsedMs = currentTime - billingStartTime;
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
        `💰 User had ₹${currentWallet}, could afford ${maxAffordableMinutes} more complete minute(s)`
      );

      // INCREMENTAL billing: per-minute billing may have already charged earlier
      // minutes for this call. maxAffordableMinutes is based on the CURRENT
      // (remaining) wallet, so it represents the ADDITIONAL minutes still affordable.
      // We must ADD to the existing duration/totalAmount and record a transaction —
      // NOT overwrite (which would lose the per-minute history and leave the
      // provider's earnings ledger short).
      const additionalMinutes = maxAffordableMinutes;
      const additionalAmount = preciseMoneyCalculation(
        additionalMinutes,
        ratePerMinute,
        "multiply"
      );

      const previouslyBilledMinutes = consultation.duration || 0;
      const previouslyBilledAmount = consultation.totalAmount || 0;

      // Deduct the additional amount from CLIENT with PRECISE calculation
      const newClientWallet = preciseMoneyCalculation(
        clientUser.wallet,
        additionalAmount,
        "subtract"
      );
      const newClientTotalSpent = preciseMoneyCalculation(
        clientUser.totalSpent || 0,
        additionalAmount,
        "add"
      );

      clientUser.wallet = Math.max(0, newClientWallet);
      clientUser.totalSpent = newClientTotalSpent;
      await clientUser.save();

      // Update consultation — ACCUMULATE, don't overwrite
      const cumulativeMinutes = previouslyBilledMinutes + additionalMinutes;
      const cumulativeAmount = preciseMoneyCalculation(
        previouslyBilledAmount,
        additionalAmount,
        "add"
      );
      consultation.status = "completed";
      consultation.endTime = currentTime;
      consultation.duration = cumulativeMinutes;
      consultation.totalAmount = cumulativeAmount;
      consultation.lastBillingTime = currentTime;
      consultation.endReason = "wallet_exhausted";
      await consultation.save();

      // Add earnings to provider for the ADDITIONAL amount and record transactions
      const provider = await User.findById(consultation.provider);
      if (provider && additionalAmount > 0) {
        const platformCommission = preciseMoneyCalculation(
          additionalAmount,
          PLATFORM_COMMISSION_RATE,
          "multiply"
        );
        const providerEarnings = preciseMoneyCalculation(
          additionalAmount,
          platformCommission,
          "subtract"
        );

        const previousProviderWallet = provider.wallet || 0;
        provider.earnings = preciseMoneyCalculation(
          provider.earnings || 0,
          providerEarnings,
          "add"
        );
        provider.wallet = preciseMoneyCalculation(
          previousProviderWallet,
          providerEarnings,
          "add"
        );
        await provider.save();

        // Record transactions so the ledger matches the wallet movements and
        // endConsultation's reconciliation sees the full charged amount.
        await Transaction.create([
          {
            user: clientUser._id,
            userType: isGuest ? "Guest" : "User",
            consultationId: consultation._id,
            type: "debit",
            category: "consultation",
            amount: additionalAmount,
            balance: clientUser.wallet,
            description: `Call charge (final) - ${additionalMinutes} minute(s) @ ₹${ratePerMinute}/min with ${provider.fullName}`,
            status: "completed",
            paymentMethod: "wallet",
            metadata: {
              providerId: provider._id,
              providerName: provider.fullName,
              duration: additionalMinutes,
              rate: ratePerMinute,
              reason: "wallet_exhausted",
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
            description: `Earnings from call (final) - ${additionalMinutes} minute(s) @ ₹${ratePerMinute}/min`,
            status: "completed",
            paymentMethod: "wallet",
            metadata: {
              clientId: clientUser._id,
              duration: additionalMinutes,
              rate: ratePerMinute,
              grossAmount: additionalAmount,
              platformCommission,
              netAmount: providerEarnings,
            },
          },
        ]);
      }

      // CRITICAL FIX 6: Emit to CLIENT (not provider)
      if (io) {
        io.to(`consultation:${consultationId}`).emit("consultation_ended", {
          reason: "wallet_exhausted",
          message: "Call ended - wallet balance exhausted",
          showRatingModal: true,
          finalAmount: cumulativeAmount,
          duration: cumulativeMinutes,
          finalBalance: clientUser.wallet,
        });
      }

      return res.json({
        success: true,
        consultationEnded: true,
        message: "Consultation ended - wallet exhausted",
        showRatingModal: true,
        data: {
          finalAmount: cumulativeAmount,
          duration: cumulativeMinutes,
          remainingBalance: clientUser.wallet,
          canContinue: false,
          reason: "wallet_exhausted",
        },
      });
    }

    // CRITICAL FIX 7: Check if client can afford current minute
    if (currentWallet < ratePerMinute) {
      console.log("🚨 INSUFFICIENT FUNDS FOR CURRENT MINUTE");

      // Calculate duration up to this point (from connection time)
      const durationInSeconds = Math.floor((currentTime - billingStartTime) / 1000);
      const durationMinutes = Math.floor(durationInSeconds / 60);

      // End consultation immediately
      consultation.status = "completed";
      consultation.endTime = currentTime;
      consultation.duration = durationMinutes;
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

    // Declared in the outer scope so the success response can safely reference it
    // even when minutesToBill === 0 (otherwise the response throws a ReferenceError
    // AFTER the wallet was already deducted -> client/provider get charged but the
    // request returns 500).
    let amountToBill = 0;

    if (minutesToBill > 0) {
      // PRECISE MONEY CALCULATION for billing amount
      amountToBill = preciseMoneyCalculation(
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

    // Cancel the pre-calculated termination timer since call is being manually ended
    cancelCallTimer(consultationId);

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

    // Check if user is authorized to end this consultation.
    // Conference participants are allowed to call this endpoint but we skip billing for them —
    // only the original user/provider settles the bill.
    const isOriginalParty =
      consultation.user?.toString() === String(userId) ||
      consultation.provider?.toString() === String(userId);

    const isConferenceParticipant = !isOriginalParty &&
      (consultation.participants || []).some(
        p => p.userId?.toString() === String(userId)
      );

    if (!isOriginalParty && !isConferenceParticipant) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Conference participants just leave — no billing to process for them
    if (isConferenceParticipant) {
      return res.json({
        success: true,
        data: { consultationId, message: 'Conference participant left — no billing required' },
      });
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
    // and DOUBLE billing. The per-minute path (processRealTimeBilling) writes
    // type "debit"/"credit" (category "consultation"), while the final-settlement
    // path (createBillingTransactions) writes "consultation_payment"/"earning".
    // The guard MUST recognise BOTH, otherwise per-minute charges go undetected and
    // the full amount is billed AGAIN at call end (client double-charged, provider
    // double-credited). Scoped by consultationId so the generic debit/credit types
    // can only match this consultation's records.
    const existingClientPayment = await Transaction.findOne({
      user: consultation.user,
      consultationId: consultationId,
      type: { $in: ["consultation_payment", "consultation", "debit"] },
      amount: { $gt: 0 },
    });

    const existingProviderEarning = await Transaction.findOne({
      user: consultation.provider,
      consultationId: consultationId,
      type: { $in: ["earning", "credit"] },
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
      // BILLING CLOCK = WEBRTC CONNECTION TIME (webrtcConnectedAt). We charge ONLY
      // for talk time after the media actually connected (both sides can talk).
      // Ringing, accept, and the WebRTC handshake are NOT charged.
      let billingStartTime = consultation.webrtcConnectedAt || null;

      const callDurationFromAccept = Math.floor(
        (consultation.endTime - consultation.bothSidesAcceptedAt) / 1000
      );

      if (!billingStartTime) {
        // webrtc:connected was never recorded. If the call clearly ran a while
        // (> 60s from accept) the event was probably lost on a flaky network, so
        // fall back to accept time so a real call still gets billed. Otherwise
        // (short AND never connected) it was ringing/failed — charge nothing.
        if (callDurationFromAccept > 60) {
          console.log(
            `webrtcConnectedAt missing but call lasted ${callDurationFromAccept}s - using bothSidesAcceptedAt as fallback`
          );
          billingStartTime = consultation.bothSidesAcceptedAt;
        } else {
          console.log(
            `NO WEBRTC CONNECTION RECORDED for ${consultationId} - NO CHARGE APPLIED`,
            {
              bothSidesAcceptedAt: consultation.bothSidesAcceptedAt,
              webrtcConnectedAt: consultation.webrtcConnectedAt,
              callDurationFromAccept,
              reason:
                "Never connected and call too short - protecting client (ringing/failed call)",
            }
          );
          finalDuration = 0;
          finalAmount = 0;
          consultation.endReason =
            consultation.endReason || "no_webrtc_connection";
        }
      }

      if (billingStartTime) {
        // Duration measured from the ACCEPT moment.
        const durationInSeconds = Math.floor(
          (consultation.endTime - billingStartTime) / 1000
        );

        console.log("DURATION CALCULATION:", {
          bothSidesAcceptedAt: consultation.bothSidesAcceptedAt,
          endTime: consultation.endTime,
          durationInSeconds,
          durationInMinutes: (durationInSeconds / 60).toFixed(2),
        });

        // STRICT PREPAID MODEL - round UP, MINIMUM 1 minute for any real call.
        // The webrtcConnectedAt gate above already blocked ghost calls (accepted
        // but media never connected). Any call that reaches here is a real call,
        // so a 20s or 45s call is billed as a full 1 minute.
        const billableMinutes = Math.ceil(durationInSeconds / 60);
        const ratePerMinute = consultation.rate || 0;
        const rateInCents = Math.round(ratePerMinute * 100);
        const totalAmountInCents = billableMinutes * rateInCents;
        finalAmount = Math.round(totalAmountInCents) / 100;
        finalDuration = billableMinutes;

        console.log("FINAL BILLING CALCULATION:", {
          durationInSeconds,
          billableMinutes,
          ratePerMinute,
          finalAmount,
          finalDuration,
          calculation: `${billableMinutes} min x Rs.${ratePerMinute} = Rs.${finalAmount}`,
        });
      }
    } else {
      console.log(
        "No billing occurred - consultation ended before both sides accepted"
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

      // 🚨 ENHANCED VALIDATION: If user has insufficient balance, charge what they can afford
      if (user.wallet < finalAmount) {
        console.log("⚠️ INSUFFICIENT FUNDS FOR FULL BILLING - charging partial:", {
          required: finalAmount,
          available: user.wallet,
          message: "Charging available balance instead of full amount",
        });

        // Charge what the user has (partial billing)
        finalAmount = Math.floor(user.wallet * 100) / 100; // Round down to 2 decimal places
        
        // If user has less than ₹0.01, don't charge anything
        if (finalAmount < 0.01) {
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
              message: "Consultation ended - no balance available",
              insufficientFunds: true,
            },
          });
        }
        
        // Recalculate duration based on what they can afford
        finalDuration = Math.floor(finalAmount / consultation.rate);
        consultation.endReason = "insufficient_funds_partial";
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
        // Mark first-earning milestone if not already set
        if (!provider.hasFirstEarning && providerEarnings > 0) {
          provider.hasFirstEarning = true;
        }
        await provider.save();
        console.log("💰 CREDITED TO PROVIDER:", {
          providerId: provider._id,
          earnings: providerEarnings,
          newWallet: provider.wallet,
          newEarnings: provider.earnings,
          hasFirstEarning: provider.hasFirstEarning,
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
        "⚠️ BILLING PARTIALLY PROCESSED (per-minute) - settling final partial minute"
      );

      // Per-minute billing already charged the COMPLETED minutes. But the final
      // partial minute (round-up) is usually still unbilled — e.g. a 1m5s call at
      // ₹2/min: per-minute charged ₹2 (1 min) but the rounded-up total is ₹4
      // (2 min). finalAmount above is the TRUE rounded-up total (from connection
      // time). Charge ONLY the difference so we honor round-up without
      // double-charging the minutes already billed.
      const clientCharges = await Transaction.aggregate([
        {
          $match: {
            user: consultation.user,
            consultationId: consultation._id,
            type: { $in: ["consultation_payment", "consultation", "debit"] },
            amount: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const alreadyCharged =
        clientCharges.length > 0
          ? Math.round(clientCharges[0].total * 100) / 100
          : 0;
      const outstandingAmount =
        Math.round((finalAmount - alreadyCharged) * 100) / 100;

      console.log("🧾 RECONCILE:", {
        consultationId,
        roundedUpTotal: finalAmount,
        alreadyCharged,
        outstandingAmount,
      });

      if (outstandingAmount >= 0.01) {
        const isGuest = consultation.userType === "Guest";
        const UserModel = isGuest ? Guest : User;
        const user = await UserModel.findById(consultation.user);
        const provider = await User.findById(consultation.provider);

        if (user && provider) {
          // Cap to what the client can actually afford
          let chargeAmount = outstandingAmount;
          if (user.wallet < outstandingAmount) {
            chargeAmount = Math.floor(user.wallet * 100) / 100;
          }

          if (chargeAmount >= 0.01) {
            const platformCommission = preciseMoneyCalculation(
              chargeAmount,
              PLATFORM_COMMISSION_RATE,
              "multiply"
            );
            const providerEarnings = preciseMoneyCalculation(
              chargeAmount,
              platformCommission,
              "subtract"
            );

            user.wallet = Math.max(
              0,
              preciseMoneyCalculation(user.wallet, chargeAmount, "subtract")
            );
            await user.save();

            provider.wallet = preciseMoneyCalculation(
              provider.wallet || 0,
              providerEarnings,
              "add"
            );
            provider.earnings = preciseMoneyCalculation(
              provider.earnings || 0,
              providerEarnings,
              "add"
            );
            await provider.save();

            await createBillingTransactions(
              consultation,
              user,
              provider,
              chargeAmount,
              platformCommission,
              providerEarnings,
              isGuest
            );

            consultation.totalAmount =
              Math.round((alreadyCharged + chargeAmount) * 100) / 100;
            consultation.duration =
              consultation.rate > 0
                ? Math.round(consultation.totalAmount / consultation.rate)
                : finalDuration;

            console.log(
              `✅ FINAL PARTIAL MINUTE SETTLED: +₹${chargeAmount} (client total ₹${consultation.totalAmount}, provider +₹${providerEarnings})`
            );
          } else {
            consultation.totalAmount = alreadyCharged;
          }
        }
      } else {
        // Nothing outstanding — per-minute already covered the full rounded total.
        consultation.totalAmount =
          alreadyCharged > 0
            ? alreadyCharged
            : existingClientPayment
            ? existingClientPayment.amount
            : consultation.totalAmount;
        consultation.duration =
          consultation.rate > 0
            ? Math.round(consultation.totalAmount / consultation.rate)
            : finalDuration;
        console.log("📊 RECONCILED (no extra charge needed):", {
          consultationId,
          total: consultation.totalAmount,
          duration: consultation.duration,
        });
      }
    } else {
      console.log("🆓 NO BILLING NEEDED - Free consultation or zero amount");
    }

    await consultation.save();

    // Re-fetch provider to get final hasFirstEarning value (may have been set above)
    const finalProvider = await User.findById(consultation.provider).select("hasFirstEarning earnings wallet").lean();
    const isFirstEarning = finalProvider?.hasFirstEarning === true && consultation.totalAmount > 0;
    // providerEarnings for this consultation = totalAmount * PROVIDER_SHARE_RATE
    const finalProviderEarnings = consultation.totalAmount > 0
      ? Math.round(consultation.totalAmount * PROVIDER_SHARE_RATE * 100) / 100
      : 0;

    console.log("✅ CONSULTATION ENDED:", {
      consultationId,
      finalDuration,
      totalAmount: consultation.totalAmount,
      providerEarnings: finalProviderEarnings,
      isFirstEarning,
      endTime: consultation.endTime,
    });

    // 🔔 EMIT SOCKET EVENTS FOR FRONTEND SYNC
    if (io) {
      const consultationEndedData = {
        consultationId: consultation._id,
        status: "completed",
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        providerEarnings: finalProviderEarnings,
        isFirstEarning,
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

      // CRITICAL: Also emit consultation:ended for web frontend compatibility
      io.to(`user:${consultation.user}`).emit(
        "consultation:ended",
        consultationEndedData
      );
      io.to(`user:${consultation.provider}`).emit(
        "consultation:ended",
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
        providerEarnings: finalProviderEarnings,
        isFirstEarning,
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
    // Cancel any existing timer for this consultation
    cancelCallTimer(consultationId);

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) return;

    // 🚨 CONCURRENCY GUARD: This function can be invoked by several independent
    // safety nets at once (pre-calc termination timer, 30s server monitor) and may
    // race with a manual endConsultation. If the consultation is already completed,
    // do NOT charge again — that would double-deduct the client and double-credit
    // the provider.
    if (consultation.status === "completed") {
      console.log(
        `⏭️ endConsultationDueToInsufficientFunds: ${consultationId} already completed — skipping to avoid double billing`
      );
      return;
    }

    consultation.status = "completed";
    consultation.endTime = new Date();
    consultation.endReason = "insufficient_funds";

    // Calculate final duration based on billing time with precise calculation
    let finalDuration = 0;
    let finalAmount = 0;

    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      // BILLING CLOCK = WEBRTC CONNECTION TIME (webrtcConnectedAt). Only talk time
      // after media connected is charged; ringing/accept/handshake is not. Falls
      // back to accept time only if the connect event was never recorded.
      const billingStartTime =
        consultation.webrtcConnectedAt || consultation.bothSidesAcceptedAt;

      // Calculate EXACT duration in seconds
      const durationInSeconds = Math.floor(
        (consultation.endTime - billingStartTime) / 1000
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

    // 🚨 DOUBLE-BILLING GUARD: per-minute billing (processRealTimeBilling) may have
    // already charged most/all of this call. Only charge the REMAINING unbilled
    // amount, never the full finalAmount again.
    const priorClientCharges = await Transaction.aggregate([
      {
        $match: {
          user: consultation.user,
          consultationId: consultation._id,
          type: { $in: ["consultation_payment", "consultation", "debit"] },
          amount: { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const alreadyCharged =
      priorClientCharges.length > 0
        ? Math.round(priorClientCharges[0].total * 100) / 100
        : 0;

    // Outstanding amount still owed after subtracting what was already billed
    const outstandingAmount =
      Math.round((finalAmount - alreadyCharged) * 100) / 100;

    if (alreadyCharged > 0) {
      console.log("🧾 PRIOR PER-MINUTE CHARGES DETECTED:", {
        consultationId,
        finalAmount,
        alreadyCharged,
        outstandingAmount,
      });
    }

    // CRITICAL FIX: Actually process the payment (charge what user can afford)
    if (outstandingAmount > 0) {
      const isGuest = consultation.userType === "Guest";
      const UserModel = isGuest ? Guest : User;
      const user = await UserModel.findById(consultation.user);
      const provider = await User.findById(consultation.provider);

      if (user && provider) {
        // Charge what user can afford (partial billing), capped to the outstanding
        let chargeAmount = outstandingAmount;
        if (user.wallet < outstandingAmount) {
          chargeAmount = Math.floor(user.wallet * 100) / 100; // Round down
          console.log(`💰 PARTIAL CHARGE: User has ₹${user.wallet}, charging ₹${chargeAmount} instead of ₹${outstandingAmount}`);
        }

        if (chargeAmount >= 0.01) {
          // Calculate commission
          const platformCommission = Math.round(chargeAmount * 0.10 * 100) / 100; // 10%
          const providerEarnings = Math.round((chargeAmount - platformCommission) * 100) / 100;

          // Deduct from client
          user.wallet -= chargeAmount;
          await user.save();
          console.log(`💸 DEDUCTED ₹${chargeAmount} from client. New balance: ₹${user.wallet}`);

          // Credit provider
          provider.wallet += providerEarnings;
          provider.earnings = (provider.earnings || 0) + providerEarnings;
          await provider.save();
          console.log(`💰 CREDITED ₹${providerEarnings} to provider. New balance: ₹${provider.wallet}`);

          // Record TRUE total charged for this consultation (prior + this final charge)
          consultation.totalAmount =
            Math.round((alreadyCharged + chargeAmount) * 100) / 100;
          consultation.duration =
            consultation.rate > 0
              ? Math.round(consultation.totalAmount / consultation.rate)
              : finalDuration;

          // Create transaction records
          await createBillingTransactions(
            consultation,
            user,
            provider,
            chargeAmount,
            platformCommission,
            providerEarnings,
            isGuest
          );

          console.log(`✅ PAYMENT PROCESSED: Client charged ₹${chargeAmount}, Provider earned ₹${providerEarnings}`);
        } else {
          // Nothing more could be collected; keep the already-charged total
          consultation.totalAmount = alreadyCharged;
          console.log(`⚠️ User balance too low (₹${user.wallet}), no additional charge applied`);
        }
      }
    } else if (alreadyCharged > 0) {
      // Fully covered by per-minute billing — no additional charge
      consultation.totalAmount = alreadyCharged;
      consultation.duration =
        consultation.rate > 0
          ? Math.round(alreadyCharged / consultation.rate)
          : finalDuration;
      console.log(`✅ Already fully billed via per-minute (₹${alreadyCharged}) — no extra charge`);
    }

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

      // CRITICAL: Also emit consultation:ended for web frontend compatibility
      io.to(`user:${consultation.user}`).emit(
        "consultation:ended",
        consultationEndedData
      );
      io.to(`user:${consultation.provider}`).emit(
        "consultation:ended",
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
      type: "consultation_payment",  // valid enum value
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
      .populate("provider", "fullName profilePhoto rates hasFirstEarning")
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

    // Compute provider earnings for this consultation (90% of totalAmount)
    const providerEarnings = consultation.totalAmount > 0
      ? Math.round(consultation.totalAmount * PROVIDER_SHARE_RATE * 100) / 100
      : 0;

    // isFirstEarning is true if the provider's hasFirstEarning flag is now set
    // AND this consultation had a non-zero amount (meaning they earned on it)
    const isFirstEarning =
      isProvider &&
      consultation.provider?.hasFirstEarning === true &&
      providerEarnings > 0;

    res.json({
      success: true,
      data: {
        ...consultation.toObject(),
        providerEarnings,
        isFirstEarning,
      },
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
      });

      if (ongoingConsultations.length === 0) {
        return; // No ongoing consultations to monitor
      }

      console.log(
        `🔍 SERVER MONITOR: Checking ${ongoingConsultations.length} ongoing consultations`
      );

      for (const consultation of ongoingConsultations) {
        const now = new Date();
        const callDurationSeconds = Math.floor(
          (now - consultation.bothSidesAcceptedAt) / 1000
        );
        const callDurationMinutes = callDurationSeconds / 60;

        // CRITICAL FIX: Only check consultations that have been running for at least 1 minute
        // This prevents premature termination during the first minute
        if (callDurationSeconds < 60) {
          console.log(
            `⏳ SERVER MONITOR: Skipping consultation ${consultation._id} - only ${callDurationSeconds}s elapsed (waiting for 60s)`
          );
          continue;
        }

        // Check if call has been running too long without recent billing
        if (callDurationMinutes > 2) {
          // More than 2 minutes
          const recentTransactions = await Transaction.find({
            user: consultation.user,
            consultationId: consultation._id,
            createdAt: { $gte: new Date(now - 2 * 60 * 1000) }, // Last 2 minutes
          });

          if (recentTransactions.length === 0) {
            // Get fresh user data for logging
            const UserModel = consultation.userType === "Guest" ? Guest : User;
            const freshUser = await UserModel.findById(consultation.user).select("fullName name");
            const provider = await User.findById(consultation.provider).select("fullName");

            console.log(
              `🚨 SERVER MONITOR: No recent billing detected for consultation ${consultation._id}`
            );
            console.log(
              `   Duration: ${callDurationMinutes.toFixed(2)} minutes`
            );
            console.log(
              `   Client: ${freshUser?.fullName || freshUser?.name || "Unknown"}`
            );
            console.log(
              `   Provider: ${provider?.fullName || "Unknown"}`
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

              io.to(`user:${consultation.user}`).emit(
                "consultation:emergency-ended",
                emergencyData
              );
              io.to(`user:${consultation.provider}`).emit(
                "consultation:emergency-ended",
                emergencyData
              );
            }

            continue; // Skip wallet check since consultation is ended
          }
        }

        // CRITICAL FIX: Fetch FRESH wallet balance from database (not stale populated data)
        const UserModel = consultation.userType === "Guest" ? Guest : User;
        const freshUser = await UserModel.findById(consultation.user).select("wallet fullName name");
        
        if (!freshUser) {
          console.log(`⚠️ SERVER MONITOR: User not found for consultation ${consultation._id}`);
          continue;
        }

        const userWallet = freshUser.wallet || 0;
        const ratePerMinute = consultation.rate;

        // Calculate how much the call has cost SO FAR
        const billableMinutesSoFar = Math.ceil(callDurationSeconds / 60);
        const totalCostSoFar = billableMinutesSoFar * ratePerMinute;
        // Check if user can afford the NEXT minute (total cost + 1 more minute)
        const costForNextMinute = totalCostSoFar + ratePerMinute;
        const canAffordNextMinute = userWallet >= costForNextMinute;
        // Also check if current cost already exceeds wallet
        const currentCostExceedsWallet = totalCostSoFar > userWallet;

        console.log(`💰 SERVER MONITOR: Wallet check for consultation ${consultation._id}:`, {
          userId: freshUser._id,
          userName: freshUser.fullName || freshUser.name,
          freshWallet: userWallet,
          ratePerMinute,
          callDurationSeconds,
          callDurationMinutes: callDurationMinutes.toFixed(2),
          billableMinutesSoFar,
          totalCostSoFar,
          costForNextMinute,
          canAffordNextMinute,
          currentCostExceedsWallet,
        });

        // Terminate if: current cost exceeds wallet OR can't afford next minute
        if (currentCostExceedsWallet || !canAffordNextMinute) {
          console.log(`🚨 SERVER MONITOR: Insufficient balance detected`);
          console.log(`   User: ${freshUser.fullName || freshUser.name || "Unknown"}`);
          console.log(`   Balance: ₹${userWallet}`);
          console.log(`   Required: ₹${ratePerMinute}/min`);
          console.log(`   Consultation: ${consultation._id}`);
          console.log(`   Duration: ${callDurationSeconds}s (${callDurationMinutes.toFixed(2)} min)`);

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

            io.to(`user:${consultation.user}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
            io.to(`user:${consultation.provider}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
            // Also emit to consultation room (mobile app joins this room)
            io.to(`consultation:${consultation._id}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
            io.to(`billing:${consultation._id}`).emit(
              "consultation:auto-terminated",
              terminationData
            );
            console.log(`📡 Auto-termination emitted to all rooms for ${consultation._id}`);
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
