const { createNotification } = require('./notifications');

/**
 * Send consultation-related notifications
 */
const notificationTemplates = {
  // Consultation notifications
  consultationStarted: async (userId, userType, consultationId, providerName, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Consultation Started',
      message: `Your consultation with ${providerName} has started`,
      type: 'consultation',
      data: { consultationId, action: 'started' },
      io
    });
  },

  consultationEnded: async (userId, userType, consultationId, duration, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Consultation Ended',
      message: `Your consultation has ended. Duration: ${duration} minutes`,
      type: 'consultation',
      data: { consultationId, duration, action: 'ended' },
      io
    });
  },

  incomingCall: async (userId, userType, callerName, callType, consultationId, io, options = {}) => {
    console.log(`📞 notificationTemplates.incomingCall called:`, {
      userId,
      userType,
      consultationId,
      callerName,
      callType,
      isConference: options?.isConference,
      from: options?.from,
    });

    const result = await createNotification({
      userId,
      userType,
      title: `Incoming ${callType} Call`,
      message: `${callerName} is calling you`,
      type: 'consultation',
      data: {
        // ── Fields checked by QuickChatFirebaseService.kt ──────────────────
        // The native service checks data["type"] == "consultation" AND
        // data["action"] == "incoming_call" to decide whether to handle the
        // message natively in background/killed state.
        type:           'consultation',
        action:         'incoming_call',

        // ── Caller identity — read by writePendingCallToStorage() ───────────
        // Native code reads data["from"] first, then falls back to data["callerId"].
        // Send BOTH so it works whether the native or JS path handles it.
        from:           options?.from ? String(options.from) : '',
        callerId:       options?.from ? String(options.from) : '',   // fallback alias

        // Recipient — who is receiving this call (the provider/user being called)
        to:             String(userId),
        recipientId:    String(userId),   // fallback alias

        // ── Call metadata ────────────────────────────────────────────────────
        consultationId: String(consultationId),
        callerName,
        fromName:       callerName,
        callType,
        isConference:   options?.isConference ? 'true' : 'false',

        // ── Android notification hints ───────────────────────────────────────
        // NOTE: this push is DATA-ONLY, so Android never reads channelId from
        // here — the native service picks the channel itself. Kept in sync with
        // IncomingCallNotificationModule.CHANNEL_ID to avoid confusion.
        sound:          'default',
        priority:       'high',
        channelId:      'incoming_calls_v2',
      },
      io,
    });

    console.log(`📞 notificationTemplates.incomingCall result:`, result ? 'Success' : 'Failed');
    return result;
  },

  /**
   * Missed call — sent to the person who did NOT answer, after the 60 s
   * no-answer timeout. Always routed through utils/missedCall.js so it is sent
   * exactly once per consultation.
   *
   * Unlike incomingCall this is a NORMAL notification (not data-only), so the OS
   * renders it in the tray by itself when the app is backgrounded or killed —
   * which is the whole point: the socket "call-timeout" event that used to be
   * the only signal reaches nobody in that state.
   *
   * Every data value must be a string: FCM rejects non-string data fields.
   */
  callMissed: async (userId, userType, consultationId, callerName, io, options = {}) => {
    const callType = options.callType || 'audio';
    const label = callType === 'video' ? 'video call' : 'call';

    return await createNotification({
      userId,
      userType,
      title: 'Missed Call',
      message: `You missed a ${label} from ${callerName}`,
      type: 'consultation',
      data: {
        type: 'consultation',
        action: 'missed_call',
        consultationId: String(consultationId),
        callerName: String(callerName || ''),
        fromName: String(callerName || ''),
        from: options.from ? String(options.from) : '',
        callerId: options.from ? String(options.from) : '',
        callType: String(callType),
        missedAt: new Date().toISOString(),
      },
      io
    });
  },

  // Wallet notifications
  walletCredited: async (userId, userType, amount, transactionId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Wallet Credited',
      message: `₹${amount} has been added to your wallet`,
      type: 'wallet',
      data: { amount, transactionId, action: 'credited' },
      io
    });
  },

  walletDebited: async (userId, userType, amount, transactionId, reason, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Wallet Debited',
      message: `₹${amount} has been deducted from your wallet for ${reason}`,
      type: 'wallet',
      data: { amount, transactionId, reason, action: 'debited' },
      io
    });
  },

  lowBalance: async (userId, userType, currentBalance, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Low Wallet Balance',
      message: `Your wallet balance is low (₹${currentBalance}). Please recharge to continue using services.`,
      type: 'wallet',
      data: { currentBalance, action: 'low_balance' },
      io
    });
  },

  withdrawalRequested: async (userId, userType, amount, withdrawalId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Withdrawal Requested',
      message: `Your withdrawal request of ₹${amount} has been submitted`,
      type: 'wallet',
      data: { amount, withdrawalId, action: 'withdrawal_requested' },
      io
    });
  },

  withdrawalApproved: async (userId, userType, amount, withdrawalId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Withdrawal Approved',
      message: `Your withdrawal of ₹${amount} has been approved and will be processed soon`,
      type: 'wallet',
      data: { amount, withdrawalId, action: 'withdrawal_approved' },
      io
    });
  },

  withdrawalRejected: async (userId, userType, amount, withdrawalId, reason, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Withdrawal Rejected',
      message: `Your withdrawal request of ₹${amount} was rejected. Reason: ${reason}`,
      type: 'wallet',
      data: { amount, withdrawalId, reason, action: 'withdrawal_rejected' },
      io
    });
  },

  // Payment notifications
  paymentSuccess: async (userId, userType, amount, orderId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Payment Successful',
      message: `Your payment of ₹${amount} was successful`,
      type: 'wallet',
      data: { amount, orderId, action: 'payment_success' },
      io
    });
  },

  paymentFailed: async (userId, userType, amount, orderId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Payment Failed',
      message: `Your payment of ₹${amount} failed. Please try again.`,
      type: 'wallet',
      data: { amount, orderId, action: 'payment_failed' },
      io
    });
  },

  // Admin notifications
  accountVerified: async (userId, userType, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Account Verified',
      message: 'Congratulations! Your account has been verified',
      type: 'admin',
      data: { action: 'account_verified' },
      io
    });
  },

  accountRejected: async (userId, userType, reason, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Account Verification Failed',
      message: `Your account verification was rejected. Reason: ${reason}`,
      type: 'admin',
      data: { reason, action: 'account_rejected' },
      io
    });
  },

  accountSuspended: async (userId, userType, reason, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Account Suspended',
      message: `Your account has been suspended. Reason: ${reason}`,
      type: 'admin',
      data: { reason, action: 'account_suspended' },
      io
    });
  },

  accountActivated: async (userId, userType, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Account Activated',
      message: 'Your account has been activated. You can now use all features.',
      type: 'admin',
      data: { action: 'account_activated' },
      io
    });
  },

  profileUpdated: async (userId, userType, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Profile Updated',
      message: 'Your profile has been updated successfully',
      type: 'system',
      data: { action: 'profile_updated' },
      io
    });
  },

  // Review notifications
  newReview: async (userId, userType, reviewerName, rating, consultationId, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'New Review Received',
      message: `${reviewerName} gave you ${rating} stars`,
      type: 'system',
      data: { reviewerName, rating, consultationId, action: 'new_review' },
      io
    });
  },

  // System notifications
  welcome: async (userId, userType, userName, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Welcome to QuickChat!',
      message: `Hi ${userName}, welcome to our platform. Start connecting with experts now!`,
      type: 'system',
      data: { action: 'welcome' },
      io
    });
  },

  maintenanceAlert: async (userId, userType, scheduledTime, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Scheduled Maintenance',
      message: `System maintenance scheduled at ${scheduledTime}. Services may be temporarily unavailable.`,
      type: 'system',
      data: { scheduledTime, action: 'maintenance_alert' },
      io
    });
  },

  // Custom notification
  custom: async (userId, userType, title, message, type = 'system', data = {}, io, options = {}) => {
    return await createNotification({
      userId,
      userType,
      title,
      message,
      type,
      data,
      saveToDatabase: options.saveToDatabase !== undefined ? options.saveToDatabase : true,
      io
    });
  }
};

module.exports = notificationTemplates;
