const { createNotification } = require('../utils/notifications');
const { User, Guest } = require('../models');

/**
 * Test endpoint to manually send a push notification
 * POST /api/test/send-notification
 * Body: { userId, userType, title, message }
 */
const testSendNotification = async (req, res) => {
  try {
    const { userId, userType = 'user', title, message } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'userId, title, and message are required'
      });
    }

    console.log('🧪 TEST: Sending notification:', { userId, userType, title, message });

    // Check if user exists and has FCM tokens
    let targetUser;
    if (userType === 'user') {
      targetUser = await User.findById(userId).select('fcmTokens fullName');
    } else if (userType === 'guest') {
      targetUser = await Guest.findById(userId).select('fcmTokens name');
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: `${userType} not found`
      });
    }

    console.log('🧪 TEST: User found:', {
      userId,
      name: targetUser.fullName || targetUser.name,
      hasFcmTokens: !!targetUser.fcmTokens,
      tokenCount: targetUser.fcmTokens?.length || 0
    });

    if (!targetUser.fcmTokens || targetUser.fcmTokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'User has no FCM tokens registered',
        hint: 'User needs to login on mobile/web to register FCM token'
      });
    }

    // Send notification
    const notification = await createNotification({
      userId,
      userType,
      title,
      message,
      type: 'system',
      data: { test: true },
      sendPush: true,
      io: req.app.get('io') // Get socket.io instance from app
    });

    res.status(200).json({
      success: true,
      message: 'Test notification sent',
      data: {
        notificationId: notification?._id,
        userId,
        userType,
        fcmTokenCount: targetUser.fcmTokens.length
      }
    });
  } catch (error) {
    console.error('🧪 TEST: Error sending notification:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Check user's FCM tokens
 * GET /api/test/check-fcm-tokens/:userId
 * Query: ?userType=user|guest
 */
const checkFCMTokens = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType = 'user' } = req.query;

    let targetUser;
    if (userType === 'user') {
      targetUser = await User.findById(userId).select('fcmTokens fullName email mobile');
    } else if (userType === 'guest') {
      targetUser = await Guest.findById(userId).select('fcmTokens name mobile');
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: `${userType} not found`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        userId,
        userType,
        name: targetUser.fullName || targetUser.name,
        mobile: targetUser.mobile,
        email: targetUser.email,
        hasFcmTokens: !!targetUser.fcmTokens,
        fcmTokenCount: targetUser.fcmTokens?.length || 0,
        fcmTokens: targetUser.fcmTokens || []
      }
    });
  } catch (error) {
    console.error('🧪 TEST: Error checking FCM tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Check Firebase initialization status
 * GET /api/test/firebase-status
 */
const checkFirebaseStatus = async (req, res) => {
  try {
    const { firebaseInitialized, admin } = require('../utils/firebase');

    res.status(200).json({
      success: true,
      data: {
        firebaseInitialized,
        hasAdminSDK: !!admin,
        projectId: admin?.app?.options?.projectId || 'Not available'
      }
    });
  } catch (error) {
    console.error('🧪 TEST: Error checking Firebase status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  testSendNotification,
  checkFCMTokens,
  checkFirebaseStatus
};
