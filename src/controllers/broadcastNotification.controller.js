const User = require('../models/User.model');
const Guest = require('../models/Guest.model');
const { sendMulticastNotification, firebaseInitialized } = require('../utils/firebase');

/**
 * POST /admin/broadcast-notification
 * Send a push notification to all users / providers / guests
 */
const sendBroadcastNotification = async (req, res, next) => {
  try {
    const {
      title,
      body,
      imageUrl,   // optional
      target = 'all', // 'all' | 'providers' | 'users' | 'guests'
      data = {},  // extra data payload
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }

    if (!firebaseInitialized) {
      return res.status(503).json({ success: false, message: 'Firebase is not initialized on this server' });
    }

    // ── Collect FCM tokens ────────────────────────────────────────────────────
    let userTokens = [];
    let guestTokens = [];

    if (target === 'all' || target === 'providers' || target === 'users') {
      const userFilter = { fcmTokens: { $exists: true, $not: { $size: 0 } }, status: { $nin: ['deleted', 'suspended'] } };
      if (target === 'providers') userFilter.isServiceProvider = true;
      if (target === 'users')    userFilter.isServiceProvider = false;

      const users = await User.find(userFilter).select('fcmTokens').lean();
      users.forEach(u => {
        if (Array.isArray(u.fcmTokens)) userTokens.push(...u.fcmTokens);
      });
    }

    if (target === 'all' || target === 'guests') {
      const guests = await Guest.find({ fcmTokens: { $exists: true, $not: { $size: 0 } } }).select('fcmTokens').lean();
      guests.forEach(g => {
        if (Array.isArray(g.fcmTokens)) guestTokens.push(...g.fcmTokens);
      });
    }

    // Deduplicate and filter valid tokens
    const allTokens = [...new Set([...userTokens, ...guestTokens])].filter(
      t => t && typeof t === 'string' && t.length > 10
    );

    if (allTokens.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No active FCM tokens found for the selected audience',
        stats: { totalTokens: 0, successCount: 0, failureCount: 0, batches: 0 },
      });
    }

    // ── Send in batches of 500 (FCM multicast limit) ──────────────────────────
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
      batches.push(allTokens.slice(i, i + BATCH_SIZE));
    }

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const notificationPayload = {
        title,
        body,
        token: batch,
        data: {
          action: 'broadcast',
          target,
          ...data,
          // Stringify any non-string values (FCM data must be string:string)
          ...(imageUrl ? { imageUrl } : {}),
        },
      };

      // Add image to notification if provided
      if (imageUrl) {
        notificationPayload.imageUrl = imageUrl;
      }

      const result = await sendMulticastNotification(notificationPayload);
      if (result.success) {
        totalSuccess += result.successCount || 0;
        totalFailure += result.failureCount || 0;
      } else {
        totalFailure += batch.length;
      }
    }

    console.log(`📢 Broadcast sent — target: ${target}, tokens: ${allTokens.length}, success: ${totalSuccess}, failed: ${totalFailure}`);

    res.status(200).json({
      success: true,
      message: `Broadcast notification sent successfully`,
      stats: {
        totalTokens: allTokens.length,
        successCount: totalSuccess,
        failureCount: totalFailure,
        batches: batches.length,
      },
    });
  } catch (error) {
    console.error('❌ Broadcast notification error:', error);
    next(error);
  }
};

/**
 * GET /admin/broadcast-notification/stats
 * Returns audience size counts so admin can preview before sending
 */
const getBroadcastStats = async (req, res, next) => {
  try {
    const activeFilter = { status: { $nin: ['deleted', 'suspended'] }, fcmTokens: { $exists: true, $not: { $size: 0 } } };

    const [allUsers, providers, regularUsers, guests] = await Promise.all([
      User.countDocuments(activeFilter),
      User.countDocuments({ ...activeFilter, isServiceProvider: true }),
      User.countDocuments({ ...activeFilter, isServiceProvider: false }),
      Guest.countDocuments({ fcmTokens: { $exists: true, $not: { $size: 0 } } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        all: allUsers + guests,
        providers,
        users: regularUsers,
        guests,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendBroadcastNotification, getBroadcastStats };
