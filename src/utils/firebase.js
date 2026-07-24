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

  // FCM data payload requires ALL values to be strings
  const stringifyData = (data = {}) =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

  try {
    console.log('📤 Preparing to send push notification:', {
      title: notification.title,
      body: notification.body?.substring(0, 50),
      hasToken: !!notification.token,
      tokenPreview: notification.token ? notification.token.substring(0, 20) + '...' : 'none',
      dataKeys: Object.keys(notification.data || {})
    });

    // CRITICAL: Send BOTH notification and data payloads for maximum compatibility
    // EXCEPTION: chat messages are data-only so Android doesn't show a system notification
    // in foreground — the JS onMessage handler shows our custom in-app banner instead.
    const isChatMessage = notification.data?.action === 'new_message';

    const message = {
      // Only include notification payload for non-chat messages
      // (chat: data-only → no system banner in foreground; background/killed still shows via data)
      ...(isChatMessage ? {} : {
        notification: {
          title: notification.title,
          body: notification.body,
        },
      }),
      data: {
        title: String(notification.title || ''),
        body: String(notification.body || ''),
        ...stringifyData(notification.data),
      },
      token: Array.isArray(notification.token) ? notification.token[0] : notification.token,
    };

    // Add Android-specific configuration
    message.android = {
      priority: 'high',
    };

    // For incoming calls, add special configuration
    if (notification.data?.action === 'incoming_call') {
      // Use 'default' channel as primary — it always exists on Android.
      // 'incoming_calls' channel (IMPORTANCE_HIGH) is created in MainActivity.kt
      // and will be used automatically once the app is rebuilt.
      message.android = {
        priority: 'high',
        ttl: 30 * 1000, // 30 seconds — call expires quickly
        notification: {
          // 'default' channel always exists; 'incoming_calls' needs a rebuild to exist
          channelId: 'default',
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          tag: notification.data.consultationId,
          visibility: 'public',
          notificationCount: 1,
        },
      };
      
      // Add APNS configuration for iOS
      message.apns = {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
            alert: {
              title: notification.title,
              body: notification.body,
            },
          },
        },
      };
      
      console.log('📞 Incoming call notification configured with high priority (channel: default)');
    } else if (notification.data?.action === 'new_message') {
      // Data-only for chat messages — no system notification banner in foreground
      // JS onMessage handler shows in-app banner instead
      message.android = {
        priority: 'high',
      };
      console.log('💬 Chat message configured (data-only)');
    } else {
      // For other notifications (including live-stream) — show full body text in expanded view
      message.android.notification = {
        channelId: 'default',
        sound: 'default',
        priority: 'high',
        // Android BigTextStyle: shows full message when notification is expanded
        body: notification.body,
      };
      
      // Add APNS configuration for iOS
      message.apns = {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            alert: {
              title: notification.title,
              body: notification.body,
            },
          },
        },
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
      console.error('❌ Invalid or expired FCM token - removing from DB');
      // Clean up the single invalid token
      try {
        const tokenToRemove = Array.isArray(notification.token) ? notification.token[0] : notification.token;
        if (tokenToRemove) {
          const User = require('../models/User.model');
          const Guest = require('../models/Guest.model');
          await Promise.all([
            User.updateMany({ fcmTokens: tokenToRemove }, { $pull: { fcmTokens: tokenToRemove } }),
            Guest.updateMany({ fcmTokens: tokenToRemove }, { $pull: { fcmTokens: tokenToRemove } }),
          ]);
          console.log('🧹 Removed stale single FCM token from DB');
        }
      } catch (cleanupErr) {
        console.error('⚠️ Failed to clean up invalid token:', cleanupErr.message);
      }
    }
    
    return { success: false, error: error.message };
  }
};

const sendMulticastNotification = async (notification) => {
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase not initialized. Skipping multicast notification.');
    return { success: false, error: 'Firebase not initialized' };
  }

  // FCM data payload requires ALL values to be strings
  const stringifyData = (data = {}) =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

  try {
    if (!Array.isArray(notification.token)) {
      notification.token = [notification.token];
    }

    // Filter out empty/null tokens upfront
    const validTokens = notification.token.filter(t => t && typeof t === 'string' && t.length > 10);
    if (validTokens.length === 0) {
      console.warn('⚠️ No valid tokens to send multicast notification');
      return { success: false, error: 'No valid tokens' };
    }

    console.log('📤 Preparing to send multicast notification:', {
      title: notification.title,
      body: notification.body?.substring(0, 50),
      tokenCount: validTokens.length,
      dataKeys: Object.keys(notification.data || {})
    });

    const isChatMessage = notification.data?.action === 'new_message';

    const message = {
      ...(isChatMessage ? {} : {
        notification: {
          title: notification.title,
          body: notification.body,
        },
      }),
      data: {
        title: String(notification.title || ''),
        body: String(notification.body || ''),
        ...stringifyData(notification.data),
      },
      tokens: validTokens,
    };

    // Add Android-specific configuration for incoming calls
    if (notification.data?.action === 'incoming_call') {
      message.android = {
        priority: 'high',
        ttl: 30 * 1000,
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          tag: notification.data.consultationId,
          visibility: 'public',
        },
      };
      message.apns = {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
            alert: {
              title: notification.title,
              body: notification.body,
            },
          },
        },
      };
      console.log('📞 Multicast incoming call notification configured with high priority (channel: default)');
    } else if (notification.data?.action === 'new_message') {
      // Data-only for chat messages — no system notification banner in foreground
      // Backend JS onMessage handler shows in-app banner instead
      message.android = {
        priority: 'high',
      };
      console.log('💬 Multicast chat message configured (data-only)');
    } else {
      // For broadcast/general notifications (including live-stream) — show full body in expanded view
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high',
          body: notification.body, // Full body for BigTextStyle
        },
      };
      // Add APNS configuration for iOS
      message.apns = {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            alert: {
              title: notification.title,
              body: notification.body,
            },
          },
        },
      };
    }

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ Multicast notifications sent: ${response.successCount} success, ${response.failureCount} failed`);

    // ── Auto-clean invalid tokens from DB ────────────────────────────────────
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || '';
          const isInvalid =
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/registration-token-not-registered' ||
            errCode === 'messaging/invalid-argument';
          if (isInvalid) {
            invalidTokens.push(validTokens[idx]);
          } else {
            console.error(`❌ Failed to send to token[${idx}]:`, resp.error?.message);
          }
        }
      });

      if (invalidTokens.length > 0) {
        console.log(`🧹 Removing ${invalidTokens.length} invalid FCM tokens from DB...`);
        try {
          const User = require('../models/User.model');
          const Guest = require('../models/Guest.model');
          // Pull invalid tokens from both User and Guest collections
          await Promise.all([
            User.updateMany(
              { fcmTokens: { $in: invalidTokens } },
              { $pull: { fcmTokens: { $in: invalidTokens } } }
            ),
            Guest.updateMany(
              { fcmTokens: { $in: invalidTokens } },
              { $pull: { fcmTokens: { $in: invalidTokens } } }
            ),
          ]);
          console.log(`✅ Removed ${invalidTokens.length} stale FCM tokens from DB`);
        } catch (cleanupErr) {
          console.error('⚠️ Failed to clean up invalid tokens:', cleanupErr.message);
        }
      }
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
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

