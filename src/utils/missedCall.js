/**
 * missedCall.js
 *
 * Single place that turns an unanswered call into a "Missed call" push
 * notification for the person who missed it.
 *
 * Why this exists
 * ---------------
 * A call can go unanswered and be cleaned up by any of these timers, all 60 s:
 *
 *   1. socket/index.js         "consultation:call-request"  (both the
 *                              provider-online and provider-offline branches)
 *   2. consultation.controller "no-answer auto-timeout" set at creation
 *   3. realTimeBilling.controller "auto-cancellation timer"
 *
 * They all emitted socket events only. A socket event reaches nobody when the
 * app is backgrounded or killed — which is exactly the case where the call was
 * missed in the first place — so the provider was never told. The in-app
 * MISSED_CALL banner (written by the mobile app itself) only appears if the app
 * was alive and listening.
 *
 * Because those timers can overlap, the notification must be claimed
 * atomically: findOneAndUpdate on missedCallNotifiedAt succeeds for exactly one
 * caller, everyone else no-ops. That also holds across multiple server
 * instances, which an in-memory Set would not.
 */

const notificationTemplates = require('./notificationTemplates');

/**
 * Resolve whether an id belongs to a User or a Guest (needed for FCM lookup).
 */
const resolveUserType = async (id) => {
  try {
    const Guest = require('../models/Guest.model');
    const guest = await Guest.findById(id).select('_id');
    return guest ? 'guest' : 'user';
  } catch (e) {
    return 'user';
  }
};

/**
 * Best-effort display name for the caller.
 */
const resolveCallerName = async (callerId, fallback) => {
  if (fallback && fallback !== 'Unknown' && fallback !== 'User') return fallback;
  if (!callerId) return fallback || 'Someone';
  try {
    const { User } = require('../models');
    const user = await User.findById(callerId).select('fullName name');
    if (user) return user.fullName || user.name || fallback || 'Someone';

    const Guest = require('../models/Guest.model');
    const guest = await Guest.findById(callerId).select('name');
    if (guest) return guest.name || fallback || 'Someone';
  } catch (e) {
    // fall through
  }
  return fallback || 'Someone';
};

/**
 * Send the missed-call notification for a consultation, exactly once.
 *
 * @param {Object} opts
 * @param {string} opts.consultationId
 * @param {string} [opts.recipientId]  who missed the call (defaults to the
 *                                     consultation's provider)
 * @param {string} [opts.callerId]     who called (defaults to consultation.user)
 * @param {string} [opts.callerName]
 * @param {string} [opts.callType]     'audio' | 'video'
 * @param {Object} [opts.io]           socket.io instance for the realtime copy
 * @returns {Promise<boolean>} true when a notification was sent by this call
 */
const sendMissedCallNotification = async ({
  consultationId,
  recipientId,
  callerId,
  callerName,
  callType,
  io,
} = {}) => {
  if (!consultationId) return false;

  try {
    const Consultation = require('../models/Consultation.model');

    // ── Atomic claim ───────────────────────────────────────────────────────
    // Only the first timer to get here wins; the rest match nothing and exit.
    const claimed = await Consultation.findOneAndUpdate(
      { _id: consultationId, missedCallNotifiedAt: null },
      { $set: { missedCallNotifiedAt: new Date() } },
      { new: true },
    );

    if (!claimed) {
      console.log(
        `📵 Missed-call notification already sent for ${consultationId} — skipping duplicate`,
      );
      return false;
    }

    // Never send for a call that actually connected. Guards against a stray
    // timer firing on a consultation that was answered late.
    if (claimed.providerAccepted || claimed.webrtcConnectedAt) {
      console.log(
        `📵 Not sending missed-call for ${consultationId} — the call was answered`,
      );
      return false;
    }

    // Chat "calls" have no ringing, so a missed-call notice makes no sense.
    if (claimed.type === 'chat') {
      console.log(`📵 Not sending missed-call for ${consultationId} — chat consultation`);
      return false;
    }

    const to = String(recipientId || claimed.provider || '');
    const from = String(callerId || claimed.user || '');
    if (!to) {
      console.log(`📵 Cannot send missed-call for ${consultationId} — no recipient`);
      return false;
    }

    const [userType, name] = await Promise.all([
      resolveUserType(to),
      resolveCallerName(from, callerName),
    ]);

    const resolvedType = callType || claimed.type || 'audio';

    console.log(
      `📵 Sending missed-call notification for ${consultationId} → ${userType}:${to} (from ${name})`,
    );

    await notificationTemplates.callMissed(
      to,
      userType,
      String(consultationId),
      name,
      io,
      { callType: resolvedType, from },
    );

    return true;
  } catch (error) {
    console.error('❌ Failed to send missed-call notification:', error?.message);
    console.error(error?.stack);
    return false;
  }
};

module.exports = { sendMissedCallNotification };
