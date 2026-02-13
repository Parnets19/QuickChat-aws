const { Notification, User, Guest, Admin } = require('../models');
const { sendPushNotification, sendMulticastNotification } = require('./firebase');

/**
 * Create and send a notification to a user, guest, or admin
 * @param {Object} options - Notification options
 * @param {string} options.userId - User/Guest/Admin ID to send notification to
 * @param {string} options.userType - Type of user: 'user', 'guest', or 'admin' (default: 'user')
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
      userType = 'user',
      title,
      message,
      type = 'system',
      data = {},
      sendPush = true,
      io
    } = options;

    console.log(`🔔 createNotification called:`, {
      userId,
      userType,
      title,
      message: message.substring(0, 50),
      type,
      sendPush
    });

    // Create notification in database (only for users, not guests/admins for now)
    let notification;
    if (userType === 'user') {
      notification = new Notification({
        user: userId,
        title,
        message,
        type,
        data,
        isRead: false
      });
      await notification.save();
      console.log(`💾 Notification saved to database:`, notification._id);
    }

    // Send real-time notification via socket if io instance is provided
    if (io) {
      const socketRoom = `${userType}:${userId}`;
      io.to(socketRoom).emit('notification:new', {
        _id: notification?._id,
        title,
        message,
        type,
        data,
        isRead: false,
        createdAt: new Date()
      });
      console.log(`📡 Real-time notification sent to socket room: ${socketRoom}`);
    }

    // Send push notification if enabled
    if (sendPush) {
      try {
        const { firebaseInitialized } = require('./firebase');
        
        console.log(`🔥 Firebase initialized:`, firebaseInitialized);
        
        if (!firebaseInitialized) {
          console.error('❌ Firebase not initialized - cannot send push notifications');
          console.error('❌ Check service_account.json or Firebase environment variables');
          return notification;
        }
        
        if (firebaseInitialized) {
          let targetUser;
          
          // Get FCM tokens based on user type
          console.log(`🔍 Looking up ${userType} with ID: ${userId}`);
          switch (userType) {
            case 'user':
              targetUser = await User.findById(userId).select('fcmTokens');
              break;
            case 'guest':
              targetUser = await Guest.findById(userId).select('fcmTokens');
              break;
            case 'admin':
              targetUser = await Admin.findById(userId).select('fcmTokens');
              break;
            default:
              console.warn(`❌ Unknown user type: ${userType}`);
              return notification;
          }
          
          if (!targetUser) {
            console.error(`❌ Target user not found: ${userId} (${userType})`);
            return notification;
          }
          
          console.log(`👤 Target user found:`, {
            userId,
            userType,
            hasFcmTokens: !!targetUser?.fcmTokens,
            tokenCount: targetUser?.fcmTokens?.length || 0,
            tokens: targetUser?.fcmTokens
          });
          
          if (!targetUser.fcmTokens || targetUser.fcmTokens.length === 0) {
            console.warn(`⚠️ No FCM tokens found for user ${userId} (${userType})`);
            console.warn(`⚠️ User needs to login and register FCM token`);
            return notification;
          }
          
          if (targetUser && targetUser.fcmTokens && targetUser.fcmTokens.length > 0) {
            console.log(`📤 Sending push notification to ${targetUser.fcmTokens.length} device(s)`);
            
            // Send to all registered devices
            if (targetUser.fcmTokens.length === 1) {
              try {
                const result = await sendPushNotification({
                  title,
                  body: message,
                  token: targetUser.fcmTokens[0],
                  data: {
                    type,
                    userType,
                    notificationId: notification?._id?.toString() || '',
                    ...data
                  }
                });
                console.log(`✅ Single push notification sent successfully:`, result);
              } catch (pushError) {
                console.error(`❌ Failed to send push notification:`, pushError);
                console.error(`❌ Token might be invalid:`, targetUser.fcmTokens[0].substring(0, 20) + '...');
              }
            } else {
              try {
                const result = await sendMulticastNotification({
                  title,
                  body: message,
                  token: targetUser.fcmTokens,
                  data: {
                    type,
                    userType,
                    notificationId: notification?._id?.toString() || '',
                    ...data
                  }
                });
                console.log(`✅ Multicast push notification sent:`, result);
              } catch (pushError) {
                console.error(`❌ Failed to send multicast notification:`, pushError);
              }
            }
          }
        }
      } catch (pushError) {
        console.error('❌ Error in push notification block:', pushError);
        console.error('❌ Stack trace:', pushError.stack);
        // Don't throw error for push notification failures
      }
    } else {
      console.log('⏭️  Push notification disabled (sendPush=false)');
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