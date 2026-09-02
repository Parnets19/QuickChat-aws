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

    // CRITICAL: Chat messages AND incoming calls are DATA-ONLY.
    // A data-only high-priority message is the ONLY payload that GUARANTEES
    // QuickChatFirebaseService.onMessageReceived() fires when the app is KILLED
    // on every OEM (Xiaomi/Oppo/Vivo/OnePlus/Samsung). A message with a
    // `notification` block is intercepted by the Android system FCM handler,
    // which renders its own banner and (on most OEMs) NEVER calls
    // onMessageReceived() — so the native ringtone, full-screen call UI,
    // Telecom registration and PENDING_INCOMING_CALL write never run.
    // This is exactly how WhatsApp/Truecaller deliver killed-state calls.
    const isIncomingCall = notification.data?.action === 'incoming_call';
    const isChatMessage  = notification.data?.action === 'new_message';
    const isMissedCall   = notification.data?.action === 'missed_call';
    const isCallCancelled = notification.data?.action === 'call_cancelled';

    // ── Why missed_call and call_cancelled are DATA-ONLY ─────────────────────
    // Both mean "stop ringing NOW". That work is done by
    // QuickChatFirebaseService.onMessageReceived() natively: stop the looping
    // ringtone, stop vibration, cancel the incoming-call notification, close the
    // native ringing screen, clear PENDING_INCOMING_CALL and post the missed-call
    // notification.
    //
    // A message carrying a `notification` block is intercepted by Android's own
    // FCM handler, which renders a banner and — on most OEMs — NEVER calls
    // onMessageReceived while the app is backgrounded or killed. That is exactly
    // why the phone kept ringing after the caller hung up, and why no missed-call
    // entry appeared: the payload looked fine, but our native handler never ran.
    //
    // Data-only means the service always runs and posts the visible notification
    // itself (see postMissedCallNotification).
    const isDataOnly     = isChatMessage || isIncomingCall || isMissedCall || isCallCancelled;

    const message = {
      // Data-only for chats; notification block for everything else INCLUDING calls
      ...(!isDataOnly ? {
        notification: {
          title: notification.title,
          body: notification.body,
        },
      } : {}),
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

    // ── INCOMING CALL — high-priority with notification block to WAKE killed app ──
    // On Chinese OEMs (Xiaomi, Oppo, Vivo, Realme, OnePlus) and some Samsung
    // devices, data-only messages do NOT wake a killed app process. The fix is
    // to include a notification block so Android's system FCM handler always
    // wakes the app. QuickChatFirebaseService.onMessageReceived() still fires
    // and replaces the system notification with our custom full-screen call UI.
    if (isIncomingCall) {
      // DATA-ONLY high-priority — NO notification block.
      // This guarantees QuickChatFirebaseService.onMessageReceived() fires even
      // when the app is killed, so the native code can show the full-screen
      // call UI + ringtone itself (WhatsApp/Truecaller behaviour).
      message.android = {
        priority: 'high',
        ttl: 55 * 1000, // 55 s — matches PENDING_CALL_TTL_MS on the client
      };

      // iOS: use a VoIP-style content-available push. (Real VoIP requires PushKit;
      // this content-available alert is the interim path.)
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

      console.log('📞 Incoming call configured: DATA-ONLY + high priority (guarantees onMessageReceived on killed app)');
    } else if (isChatMessage) {
      // Chat messages NEED a notification block so Android/iOS displays the
      // system notification banner when the app is background or killed.
      // In the foreground the JS onMessage handler immediately cancels the
      // system banner via QuickChatNotifications.cancelAllNotifications() and
      // replaces it with the in-app banner — so there is no double-banner.
      message.notification = {
        title: notification.title,
        body:  notification.body,
      };
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          sound:     'default',
          priority:  'high',
          tag:       'chat_message', // tag allows per-message cancel in foreground
        },
      };
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
              body:  notification.body,
            },
          },
        },
      };
      console.log('💬 Chat message configured (notification + data, cancelable in foreground)');
    } else if (isMissedCall || isCallCancelled) {
      // ── MISSED CALL / CALL CANCELLED — DATA-ONLY, high priority ────────────
      // No notification block on purpose (see the isDataOnly comment above): the
      // native service must run to stop the ringtone and dismiss the ringing UI,
      // and it posts the visible "Missed call from X" notification itself on the
      // 'missed_calls' channel.
      message.android = {
        priority: 'high',
        ttl: 60 * 1000, // pointless to deliver a "stop ringing" later than the call
      };
      // iOS has no equivalent native handler, so keep a visible alert there.
      message.apns = {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
            alert: { title: notification.title, body: notification.body },
          },
        },
      };
      console.log(
        `📵 ${isMissedCall ? 'Missed call' : 'Call cancelled'} configured: DATA-ONLY + high priority (native handler stops the ringtone)`
      );
    } else {
      // For other notifications (wallet, admin, live-stream, broadcast etc.)
      message.android.notification = {
        channelId: 'default',
        sound: 'default',
        priority: 'high',
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

    const isIncomingCall = notification.data?.action === 'incoming_call';
    const isChatMessage  = notification.data?.action === 'new_message';
    const isMissedCall   = notification.data?.action === 'missed_call';
    const isCallCancelled = notification.data?.action === 'call_cancelled';
    // Chats, incoming calls, missed calls and cancellations are all DATA-ONLY so
    // QuickChatFirebaseService.onMessageReceived() reliably fires on killed apps
    // across all OEMs (it stops the ringtone and posts the missed-call entry).
    const isDataOnly     = isChatMessage || isIncomingCall || isMissedCall || isCallCancelled;

    const message = {
      ...(!isDataOnly ? {
        notification: {
          title: notification.title,
          body: notification.body,
        },
      } : {}),
      data: {
        title: String(notification.title || ''),
        body: String(notification.body || ''),
        ...stringifyData(notification.data),
      },
      tokens: validTokens,
    };

    // ── INCOMING CALL — DATA-ONLY high-priority (no notification block) ──────────
    // A notification block would be intercepted by Android's system FCM handler
    // and, on most OEMs (Xiaomi/Oppo/Vivo/OnePlus/Samsung), onMessageReceived()
    // would NEVER fire when killed — so the native full-screen call UI + ringtone
    // wouldn't run. Data-only high-priority is the ONLY reliable killed-state path.
    if (isIncomingCall) {
      message.android = {
        priority: 'high',
        ttl: 55 * 1000,
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
      console.log('📞 Multicast incoming call configured: DATA-ONLY + high priority (guarantees onMessageReceived on killed app)');
    } else if (isChatMessage) {
      // Chat messages need a notification block for background/killed delivery.
      // Foreground: JS handler cancels the system banner immediately.
      message.notification = {
        title: notification.title,
        body:  notification.body,
      };
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          sound:     'default',
          priority:  'high',
          tag:       'chat_message',
        },
      };
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
              body:  notification.body,
            },
          },
        },
      };
      console.log('💬 Multicast chat message configured (notification + data, cancelable in foreground)');
    } else if (isMissedCall || isCallCancelled) {
      // Missed call / cancellation — DATA-ONLY so the native service runs, stops
      // the ringtone and posts the missed-call notification itself. See the
      // single-token path above for the full rationale.
      message.android = {
        priority: 'high',
        ttl: 60 * 1000,
      };
      message.apns = {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
            alert: { title: notification.title, body: notification.body },
          },
        },
      };
      console.log(
        `📵 Multicast ${isMissedCall ? 'missed call' : 'call cancelled'} configured: DATA-ONLY + high priority`
      );
    } else {
      // General notifications (wallet, admin, live-stream, broadcast)
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high',
          body: notification.body,
        },
      };
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

