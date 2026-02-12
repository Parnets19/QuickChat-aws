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

  incomingCall: async (userId, userType, consultationId, callerName, callType, io) => {
    console.log(`📞 notificationTemplates.incomingCall called:`, {
      userId,
      userType,
      consultationId,
      callerName,
      callType
    });
    
    const result = await createNotification({
      userId,
      userType,
      title: `Incoming ${callType} Call`,
      message: `${callerName} is calling you`,
      type: 'consultation',
      data: { consultationId, callerName, callType, action: 'incoming_call' },
      io
    });
    
    console.log(`📞 notificationTemplates.incomingCall result:`, result ? 'Success' : 'Failed');
    return result;
  },

  callMissed: async (userId, userType, consultationId, callerName, io) => {
    return await createNotification({
      userId,
      userType,
      title: 'Missed Call',
      message: `You missed a call from ${callerName}`,
      type: 'consultation',
      data: { consultationId, callerName, action: 'missed_call' },
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
  custom: async (userId, userType, title, message, type = 'system', data = {}, io) => {
    return await createNotification({
      userId,
      userType,
      title,
      message,
      type,
      data,
      io
    });
  }
};

module.exports = notificationTemplates;
