const { AppError } = require('../middlewares/errorHandler');
const { sendPushNotification, sendMulticastNotification, firebaseInitialized } = require('../utils/firebase');
const notificationTemplates = require('../utils/notificationTemplates');
const { User, Guest, Admin } = require('../models');

// @desc    Test Firebase notification setup
// @route   GET /api/notifications/test-firebase
// @access  Private
const testFirebaseSetup = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        firebaseInitialized,
        message: firebaseInitialized 
          ? 'Firebase is properly configured and ready to send notifications' 
          : 'Firebase is not initialized. Please check your configuration.'
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send test notification to current user
// @route   POST /api/notifications/test-send
// @access  Private
const sendTestNotification = async (req, res, next) => {
  try {
    if (!firebaseInitialized) {
      return next(new AppError('Firebase is not initialized', 500));
    }

    const { title, message, userType = 'user' } = req.body;
    const userId = req.user.id || req.user._id;

    // Get user's FCM tokens
    let targetUser;
    switch (userType) {
      case 'user':
        targetUser = await User.findById(userId).select('fcmTokens fullName');
        break;
      case 'guest':
        targetUser = await Guest.findById(userId).select('fcmTokens name');
        break;
      case 'admin':
        targetUser = await Admin.findById(userId).select('fcmTokens fullName');
        break;
      default:
        return next(new AppError('Invalid user type', 400));
    }

    if (!targetUser) {
      return next(new AppError('User not found', 404));
    }

    if (!targetUser.fcmTokens || targetUser.fcmTokens.length === 0) {
      return next(new AppError('No FCM tokens registered for this user. Please register an FCM token first.', 400));
    }

    // Send test notification
    const notificationData = {
      title: title || 'Test Notification',
      body: message || 'This is a test notification from QuickChat backend',
      token: targetUser.fcmTokens,
      data: {
        type: 'test',
        userType,
        timestamp: new Date().toISOString()
      }
    };

    let result;
    if (targetUser.fcmTokens.length === 1) {
      result = await sendPushNotification(notificationData);
    } else {
      result = await sendMulticastNotification(notificationData);
    }

    res.status(200).json({
      success: true,
      message: result ? 'Test notification sent successfully' : 'Failed to send notification',
      data: {
        userName: targetUser.fullName || targetUser.name,
        tokensCount: targetUser.fcmTokens.length,
        notificationSent: result
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send notification using template
// @route   POST /api/notifications/send-template
// @access  Private (Admin only)
const sendTemplateNotification = async (req, res, next) => {
  try {
    const { 
      template, 
      userId, 
      userType = 'user',
      ...templateParams 
    } = req.body;

    if (!template) {
      return next(new AppError('Template name is required', 400));
    }

    if (!userId) {
      return next(new AppError('User ID is required', 400));
    }

    // Check if template exists
    if (!notificationTemplates[template]) {
      return next(new AppError(`Template '${template}' not found`, 400));
    }

    // Get socket.io instance from app
    const io = req.app.get('io');

    // Send notification using template
    const notification = await notificationTemplates[template](
      userId,
      userType,
      ...Object.values(templateParams),
      io
    );

    res.status(200).json({
      success: true,
      message: 'Notification sent successfully',
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get available notification templates
// @route   GET /api/notifications/templates
// @access  Private (Admin only)
const getNotificationTemplates = async (req, res, next) => {
  try {
    const templates = Object.keys(notificationTemplates).map(key => ({
      name: key,
      description: `Template for ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`
    }));

    res.status(200).json({
      success: true,
      data: {
        count: templates.length,
        templates
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  testFirebaseSetup,
  sendTestNotification,
  sendTemplateNotification,
  getNotificationTemplates
};
