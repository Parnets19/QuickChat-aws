const admin = require('firebase-admin');
const { logger } = require('./logger');
const path = require('path');
const fs = require('fs');

let firebaseInitialized = false;

// Initialize Firebase Admin only if credentials are provided
if (!admin.apps.length) {
  let firebaseConfig;
  
  // Try to load from service_account.json file first
  const serviceAccountPath = path.join(__dirname, '../../service_account.json');
  
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = require(serviceAccountPath);
      firebaseConfig = {
        credential: admin.credential.cert(serviceAccount)
      };
      logger.info('Firebase initialized using service_account.json file');
    } catch (error) {
      logger.error('Error loading service_account.json:', error.message);
    }
  }
  
  // Fallback to environment variables if file not found or failed
  if (!firebaseConfig) {
    const envConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    // Check if all required Firebase credentials are provided
    if (envConfig.projectId && envConfig.privateKey && envConfig.clientEmail) {
      firebaseConfig = {
        credential: admin.credential.cert(envConfig)
      };
      logger.info('Firebase initialized using environment variables');
    } else {
      logger.warn('Firebase credentials not found. Push notification functionality will be disabled.');
    }
  }

  // Initialize Firebase if config is available
  if (firebaseConfig) {
    try {
      admin.initializeApp(firebaseConfig);
      firebaseInitialized = true;
      logger.info('Firebase Admin initialized successfully');
    } catch (error) {
      logger.error('Firebase initialization error:', error.message);
      firebaseInitialized = false;
    }
  }
}

const sendPushNotification = async (notification) => {
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase not initialized. Skipping push notification.');
    return { success: false, error: 'Firebase not initialized' };
  }

  try {
    console.log('📤 Preparing to send push notification:', {
      title: notification.title,
      body: notification.body?.substring(0, 50),
      hasToken: !!notification.token,
      tokenPreview: notification.token ? notification.token.substring(0, 20) + '...' : 'none',
      dataKeys: Object.keys(notification.data || {})
    });

    // CRITICAL FIX: Send data-only message for better foreground handling
    // Include title and body in data payload so app can display custom notification
    const message = {
      data: {
        title: notification.title,
        body: notification.body,
        ...(notification.data || {}),
      },
      token: Array.isArray(notification.token) ? notification.token[0] : notification.token,
    };

    // Add Android-specific configuration
    message.android = {
      priority: 'high',
    };

    // For incoming calls, add notification payload for background/killed app state
    if (notification.data?.action === 'incoming_call') {
      message.notification = {
        title: notification.title,
        body: notification.body,
      };
      
      message.android.notification = {
        channelId: 'incoming_calls',
        sound: 'default',
        priority: 'high',
        defaultSound: true,
        defaultVibrateTimings: true,
        tag: notification.data.consultationId,
      };
      
      // Add APNS configuration for iOS
      message.apns = {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      };
      
      console.log('📞 Incoming call notification configured with high priority');
    } else {
      // For other notifications, add notification payload for background
      message.notification = {
        title: notification.title,
        body: notification.body,
      };
    }

    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Push notification error:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    
    // Log specific error types
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.error('❌ Invalid or expired FCM token - user needs to re-register');
    }
    
    return { success: false, error: error.message };
  }
};

const sendMulticastNotification = async (notification) => {
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase not initialized. Skipping multicast notification.');
    return { success: false, error: 'Firebase not initialized' };
  }

  try {
    if (!Array.isArray(notification.token)) {
      notification.token = [notification.token];
    }

    console.log('📤 Preparing to send multicast notification:', {
      title: notification.title,
      body: notification.body?.substring(0, 50),
      tokenCount: notification.token.length,
      dataKeys: Object.keys(notification.data || {})
    });

    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      tokens: notification.token,
    };

    // Add Android-specific configuration for incoming calls
    if (notification.data?.action === 'incoming_call') {
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'incoming_calls',
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          tag: notification.data.consultationId, // Group notifications by consultation
        },
      };
      
      // Add APNS configuration for iOS
      message.apns = {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      };
      
      console.log('📞 Multicast incoming call notification configured with high priority');
    }

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ Multicast notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
    
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`❌ Failed to send to token ${idx}:`, resp.error?.message);
        }
      });
    }
    
    return { 
      success: true, 
      successCount: response.successCount, 
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('❌ Multicast notification error:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  admin: firebaseInitialized ? admin : null,
  sendPushNotification,
  sendMulticastNotification,
  firebaseInitialized,
};

