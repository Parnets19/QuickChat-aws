const { Consultation, User, Guest, Transaction } = require('../models');
const { logger } = require('../utils/logger');

// Get Socket.IO instance (will be set by server.js)
let io = null;
const setSocketIO = (socketInstance) => {
  io = socketInstance;
};

// Helper function to emit billing updates
const emitBillingUpdate = (consultationId, data) => {
  if (io) {
    io.to(`billing:${consultationId}`).emit('billing:update', data);
    console.log('📡 SOCKET: Billing update emitted:', data);
  }
};

// Helper function to emit auto-termination
const emitAutoTermination = (consultationId, data) => {
  if (io) {
    io.to(`billing:${consultationId}`).emit('billing:terminated', data);
    io.to(`consultation:${consultationId}`).emit('consultation:auto-terminated', data);
    console.log('📡 SOCKET: Auto-termination emitted:', data);
  }
};

// Platform commission rate (5%)
const PLATFORM_COMMISSION_RATE = 0.05;
const PROVIDER_SHARE_RATE = 0.95;

/**
 * Check if user can afford consultation
 */
const checkConsultationAffordability = async (req, res) => {
  try {
    const { providerId, consultationType } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log('💰 AFFORDABILITY CHECK:', {
      userId,
      providerId,
      consultationType,
      isGuest
    });

    // Get user/guest wallet balance
    let userWallet = 0;
    if (isGuest) {
      const guest = await Guest.findById(userId).select('wallet');
      userWallet = guest?.wallet || 0;
    } else {
      const user = await User.findById(userId).select('wallet');
      userWallet = user?.wallet || 0;
    }

    // Get provider rates
    const provider = await User.findById(providerId).select('rates');
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    const ratePerMinute = provider.rates?.[consultationType] || provider.rates?.audioVideo || 0;
    
    // Calculate maximum talk time
    const maxTalkTimeMinutes = ratePerMinute > 0 ? Math.floor(userWallet / ratePerMinute) : 0;
    const canAfford = maxTalkTimeMinutes >= 1; // At least 1 minute required

    console.log('💰 AFFORDABILITY RESULT:', {
      userWallet,
      ratePerMinute,
      maxTalkTimeMinutes,
      canAfford
    });

    res.json({
      success: true,
      data: {
        canAfford,
        userWallet,
        ratePerMinute,
        maxTalkTimeMinutes,
        minimumRequired: ratePerMinute,
        message: canAfford 
          ? `You can talk for up to ${maxTalkTimeMinutes} minutes`
          : `You need at least ₹${ratePerMinute} for 1 minute consultation`
      }
    });

  } catch (error) {
    logger.error('Error checking consultation affordability:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Start consultation with real-time billing
 */
const startConsultation = async (req, res) => {
  try {
    const { providerId, consultationType } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log('🚀 START CONSULTATION API CALLED:', {
      userId,
      providerId,
      consultationType,
      isGuest,
      timestamp: new Date().toISOString(),
      requestBody: req.body
    });

    // Check affordability first - inline implementation
    let userWallet = 0;
    if (isGuest) {
      const guest = await Guest.findById(userId).select('wallet');
      userWallet = guest?.wallet || 0;
      console.log('👤 GUEST USER WALLET:', userWallet);
    } else {
      const user = await User.findById(userId).select('wallet');
      userWallet = user?.wallet || 0;
      console.log('👤 REGULAR USER WALLET:', userWallet);
    }

    // Get provider rates for affordability check
    const provider = await User.findById(providerId).select('rates fullName');
    const ratePerMinute = provider.rates?.[consultationType] || provider.rates?.audioVideo || 0;
    
    console.log('💰 AFFORDABILITY CHECK:', {
      userWallet,
      ratePerMinute,
      canAfford: userWallet >= ratePerMinute,
      providerName: provider.fullName
    });
    
    if (userWallet < ratePerMinute) {
      console.log('❌ INSUFFICIENT FUNDS - CONSULTATION REJECTED');
      return res.status(400).json({ 
        message: `Insufficient wallet balance. You need at least ₹${ratePerMinute} for 1 minute consultation. Current balance: ₹${userWallet}` 
      });
    }

    // Provider already fetched above for affordability check

    // Create consultation record (billing will start when both sides accept)
    const consultation = new Consultation({
      user: userId,
      userType: isGuest ? 'Guest' : 'User',
      provider: providerId,
      type: consultationType,
      status: 'ongoing',
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
      bothSidesAcceptedAt: null
    });

    await consultation.save();

    // Send ring notification for audio/video calls
    if (consultationType === 'audio' || consultationType === 'video') {
      if (io) {
        // Get user info for notification
        let clientName = 'Guest User';
        let clientPhoto = null;
        
        if (!isGuest) {
          const user = await User.findById(userId).select('fullName profilePhoto');
          if (user) {
            clientName = user.fullName;
            clientPhoto = user.profilePhoto;
          }
        } else {
          clientName = req.user.fullName || req.user.name || 'Guest User';
        }

        // Send ring notification to all provider's connected sockets
        // SINGLE SOURCE: Only real-time billing controller sends notifications
        io.to(`user:${providerId}`).emit('consultation:incoming-call', {
          consultationId: consultation._id,
          type: consultationType,
          clientName: clientName,
          clientPhoto: clientPhoto,
          clientId: userId,
          amount: ratePerMinute,
          timestamp: new Date(),
          source: 'real-time-billing' // Add source identifier to prevent duplicates
        });
        
        console.log(`🔔 SINGLE SOURCE: Ring notification sent to provider ${providerId} for ${consultationType} consultation`);
      } else {
        console.log('⚠️ Socket.IO not available for ring notification');
      }
    }

    // Set auto-cancellation timer (1 minute)
    setTimeout(async () => {
      try {
        // Check if consultation still exists and provider hasn't accepted
        const currentConsultation = await Consultation.findById(consultation._id);
        
        if (currentConsultation && 
            currentConsultation.status === 'ongoing' && 
            !currentConsultation.providerAccepted) {
          
          console.log(`⏰ AUTO-CANCELLING consultation ${consultation._id} - provider didn't answer within 1 minute`);
          
          // Mark consultation as no_answer (provider didn't pick up)
          currentConsultation.status = 'no_answer';
          currentConsultation.endTime = new Date();
          currentConsultation.endReason = 'system_error'; // Closest available enum value
          currentConsultation.duration = 0;
          currentConsultation.totalAmount = 0;
          await currentConsultation.save();

          // Notify both sides via Socket.IO
          if (io) {
            // Notify client
            io.to(`user:${userId}`).emit('consultation:auto-cancelled', {
              consultationId: consultation._id,
              reason: 'no_answer',
              message: 'Call cancelled - Provider did not answer within 1 minute',
              timestamp: new Date()
            });

            // Notify provider (clear incoming call notification)
            io.to(`user:${providerId}`).emit('consultation:cancelled', {
              consultationId: consultation._id,
              reason: 'auto_timeout',
              message: 'Incoming call timed out',
              timestamp: new Date()
            });

            console.log(`📢 Auto-cancellation notifications sent to both parties`);
          }
        }
      } catch (error) {
        console.error('❌ Error in auto-cancellation timer:', error);
      }
    }, 60000); // 60 seconds = 1 minute

    console.log('✅ CONSULTATION STARTED SUCCESSFULLY:', {
      consultationId: consultation._id,
      ratePerMinute,
      startTime: consultation.startTime,
      clientId: userId,
      providerId,
      consultationType
    });

    res.json({
      success: true,
      data: {
        consultationId: consultation._id,
        ratePerMinute,
        providerName: provider.fullName,
        startTime: consultation.startTime,
        message: 'Consultation started successfully'
      }
    });

  } catch (error) {
    console.error('❌ START CONSULTATION ERROR:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id || req.user?._id,
      requestBody: req.body
    });
    logger.error('Error starting consultation:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Provider accepts the call - this is when billing starts
 */
const acceptCall = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;

    console.log('📞 PROVIDER ACCEPTING CALL:', {
      consultationId,
      providerId: userId
    });

    // Get consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ message: 'Consultation not found' });
    }

    // Check if user is the provider
    if (consultation.provider.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Only the provider can accept this call' });
    }

    // Check if consultation is still ongoing and not already accepted by provider
    if (consultation.status !== 'ongoing') {
      return res.status(400).json({ message: 'Consultation is not in ongoing state' });
    }

    if (consultation.providerAccepted) {
      return res.status(400).json({ message: 'Provider has already accepted this call' });
    }

    // Mark provider as accepted
    consultation.providerAccepted = true;
    consultation.providerAcceptedAt = new Date();

    // Check if both sides have now accepted
    if (consultation.clientAccepted && consultation.providerAccepted) {
      // Both sides accepted - START BILLING NOW
      const now = new Date();
      consultation.bothSidesAcceptedAt = now;
      consultation.startTime = now;
      consultation.billingStarted = true;
      consultation.lastBillingTime = now;

      console.log('🎉 BOTH SIDES ACCEPTED - BILLING STARTED:', {
        consultationId,
        startTime: now,
        clientAcceptedAt: consultation.clientAcceptedAt,
        providerAcceptedAt: consultation.providerAcceptedAt
      });

      // Notify both sides that billing has started
      if (io) {
        const billingStartData = {
          consultationId: consultation._id,
          startTime: now,
          message: 'Billing started - both sides connected',
          timestamp: now
        };

        // Notify client
        io.to(`user:${consultation.user}`).emit('billing:started', billingStartData);
        // Notify provider
        io.to(`user:${consultation.provider}`).emit('billing:started', billingStartData);
        
        console.log('📢 Billing started notifications sent to both parties');
      }
    }

    await consultation.save();

    res.json({
      success: true,
      data: {
        consultationId: consultation._id,
        bothSidesAccepted: consultation.clientAccepted && consultation.providerAccepted,
        billingStarted: consultation.billingStarted,
        startTime: consultation.startTime,
        message: consultation.billingStarted 
          ? 'Call accepted! Billing has started.' 
          : 'Call accepted! Waiting for client to join.'
      }
    });

  } catch (error) {
    logger.error('Error accepting call:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Process real-time billing (called every minute)
 */
const processRealTimeBilling = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log('⏰ PROCESSING BILLING:', {
      consultationId,
      userId,
      isGuest
    });

    // Get consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      console.log('❌ CONSULTATION NOT FOUND:', consultationId);
      return res.status(404).json({ message: 'Consultation not found' });
    }

    console.log('📋 CONSULTATION FOUND:', {
      id: consultation._id,
      user: consultation.user,
      provider: consultation.provider,
      status: consultation.status
    });

    // Check if user is authorized to process billing for this consultation
    // Allow both client and provider to call this endpoint
    const consultationUserId = consultation.user.toString();
    const consultationProviderId = consultation.provider.toString();
    const requestingUserId = userId.toString();
    
    const isClient = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === requestingUserId;
    
    console.log('🔐 BILLING AUTH CHECK:', {
      consultationUserId,
      consultationProviderId,
      requestingUserId,
      isClient,
      isProvider
    });
    
    if (!isClient && !isProvider) {
      return res.status(403).json({ message: 'Unauthorized - you are not part of this consultation' });
    }

    // Only the client should be charged, regardless of who calls the endpoint
    if (!isClient) {
      // If provider is calling, just return success without processing billing
      return res.json({
        success: true,
        message: 'Provider view - billing processed by client',
        data: {
          duration: consultation.duration || 0,
          totalAmount: consultation.totalAmount || 0,
          canContinue: true // Provider doesn't need to worry about wallet balance
        }
      });
    }

    // Check if consultation is still ongoing
    if (consultation.status !== 'ongoing') {
      return res.status(400).json({ message: 'Consultation is not ongoing' });
    }

    // Check if billing has started (both sides must have accepted)
    if (!consultation.billingStarted) {
      return res.json({
        success: true,
        billingNotStarted: true,
        message: 'Billing has not started yet. Waiting for both sides to accept the call.',
        data: {
          clientAccepted: consultation.clientAccepted,
          providerAccepted: consultation.providerAccepted,
          bothSidesAccepted: consultation.clientAccepted && consultation.providerAccepted
        }
      });
    }

    // Get user/guest wallet balance
    let userModel, userWallet;
    if (isGuest) {
      userModel = await Guest.findById(userId);
      userWallet = userModel?.wallet || 0;
    } else {
      userModel = await User.findById(userId);
      userWallet = userModel?.wallet || 0;
    }

    const ratePerMinute = consultation.rate;

    // Check if user can afford another minute
    if (userWallet < ratePerMinute) {
      // Insufficient funds - end consultation
      await endConsultationDueToInsufficientFunds(consultationId);
      
      // Emit auto-termination event
      emitAutoTermination(consultationId, {
        reason: 'insufficient_funds',
        message: 'Call ended - insufficient wallet balance',
        finalAmount: consultation.totalAmount,
        duration: Math.ceil((new Date() - consultation.startTime) / (1000 * 60))
      });
      
      return res.json({
        success: false,
        insufficientFunds: true,
        message: 'Consultation ended due to insufficient funds',
        data: {
          consultationEnded: true,
          reason: 'insufficient_funds'
        }
      });
    }

    // Deduct money from user wallet
    userModel.wallet -= ratePerMinute;
    // Update totalSpent for both regular users and guest users
    userModel.totalSpent = (userModel.totalSpent || 0) + ratePerMinute;
    await userModel.save();

    // Calculate platform commission and provider earnings
    // Use proper decimal calculation to avoid rounding issues
    const platformCommission = Math.round(ratePerMinute * PLATFORM_COMMISSION_RATE * 100) / 100; // Round to 2 decimal places
    const providerEarnings = Math.round((ratePerMinute - platformCommission) * 100) / 100; // Round to 2 decimal places
    
    console.log('💰 COMMISSION CALCULATION:', {
      ratePerMinute,
      platformCommissionRate: PLATFORM_COMMISSION_RATE,
      platformCommission,
      providerEarnings,
      total: platformCommission + providerEarnings
    });

    // Add earnings to provider
    const provider = await User.findById(consultation.provider);
    provider.earnings = (provider.earnings || 0) + providerEarnings;
    provider.wallet = (provider.wallet || 0) + providerEarnings;
    await provider.save();

    // Update consultation
    const currentTime = new Date();
    const elapsedMinutes = Math.ceil((currentTime - consultation.startTime) / (1000 * 60));
    
    consultation.duration = elapsedMinutes;
    consultation.totalAmount = (consultation.totalAmount || 0) + ratePerMinute;
    consultation.lastBillingTime = currentTime;
    await consultation.save();

    // Create transaction records
    await createBillingTransactions(consultation, userModel, provider, ratePerMinute, platformCommission, providerEarnings, isGuest);

    console.log('💰 BILLING PROCESSED:', {
      consultationId,
      ratePerMinute,
      platformCommission,
      providerEarnings,
      newUserWallet: userModel.wallet,
      newProviderWallet: provider.wallet,
      totalConsultationAmount: consultation.totalAmount,
      duration: consultation.duration
    });

    // Emit real-time billing update
    emitBillingUpdate(consultationId, {
      userBalance: userModel.wallet,
      totalCharged: consultation.totalAmount,
      minutesBilled: consultation.duration,
      platformCommission: Math.round(consultation.totalAmount * PLATFORM_COMMISSION_RATE),
      providerEarning: consultation.totalAmount - Math.round(consultation.totalAmount * PLATFORM_COMMISSION_RATE),
      canContinue: userModel.wallet >= ratePerMinute,
      nextChargeIn: 60,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: {
        charged: ratePerMinute,
        remainingBalance: userModel.wallet,
        canContinue: userModel.wallet >= ratePerMinute,
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        nextChargeIn: 60 // seconds
      }
    });

  } catch (error) {
    logger.error('Error processing real-time billing:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * End consultation manually
 */
const endConsultation = async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;

    console.log('🛑 ENDING CONSULTATION:', {
      consultationId,
      userId
    });

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ message: 'Consultation not found' });
    }

    // Check if user is authorized to end this consultation
    if (consultation.user.toString() !== userId && consultation.provider.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // End the consultation
    consultation.status = 'completed';
    consultation.endTime = new Date();
    
    // Calculate final duration and amount based on BILLING time, not consultation creation time
    let finalDuration = 0;
    let finalAmount = 0;
    
    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      // Calculate duration from when billing actually started (both sides accepted)
      finalDuration = Math.ceil((consultation.endTime - consultation.bothSidesAcceptedAt) / (1000 * 60));
      finalAmount = finalDuration * consultation.rate;
      
      console.log('💰 BILLING DURATION CALCULATION:', {
        bothSidesAcceptedAt: consultation.bothSidesAcceptedAt,
        endTime: consultation.endTime,
        actualTalkTime: finalDuration,
        rate: consultation.rate,
        calculatedAmount: finalAmount
      });
    } else {
      console.log('⚠️ No billing occurred - consultation ended before both sides accepted');
    }
    
    consultation.duration = finalDuration;
    consultation.totalAmount = finalAmount;

    // Process final billing if there's an amount to charge
    if (finalAmount > 0) {
      console.log('💰 PROCESSING FINAL BILLING:', {
        duration: finalDuration,
        rate: consultation.rate,
        totalAmount: finalAmount
      });

      // Get user and provider models
      const isGuest = consultation.userType === 'Guest';
      const UserModel = isGuest ? Guest : User;
      const user = await UserModel.findById(consultation.user);
      const provider = await User.findById(consultation.provider);

      if (!user || !provider) {
        return res.status(404).json({ message: 'User or provider not found' });
      }

      // Calculate commission split with proper decimal handling
      const platformCommission = Math.round(finalAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
      const providerEarnings = Math.round(finalAmount * PROVIDER_SHARE_RATE * 100) / 100;
      
      console.log('💰 FINAL COMMISSION CALCULATION:', {
        finalAmount,
        platformCommissionRate: PLATFORM_COMMISSION_RATE,
        providerShareRate: PROVIDER_SHARE_RATE,
        platformCommission,
        providerEarnings,
        total: platformCommission + providerEarnings
      });

      // Deduct total amount from user wallet
      if (user.wallet >= finalAmount) {
        user.wallet -= finalAmount;
        await user.save();
        console.log('💸 DEDUCTED FROM CLIENT:', {
          userId: user._id,
          amount: finalAmount,
          newBalance: user.wallet
        });
      } else {
        console.log('⚠️ INSUFFICIENT FUNDS FOR FINAL BILLING:', {
          required: finalAmount,
          available: user.wallet
        });
      }

      // Add earnings to provider
      provider.wallet += providerEarnings;
      provider.earnings = (provider.earnings || 0) + providerEarnings;
      await provider.save();
      console.log('💰 CREDITED TO PROVIDER:', {
        providerId: provider._id,
        earnings: providerEarnings,
        newWallet: provider.wallet,
        newEarnings: provider.earnings
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
    }
    
    await consultation.save();

    console.log('✅ CONSULTATION ENDED:', {
      consultationId,
      finalDuration,
      totalAmount: consultation.totalAmount,
      endTime: consultation.endTime
    });

    res.json({
      success: true,
      data: {
        consultationId,
        duration: consultation.duration,
        totalAmount: consultation.totalAmount,
        endTime: consultation.endTime,
        message: 'Consultation ended successfully'
      }
    });

  } catch (error) {
    logger.error('Error ending consultation:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * End consultation due to insufficient funds
 */
const endConsultationDueToInsufficientFunds = async (consultationId) => {
  try {
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) return;

    consultation.status = 'completed';
    consultation.endTime = new Date();
    consultation.endReason = 'insufficient_funds';
    
    // Calculate final duration based on billing time, not consultation creation time
    let finalDuration = 0;
    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      finalDuration = Math.ceil((consultation.endTime - consultation.bothSidesAcceptedAt) / (1000 * 60));
    }
    consultation.duration = finalDuration;
    
    await consultation.save();

    console.log('💸 CONSULTATION ENDED - INSUFFICIENT FUNDS:', {
      consultationId,
      finalDuration,
      totalAmount: consultation.totalAmount
    });

  } catch (error) {
    logger.error('Error ending consultation due to insufficient funds:', error);
  }
};

/**
 * Create billing transaction records
 */
const createBillingTransactions = async (consultation, user, provider, amount, platformCommission, providerEarnings, isGuest) => {
  try {
    const timestamp = new Date();

    // User payment transaction
    const userTransaction = new Transaction({
      user: user._id,
      userType: isGuest ? 'Guest' : 'User',
      type: 'consultation_payment',
      category: 'consultation',
      amount: amount,
      balance: user.wallet,
      description: `Consultation payment - ${consultation.type} with ${provider.fullName}`,
      status: 'completed',
      consultationId: consultation._id,
      transactionId: `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        providerId: provider._id,
        ratePerMinute: consultation.rate,
        billingMinute: Math.ceil((timestamp - consultation.startTime) / (1000 * 60))
      }
    });

    // Provider earning transaction
    const providerTransaction = new Transaction({
      user: provider._id,
      userType: 'User',
      type: 'earning',
      category: 'consultation',
      amount: providerEarnings,
      balance: provider.wallet,
      description: `Consultation earning - ${consultation.type} consultation`,
      status: 'completed',
      consultationId: consultation._id,
      transactionId: `EARN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        clientId: user._id,
        clientType: isGuest ? 'Guest' : 'User',
        ratePerMinute: consultation.rate,
        platformCommission,
        grossAmount: amount,
        netAmount: providerEarnings
      }
    });

    // Note: Platform commission is tracked in provider transaction metadata
    // No separate platform transaction needed as it would require different schema

    await Promise.all([
      userTransaction.save(),
      providerTransaction.save()
    ]);

    console.log('📝 BILLING TRANSACTIONS CREATED:', {
      userPayment: amount,
      providerEarning: providerEarnings,
      platformCommission
    });

  } catch (error) {
    logger.error('Error creating billing transactions:', error);
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
      .populate('provider', 'fullName profilePhoto rates')
      .populate('user', 'fullName profilePhoto');

    if (!consultation) {
      return res.status(404).json({ message: 'Consultation not found' });
    }

    // Check authorization (handle both string and ObjectId formats for user field)
    const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user?._id?.toString();
    const consultationProviderId = consultation.provider?._id?.toString();
    const requestingUserId = req.user?.isGuest ? req.user.id : req.user?._id?.toString();
    
    const isUser = consultationUserId === requestingUserId;
    const isProvider = consultationProviderId === requestingUserId;
    
    if (!isUser && !isProvider) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    res.json({
      success: true,
      data: consultation
    });

  } catch (error) {
    logger.error('Error getting consultation status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Check for ongoing consultations
 */
const checkOngoingConsultations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log('🔍 CHECKING ONGOING CONSULTATIONS:', {
      userId,
      isGuest
    });

    // Find ongoing consultations where user is either client or provider
    const ongoingConsultations = await Consultation.find({
      $or: [
        { user: userId, status: 'ongoing' },
        { provider: userId, status: 'ongoing' }
      ]
    }).populate('provider', 'fullName')
      .populate('user', 'fullName');

    console.log('📋 ONGOING CONSULTATIONS FOUND:', ongoingConsultations.length);

    res.json({
      success: true,
      data: ongoingConsultations,
      hasOngoing: ongoingConsultations.length > 0
    });

  } catch (error) {
    logger.error('Error checking ongoing consultations:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  checkConsultationAffordability,
  startConsultation,
  acceptCall,
  processRealTimeBilling,
  endConsultation,
  getConsultationStatus,
  checkOngoingConsultations,
  setSocketIO
};