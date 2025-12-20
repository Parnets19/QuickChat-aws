const { Notification } = require('../models');
const { sendPushNotification } = require('./firebase');

/**
 * Create and send a notification to a user
 * @param {Object} options - Notification options
 * @param {string} options.userId - User ID to send notification to
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {string} options.type - Notification type (consultation, wallet, subscription, admin, system)
 * @param {Object} options.data - Additional data for the notification
 * @param {boolean} options.sendPush - Whether to send push notification (default: true)
 * @param {Object} options.io - Socket.io instance for real-time notifications
 */
const createNotification = async (options) => {
  try {
    const {
      userId,
      title,
      message,
      type = 'system',
      data = {},
      sendPush = true,
      io
    } = options;

    // Create notification in database
    const notification = new Notification({
      user: userId,
      title,
      message,
      type,
      data,
      isRead: false
    });

    await notification.save();

    // Send real-time notification via socket if io instance is provided
    if (io) {
      io.to(`user:${userId}`).emit('notification:new', {
        _id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        data: notification.data,
        isRead: notification.isRead,
        createdAt: notification.createdAt
      });
    }

    // Send push notification if enabled
    if (sendPush) {
      try {
        const { firebaseInitialized } = require('./firebase');
        
        if (firebaseInitialized) {
          // Get user's FCM tokens (you'll need to implement this based on your User model)
          const User = require('../models/User.model');
          const user = await User.findById(userId).select('fcmTokens');
          
          if (user && user.fcmTokens && user.fcmTokens.length > 0) {
            await sendPushNotification({
              title,
              body: message,
              token: user.fcmTokens[0], // Send to first token, you can loop through all
              data: {
                type,
                notificationId: notification._id.toString(),
                ...data
              }
            });
          }
        } else {
          console.log('Firebase not initialized. Skipping push notification.');
        }
      } catch (pushError) {
        console.error('Error sending push notification:', pushError);
        // Don't throw error for push notification failures
      }
    }

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

/**
 * Send account verification notification
 */
const sendVerificationNotification = async (userId, status, notes = '', io = null) => {
  const isVerified = status === 'verified';
  
  const title = isVerified ? 'Account Verified!' : 'Account Verification Failed';
  const message = isVerified 
    ? 'Congratulations! Your account has been verified and you can now start providing consultations.'
    : `Your account verification was rejected. ${notes ? `Reason: ${notes}` : 'Please check your documents and try again.'}`;

  return await createNotification({
    userId,
    title,
    message,
    type: 'admin',
    data: {
      verificationStatus: status,
      notes: notes || ''
    },
    io
  });
};

/**
 * Send status change notification
 */
const sendStatusChangeNotification = async (userId, status, io = null) => {
  let title, message;
  
  switch (status) {
    case 'active':
      title = 'Account Activated';
      message = 'Your account has been activated. You can now use all features.';
      break;
    case 'suspended':
      title = 'Account Suspended';
      message = 'Your account has been suspended. Please contact support for more information.';
      break;
    case 'inactive':
      title = 'Account Deactivated';
      message = 'Your account has been deactivated. Please contact support if you believe this is an error.';
      break;
    default:
      title = 'Account Status Updated';
      message = `Your account status has been changed to ${status}.`;
  }

  return await createNotification({
    userId,
    title,
    message,
    type: 'admin',
    data: {
      statusChange: status
    },
    io
  });
};

/**
 * Send profile visibility change notification
 */
const sendProfileVisibilityNotification = async (userId, isHidden, io = null) => {
  const title = isHidden ? 'Profile Hidden' : 'Profile Visible';
  const message = isHidden 
    ? 'Your profile has been hidden from public view by an administrator.'
    : 'Your profile is now visible to users again.';

  return await createNotification({
    userId,
    title,
    message,
    type: 'admin',
    data: {
      profileVisibility: !isHidden
    },
    io
  });
};

module.exports = {
  createNotification,
  sendVerificationNotification,
  sendStatusChangeNotification,
  sendProfileVisibilityNotification
};