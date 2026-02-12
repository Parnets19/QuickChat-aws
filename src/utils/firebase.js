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
    logger.warn('Firebase not initialized. Skipping push notification.');
    return false;
  }

  try {
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      token: Array.isArray(notification.token) ? notification.token[0] : notification.token,
    };

    await admin.messaging().send(message);
    logger.info('Push notification sent successfully');
    return true;
  } catch (error) {
    logger.error('Push notification error:', error);
    return false;
  }
};

const sendMulticastNotification = async (notification) => {
  if (!firebaseInitialized) {
    logger.warn('Firebase not initialized. Skipping multicast notification.');
    return false;
  }

  try {
    if (!Array.isArray(notification.token)) {
      notification.token = [notification.token];
    }

    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      tokens: notification.token,
    };

    const response = await admin.messaging().sendMulticast(message);
    logger.info(`Push notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
    return true;
  } catch (error) {
    logger.error('Multicast notification error:', error);
    return false;
  }
};

module.exports = {
  admin: firebaseInitialized ? admin : null,
  sendPushNotification,
  sendMulticastNotification,
  firebaseInitialized,
};

