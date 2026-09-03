const mongoose = require('mongoose');
const { LiveStream, User, Guest, Transaction } = require('../models');
const { createNotification } = require('../utils/notifications');

const PLATFORM_COMMISSION_RATE = 0.10;

// How often the server independently settles live-stream billing.
const BILLING_MONITOR_INTERVAL_MS = 30 * 1000;

// Socket.IO instance, injected from server.js. The background billing monitor
// needs it both to emit updates and to read live room membership (the only
// trustworthy signal for "is this viewer still watching"). Deliberately NOT
// named `io`, because several request handlers declare a local `const io`.
let socketIOInstance = null;
const setSocketIO = (socketIO) => {
  socketIOInstance = socketIO;
};
const getIO = () => socketIOInstance;

// Billing minute rounding: ignore ≤10s (grace period), round to nearest minute for the rest.
// Examples: 10s→0min, 70s (1m10s)→1min, 110s (1m50s)→2min, 130s (2m10s)→2min
const billableMinutes = (seconds) => {
  if (seconds <= 10) return 0;
  return Math.round(seconds / 60);
};

// Helper function for precise money calculation
const preciseMoneyCalculation = (amount1, amount2, operation) => {
  // Convert to cents to avoid floating point issues
  const cents1 = Math.round(amount1 * 100);
  const cents2 = Math.round(amount2 * 100);

  let resultCents;
  switch (operation) {
    case "add":
      resultCents = cents1 + cents2;
      break;
    case "subtract":
      resultCents = cents1 - cents2;
      break;
    case "multiply":
      resultCents = Math.round((cents1 * cents2) / 100);
      break;
    case "divide":
      resultCents = Math.round((cents1 / cents2) * 100);
      break;
    default:
      throw new Error("Invalid operation");
  }

  // Convert back to rupees with exactly 2 decimal places
  return Math.round(resultCents) / 100;
};

// ---------------------------------------------------------------------------
// BILLING ENGINE
// ---------------------------------------------------------------------------
// Every rupee that moves for a live stream moves through settleViewerBilling().
// The HTTP endpoint, the server-side monitor, the leave endpoint, the socket
// disconnect handler and end-of-stream all call this one function, so they can
// never drift apart the way the old duplicated implementations did.

const streamerIdOf = (liveStream) =>
  (liveStream.streamer?._id || liveStream.streamer)?.toString();

const getViewerModel = (viewerType) => (viewerType === 'Guest' ? Guest : User);

const displayNameOf = (account) =>
  account?.fullName || account?.name || 'user';

/**
 * Distinct user ids currently connected to a stream's socket room.
 * Room membership is the only self-correcting presence signal: socket.io removes
 * a socket automatically on disconnect, so stale `leftAt: null` viewer records
 * cannot inflate it.
 */
const roomUserIds = (liveStreamId) => {
  const socketIO = getIO();
  if (!socketIO) return null; // unknown — callers must treat this as "no data"
  const ids = new Set();
  const room = socketIO.sockets.adapter.rooms.get(`live-stream:${liveStreamId}`);
  if (!room) return ids;
  for (const socketId of room) {
    const s = socketIO.sockets.sockets.get(socketId);
    if (s?.data?.userId) ids.add(s.data.userId.toString());
  }
  return ids;
};

/**
 * Live viewer count for a stream, excluding the streamer and the admin monitor.
 * Mirrors getLiveViewerCount in socket/liveStreamSocket.js so both layers report
 * the same number to clients.
 */
const liveViewerCount = (liveStreamId, streamerId) => {
  const socketIO = getIO();
  if (!socketIO) return null;
  const room = socketIO.sockets.adapter.rooms.get(`live-stream:${liveStreamId}`);
  if (!room) return 0;
  const ids = new Set();
  for (const socketId of room) {
    const s = socketIO.sockets.sockets.get(socketId);
    const uid = s?.data?.userId;
    if (!uid) continue;
    if (streamerId && uid.toString() === streamerId.toString()) continue;
    if (s?.data?.user?.isAdminAccount === true) continue;
    ids.add(uid.toString());
  }
  return ids.size;
};

/**
 * Evict a viewer from a stream's socket room.
 *
 * Without this, a viewer whose wallet ran dry kept receiving media: the server
 * stamped `leftAt` (so the billing monitor skipped them from then on) but left
 * them in the room, and cutting the WebRTC feed depended entirely on the
 * STREAMER's client noticing `live-stream:viewer-left` and closing the peer
 * connection. If the streamer's client missed that event the viewer watched for
 * free, permanently unbilled. Forcing the leave server-side removes that trust.
 */
const evictViewerFromRoom = async (liveStreamId, userId) => {
  const socketIO = getIO();
  if (!socketIO) return;
  const room = `live-stream:${liveStreamId}`;
  try {
    // Tell the client to tear its own WebRTC/session down first, then remove it
    // from the room so it stops receiving any further stream traffic.
    socketIO.to(`user:${userId}`).emit('live-stream:force-leave', {
      liveStreamId,
      reason: 'insufficient_funds',
    });
    await socketIO.in(`user:${userId}`).socketsLeave(room);
  } catch (error) {
    console.error(`❌ Failed to evict viewer ${userId} from ${room}:`, error.message);
  }
};

// Guards against the monitor and a client request billing the same viewer at
// the same instant (which would double-charge). Both run in this process, so an
// in-memory key set is sufficient.
const billingLocks = new Set();

/**
 * Is this viewer someone we are allowed to charge at all?
 * The streamer is in the viewers array in some code paths, and the admin
 * account watches for free.
 */
const isBillableViewer = (liveStream, viewer) => {
  if (!viewer || !viewer.user) return false;
  if (viewer.isAdminViewer === true) return false;
  const streamerId = streamerIdOf(liveStream);
  if (streamerId && viewer.user.toString() === streamerId) return false;
  return true;
};

/**
 * Open a fresh billing segment for a viewer: billing runs from `at` and the
 * per-segment counters start at zero. Used on WebRTC connect, on rejoin, and by
 * the monitor when a client never reported a connection.
 */
const anchorBillingSegment = (viewer, at) => {
  viewer.webrtcConnectedAt = at;
  viewer.billingStarted = true;
  viewer.lastBillingTime = at;
  viewer.billedMinutes = 0;
  viewer.segmentSeconds = 0;
  viewer.isPaid = false;
};

/**
 * Minutes already charged in the current segment. Falls back to the legacy
 * `duration`-derived value for viewer records written before segment accounting
 * existed, so streams in flight across a deploy are not re-billed from zero.
 */
const minutesAlreadyBilled = (viewer) => {
  const usesSegmentAccounting = typeof viewer.segmentSeconds === 'number';
  if (usesSegmentAccounting) return viewer.billedMinutes || 0;
  return viewer.duration ? billableMinutes(viewer.duration) : 0;
};

/**
 * Seconds of the current segment already reflected in `duration`. Legacy records
 * kept `duration` as segment-elapsed rather than cumulative, so treat their
 * whole `duration` as the segment.
 */
const segmentSecondsOf = (viewer) =>
  typeof viewer.segmentSeconds === 'number' ? viewer.segmentSeconds : (viewer.duration || 0);

/**
 * Charge a viewer for whole minutes accrued since the last settlement, and
 * credit the streamer their share.
 *
 * Mutates `viewer` (a subdocument) but does NOT save `liveStream` — the caller
 * saves, so a loop over many viewers is one write instead of N.
 *
 * @returns {Promise<{billed: boolean, reason?: string, amountBilled: number,
 *                    shortOfFunds: boolean, balance: number|null}>}
 */
const settleViewerBilling = async (liveStream, viewer, options = {}) => {
  const { final = false, now = new Date() } = options;
  const noop = (reason) => ({ billed: false, reason, amountBilled: 0, shortOfFunds: false, balance: null });

  // 💰 ENFORCE MINIMUM RATE: live streams are never free (min ₹1/min). This
  // mirrors the audio/video call rule and covers legacy/in-flight streams that
  // were created with ratePerMinute=0 before the minimum was enforced at start.
  let rate = liveStream.ratePerMinute || 0;
  if (rate < 1) rate = 1;

  if (!isBillableViewer(liveStream, viewer)) return noop('not-billable');
  // rate is now guaranteed >= 1, so there is no free-stream branch — every
  // billable viewer is charged at least ₹1/min.
  // No billing anchor means we never confirmed the viewer was actually watching,
  // so there is nothing legitimate to charge for.
  if (!viewer.billingStarted || !viewer.webrtcConnectedAt) return noop('billing-not-started');

  const lockKey = `${liveStream._id}:${viewer.user}`;
  if (billingLocks.has(lockKey)) return noop('already-billing');
  billingLocks.add(lockKey);

  try {
    const endAt = final ? (viewer.leftAt || now) : now;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((new Date(endAt) - new Date(viewer.webrtcConnectedAt)) / 1000)
    );
    const elapsedMinutes = billableMinutes(elapsedSeconds);
    const alreadyBilled = minutesAlreadyBilled(viewer);
    const minutesToBill = elapsedMinutes - alreadyBilled;

    // Fold this segment's newly elapsed seconds into the cumulative watch time.
    const newSegmentSeconds = Math.max(0, elapsedSeconds - segmentSecondsOf(viewer));
    const advanceWatchTime = () => {
      viewer.duration = (viewer.duration || 0) + newSegmentSeconds;
      viewer.segmentSeconds = elapsedSeconds;
    };

    if (minutesToBill <= 0) {
      advanceWatchTime();
      viewer.billedMinutes = alreadyBilled;
      if (final) viewer.isPaid = true;
      return noop('nothing-due');
    }

    const ViewerModel = getViewerModel(viewer.viewerType);
    const viewerAccount = await ViewerModel.findById(viewer.user);
    const streamerAccount = await User.findById(streamerIdOf(liveStream));

    if (!viewerAccount || !streamerAccount) {
      console.warn(
        `⚠️ LIVE BILLING: account missing (viewer=${viewer.user}, streamer=${streamerIdOf(liveStream)}) — skipping`
      );
      return noop('account-not-found');
    }

    const fullAmount = preciseMoneyCalculation(minutesToBill, rate, 'multiply');
    const walletBefore = viewerAccount.wallet || 0;
    // Take whatever the wallet can cover. The old code skipped the debit
    // entirely when the balance fell short, which meant a viewer who ran out of
    // money kept watching for free.
    const amountToBill = Math.min(fullAmount, walletBefore);
    const shortOfFunds = amountToBill < fullAmount;

    let streamerEarnings = 0;

    if (amountToBill > 0) {
      // --- Debit the viewer (the joiner) ---
      viewerAccount.wallet = preciseMoneyCalculation(walletBefore, amountToBill, 'subtract');
      viewerAccount.totalSpent = preciseMoneyCalculation(viewerAccount.totalSpent || 0, amountToBill, 'add');
      await viewerAccount.save();

      // --- Credit the streamer, net of platform commission ---
      const platformCommission = preciseMoneyCalculation(amountToBill, PLATFORM_COMMISSION_RATE, 'multiply');
      streamerEarnings = preciseMoneyCalculation(amountToBill, platformCommission, 'subtract');
      streamerAccount.earnings = preciseMoneyCalculation(streamerAccount.earnings || 0, streamerEarnings, 'add');
      streamerAccount.wallet = preciseMoneyCalculation(streamerAccount.wallet || 0, streamerEarnings, 'add');
      await streamerAccount.save();

      const newAmountToPay = preciseMoneyCalculation(viewer.amountToPay || 0, amountToBill, 'add');
      const liveStreamObjId = liveStream._id;
      const totalMinutes = alreadyBilled + minutesToBill;

      // One rolling debit row per viewer per stream.
      await Transaction.findOneAndUpdate(
        { user: viewer.user, category: 'live-stream', consultationId: liveStreamObjId, type: 'debit' },
        {
          $set: {
            amount: newAmountToPay,
            balance: viewerAccount.wallet,
            description: `Live stream with ${displayNameOf(streamerAccount)} - ${totalMinutes} minute(s) @ ₹${rate}/min`,
            status: 'completed',
            paymentMethod: 'wallet',
            userType: viewer.viewerType || 'User',
            'metadata.providerId': streamerAccount._id,
            'metadata.duration': totalMinutes,
            'metadata.rate': rate,
            'metadata.newBalance': viewerAccount.wallet,
          },
          $setOnInsert: {
            user: viewer.user,
            category: 'live-stream',
            type: 'debit',
            consultationId: liveStreamObjId,
          },
        },
        { upsert: true, new: true }
      );

      // One rolling credit row per streamer per stream.
      const existingCredit = await Transaction.findOne({
        user: streamerAccount._id,
        category: 'live-stream',
        consultationId: liveStreamObjId,
        type: 'credit',
      });
      const totalStreamerEarnings = preciseMoneyCalculation(
        existingCredit?.amount || 0,
        streamerEarnings,
        'add'
      );
      await Transaction.findOneAndUpdate(
        { user: streamerAccount._id, category: 'live-stream', consultationId: liveStreamObjId, type: 'credit' },
        {
          $set: {
            amount: totalStreamerEarnings,
            balance: streamerAccount.wallet,
            description: `Live stream earnings from ${displayNameOf(viewerAccount)} - ${totalMinutes} minute(s) @ ₹${rate}/min`,
            status: 'completed',
            paymentMethod: 'wallet',
            userType: 'User',
            'metadata.duration': totalMinutes,
            'metadata.rate': rate,
            'metadata.newBalance': streamerAccount.wallet,
          },
          $setOnInsert: {
            user: streamerAccount._id,
            category: 'live-stream',
            type: 'credit',
            consultationId: liveStreamObjId,
          },
        },
        { upsert: true, new: true }
      );

      viewer.amountToPay = newAmountToPay;
      liveStream.totalEarnings = preciseMoneyCalculation(
        liveStream.totalEarnings || 0,
        streamerEarnings,
        'add'
      );

      console.log('💰 LIVE STREAM BILLED:', {
        liveStreamId: liveStream._id.toString(),
        viewer: viewer.user.toString(),
        viewerType: viewer.viewerType || 'User',
        minutesToBill,
        rate,
        amountToBill,
        partial: shortOfFunds,
        walletBefore,
        walletAfter: viewerAccount.wallet,
        streamerEarnings,
      });
    }

    // Advance the counters even on a partial charge — the session is being
    // terminated below, so these minutes must never be billed twice.
    viewer.billedMinutes = alreadyBilled + minutesToBill;
    advanceWatchTime();
    viewer.lastBillingTime = now;
    if (final) viewer.isPaid = true;

    if (shortOfFunds) {
      // Out of money: end this viewer's session.
      if (!viewer.leftAt) viewer.leftAt = now;
      viewer.isPaid = true;
      const socketIO = getIO();
      if (socketIO) {
        socketIO.to(`user:${viewer.user}`).emit('live-stream:insufficient-funds', {
          liveStreamId: liveStream._id,
          message: 'Insufficient wallet balance, you have been removed from the live stream',
          currentBalance: viewerAccount.wallet,
        });
      }

      // Evict BEFORE broadcasting the count so the number already reflects the
      // departure.
      await evictViewerFromRoom(liveStream._id, viewer.user);

      if (socketIO) {
        const viewerCount = liveViewerCount(liveStream._id, streamerIdOf(liveStream));
        socketIO.to(`live-stream:${liveStream._id}`).emit('live-stream:viewer-left', {
          userId: viewer.user,
          // Always include the count. Web clients ignore the event when this is
          // missing, which left the streamer's viewer number frozen.
          ...(viewerCount === null ? {} : { viewerCount }),
        });
      }
    } else {
      const socketIO = getIO();
      if (socketIO) {
        socketIO.to(`user:${viewer.user}`).emit('live-stream:billing-update', {
          liveStreamId: liveStream._id,
          currentBalance: viewerAccount.wallet,
          totalCharged: viewer.amountToPay,
          duration: viewer.duration,
          ratePerMinute: rate,
        });
        socketIO.to(`user:${streamerAccount._id}`).emit('live-stream:earnings-update', {
          liveStreamId: liveStream._id,
          totalEarnings: liveStream.totalEarnings,
          lastCredit: streamerEarnings,
        });
      }
    }

    return {
      billed: amountToBill > 0,
      amountBilled: amountToBill,
      shortOfFunds,
      balance: viewerAccount.wallet,
    };
  } finally {
    billingLocks.delete(lockKey);
  }
};

// Kept as a thin wrapper so the end/leave call sites read the same as before.
const processFinalBilling = async (liveStream, viewer, now) =>
  settleViewerBilling(liveStream, viewer, { final: true, now });

/**
 * Settle a viewer who exited over a socket (tab close, network drop, explicit
 * leave event). Loads, bills and saves on its own because socket handlers have
 * no request/response cycle to hang the write off.
 */
const settleViewerExit = async (liveStreamId, userId) => {
  try {
    const liveStream = await LiveStream.findById(liveStreamId);
    if (!liveStream) return;

    const viewer = liveStream.viewers.find(
      (v) => v.user && v.user.toString() === userId.toString()
    );
    if (!viewer) return;

    const now = new Date();
    if (!viewer.leftAt) viewer.leftAt = now;
    await processFinalBilling(liveStream, viewer, now);
    await liveStream.save();
  } catch (error) {
    console.error('❌ Error settling live-stream viewer exit:', error.message);
  }
};

// ---------------------------------------------------------------------------
// SERVER-SIDE BILLING MONITOR
// ---------------------------------------------------------------------------
/**
 * Authoritative billing loop. Live-stream billing used to depend entirely on
 * the viewer's client posting /process-billing every 60s, so a backgrounded
 * tab, a failed /viewer-connected call, or a WebRTC state that never reached
 * "connected" all meant the joiner watched for free. This loop bills from the
 * server using socket-room membership as the presence signal, mirroring the
 * watchdog that already protects 1:1 consultation billing.
 */
const liveStreamBillingTick = async () => {
  // NOTE: no ratePerMinute filter here. settleViewerBilling enforces a ₹1/min
  // minimum, so even a stream stored with ratePerMinute=0 (legacy/in-flight
  // before the minimum was enforced at creation) must still be monitored and
  // billed. Filtering on rate > 0 here would silently exempt those streams.
  const activeStreams = await LiveStream.find({
    isActive: true,
  });

  if (activeStreams.length === 0) return;

  const socketIO = getIO();

  for (const liveStream of activeStreams) {
    try {
      // Distinct user ids currently connected to this stream's socket room.
      const presentUserIds = roomUserIds(liveStream._id);

      const now = new Date();
      let dirty = false;

      for (const viewer of liveStream.viewers) {
        if (viewer.leftAt) continue;
        if (!isBillableViewer(liveStream, viewer)) continue;

        const isPresent = presentUserIds ? presentUserIds.has(viewer.user.toString()) : true;

        if (!isPresent) {
          // Gone without a clean leave — settle whatever is owed and close out.
          viewer.leftAt = now;
          await processFinalBilling(liveStream, viewer, now);
          dirty = true;
          if (socketIO) {
            const viewerCount = liveViewerCount(liveStream._id, streamerIdOf(liveStream));
            socketIO.to(`live-stream:${liveStream._id}`).emit('live-stream:viewer-left', {
              userId: viewer.user,
              ...(viewerCount === null ? {} : { viewerCount }),
            });
          }
          continue;
        }

        if (!viewer.billingStarted || !viewer.webrtcConnectedAt) {
          // The viewer is in the room but the client has not yet reported a
          // WebRTC connection. Do NOT bill immediately on join — that would
          // charge people who are still connecting or only previewing. Give the
          // real `viewer-connected` / `webrtc:connected` event a grace period to
          // arrive and anchor billing at the true connect time. Only if that
          // event never lands (and the viewer is demonstrably still present)
          // does the monitor self-anchor as a fallback, so a genuine viewer is
          // never watched for free. Anchoring at *now* (not joinedAt) means the
          // grace-period seconds are not retro-charged.
          const joinedAt = viewer.joinedAt ? new Date(viewer.joinedAt) : null;
          const secondsSinceJoin = joinedAt ? Math.floor((now - joinedAt) / 1000) : Infinity;
          const CONNECT_GRACE_SECONDS = 60;

          if (secondsSinceJoin < CONNECT_GRACE_SECONDS) {
            // Still within grace window — wait for the client's connect event.
            continue;
          }

          anchorBillingSegment(viewer, now);
          dirty = true;
          console.log(
            `⏱️ LIVE BILLING: fallback-anchored billing for viewer ${viewer.user} on stream ${liveStream._id} ` +
            `(no connect event after ${secondsSinceJoin}s in room)`
          );
          continue;
        }

        const result = await settleViewerBilling(liveStream, viewer, { now });
        if (result.billed || result.shortOfFunds) dirty = true;
      }

      if (dirty) await liveStream.save();
    } catch (streamError) {
      console.error(
        `❌ LIVE BILLING: error processing stream ${liveStream._id}:`,
        streamError.message
      );
    }
  }
};

let billingMonitorHandle = null;
const startLiveStreamBillingMonitor = () => {
  if (billingMonitorHandle) return billingMonitorHandle;
  console.log(
    `🖥️ Starting server-side live-stream billing monitor (every ${BILLING_MONITOR_INTERVAL_MS / 1000}s)`
  );
  billingMonitorHandle = setInterval(async () => {
    try {
      await liveStreamBillingTick();
    } catch (error) {
      console.error('❌ LIVE BILLING monitor error:', error.message);
    }
  }, BILLING_MONITOR_INTERVAL_MS);
  return billingMonitorHandle;
};

// @desc Start a live stream
// @route POST /api/live-streams/start
// @access Private
const startLiveStream = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { title, description, thumbnail, ratePerMinute } = req.body;
    
    // Check if user is already streaming
    const existingStream = await LiveStream.findOne({
      streamer: userId,
      isActive: true,
    });
    
    if (existingStream) {
      return res.status(400).json({
        success: false,
        message: "You are already live streaming",
      });
    }

    // Resolve the per-minute rate viewers will be charged. An explicit rate in
    // the request wins; otherwise fall back to the streamer's configured live
    // rate. `rates.live` defaults to 0, and a rate of 0 disables billing
    // entirely — which is the most common reason "nobody gets charged".
    const streamer = await User.findById(userId);
    const requestedRate = Number(ratePerMinute);
    let streamRate =
      Number.isFinite(requestedRate) && requestedRate > 0
        ? requestedRate
        : Number(streamer.rates?.live) || 0;

    // 💰 ENFORCE MINIMUM RATE: live streams are never free (min ₹1/min). If the
    // streamer has no configured live rate, default to ₹1/min so viewers are
    // always billed rather than watching for free.
    if (streamRate < 1) {
      console.log(
        `💰 LIVE STREAM: ${streamer.fullName} (${userId}) had ratePerMinute=${streamRate} — defaulting to ₹1/min minimum.`
      );
      streamRate = 1;
    }

    const liveStream = await LiveStream.create({
      streamer: userId,
      title: title || "Live Stream",
      description,
      thumbnail,
      ratePerMinute: streamRate,
      isActive: true,
      startedAt: new Date(),
    });
    
    // Populate streamer data before returning
    await liveStream.populate('streamer', 'fullName profilePhoto');

    // Send notifications to followers
    const followers = Array.isArray(streamer.followers) ? streamer.followers : [];
    const io = req.app.get('io');
    for (const followerId of followers) {
      try {
        await createNotification({
          userId: followerId,
          title: `${streamer.fullName} is live! 🔴`,
          message: liveStream.title + (liveStream.description ? ` — ${liveStream.description}` : ''),
          type: 'live-stream',
          data: { liveStreamId: liveStream._id },
          sendPush: true,
          io
        });

        // Also send live-stream-started socket event for UI updates
        if (io) {
          io.to(`user:${followerId}`).emit('live-stream-started', {
            liveStreamId: liveStream._id,
            streamer: streamer.fullName,
            title,
          });
        }
      } catch (notifyErr) {
        console.error('Failed to notify follower', followerId, notifyErr);
      }
    }

    // Broadcast the new live stream to everyone so active lives update in real time
    if (io) {
      io.emit('live-stream-started', {
        liveStreamId: liveStream._id,
        streamer: streamer.fullName,
        title,
      });
    }

    res.status(201).json({
      success: true,
      data: liveStream,
      billingEnabled: streamRate > 0,
      ...(streamRate > 0
        ? {}
        : {
            warning:
              'Your live rate is ₹0/min, so viewers will not be charged. Set your live rate in profile settings to earn from live streams.',
          }),
    });
  } catch (error) {
    next(error);
  }
};

// @desc End a live stream
// @route PUT /api/live-streams/:id/end
// @access Private
const endLiveStream = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    const liveStream = await LiveStream.findById(id);
    
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }
    
    if (liveStream.streamer.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to end this live stream",
      });
    }

    if (!liveStream.isActive) {
      return res.status(400).json({
        success: false,
        message: "This live stream has already ended",
      });
    }

    // Process all viewers' payments
    const io = req.app.get('io');
    const now = new Date();
    for (let i = 0; i < liveStream.viewers.length; i++) {
      const viewer = liveStream.viewers[i];
      if (!viewer.leftAt) {
        viewer.leftAt = now;
      }
      await processFinalBilling(liveStream, viewer, now);
    }

    liveStream.isActive = false;
    liveStream.endedAt = now;
    await liveStream.save();
    
    // Notify all viewers
    if (io) {
      io.to(`live-stream:${id}`).emit('live-stream-ended', {
        liveStreamId: id,
      });
    }
    
    res.status(200).json({
      success: true,
      data: liveStream,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Join a live stream (anyone can join)
// @route POST /api/live-streams/:id/join
// @access Private
const joinLiveStream = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    const liveStream = await LiveStream.findById(id).populate('streamer', 'fullName profilePhoto');
    
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }
    
    if (!liveStream.isActive) {
      return res.status(400).json({
        success: false,
        message: "This live stream has ended",
      });
    }
    
    // Admins can join any live stream for free (monitoring). They are never billed.
    // Admins authenticate via the Admin model, so detect them by isAdminAccount
    // (set by the protect middleware), NOT by a "role" field which they don't have.
    const isAdmin = req.user.isAdminAccount === true || req.user.isAdmin === true;
    const viewerType = req.user.isGuest === true ? 'Guest' : 'User';
    
    // Check wallet balance if ratePerMinute > 0 (skip entirely for admins)
    if (!isAdmin && liveStream.ratePerMinute > 0) {
      const ViewerModel = getViewerModel(viewerType);
      const viewerUser = await ViewerModel.findById(userId);
      if (!viewerUser || (viewerUser.wallet || 0) < liveStream.ratePerMinute) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You need at least ₹${liveStream.ratePerMinute} to join this live stream.`,
        });
      }
    }
    
    // Check if user already joined
    const existingViewerIndex = liveStream.viewers.findIndex(viewer => 
      viewer.user.toString() === userId.toString());
    
    if (existingViewerIndex !== -1) {
      const existingViewer = liveStream.viewers[existingViewerIndex];
      // User already joined, check if they left before
      existingViewer.leftAt = null;
      existingViewer.viewerType = viewerType;
      existingViewer.isAdminViewer = isAdmin;
      if (isAdmin) {
        // Ensure an admin viewer stays flagged non-billable
        existingViewer.isPaid = true;
        existingViewer.billingStarted = false;
      } else {
        // Re-arm billing for this rejoin. Leaving `isPaid` true from the last
        // session would permanently exempt them from final billing.
        existingViewer.isPaid = false;
        // Re-anchor on the next /viewer-connected call or monitor tick so the
        // gap between sessions is not billed.
        existingViewer.webrtcConnectedAt = null;
        existingViewer.billingStarted = false;
      }
      await liveStream.save();
      
      // Calculate active viewers count (exclude streamer)
      const activeViewersCount = liveStream.viewers.filter(viewer => 
        !viewer.leftAt && viewer.user.toString() !== liveStream.streamer._id.toString()
      ).length;
      
      // Socket notification
      const io = req.app.get('io');
      if (io) {
        io.to(`live-stream:${id}`).emit('live-stream:viewer-joined', {
          userId,
          user: req.user,
          viewerCount: activeViewersCount,
        });
      }
      
      return res.status(200).json({
        success: true,
        data: liveStream,
      });
    }
    
    // Add new viewer. Admins are flagged non-billable so periodic/final billing
    // skips them entirely. The streamer is never recorded as a viewer of their
    // own stream, otherwise `totalViewers` (viewers.length) is off by one.
    const isOwnStream = streamerIdOf(liveStream) === userId.toString();
    if (!isOwnStream) {
      liveStream.viewers.push({
        user: userId,
        viewerType,
        isAdminViewer: isAdmin,
        joinedAt: new Date(),
        isPaid: isAdmin ? true : false,
      });
    }
    await liveStream.save();
    
    // Calculate active viewers count (exclude streamer)
    const activeViewersCount = liveStream.viewers.filter(viewer => 
      !viewer.leftAt && viewer.user.toString() !== liveStream.streamer._id.toString()
    ).length;
    
    // Socket notification
    const io = req.app.get('io');
    if (io) {
      io.to(`live-stream:${id}`).emit('live-stream:viewer-joined', {
        userId,
        user: req.user,
        viewerCount: activeViewersCount,
      });
    }
    
    res.status(200).json({
      success: true,
      data: liveStream,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Mark viewer's WebRTC as connected
// @route POST /api/live-streams/:id/viewer-connected
// @access Private
const markViewerConnected = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    const liveStream = await LiveStream.findById(id);
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }
    
    const viewerIndex = liveStream.viewers.findIndex(viewer => 
      viewer.user.toString() === userId.toString());
      
    if (viewerIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "You are not in this live stream",
      });
    }
    
    const now = new Date();
    const viewer = liveStream.viewers[viewerIndex];
    const isAdmin = req.user.isAdminAccount === true || req.user.isAdmin === true;

    // Admins watch for free: never start billing for them.
    if (isAdmin) {
      viewer.isAdminViewer = true;
      viewer.webrtcConnectedAt = now;
      viewer.billingStarted = false;
      viewer.isPaid = true;
    } else if (!viewer.billingStarted || !viewer.webrtcConnectedAt) {
      // Only anchor once per segment. A duplicate call from a reconnecting
      // client must not reset the clock, or the viewer would ride out the rest
      // of the stream unbilled by restarting the minute counter every time.
      viewer.viewerType = req.user.isGuest === true ? 'Guest' : 'User';
      anchorBillingSegment(viewer, now);
    }

    await liveStream.save();
    
    res.status(200).json({
      success: true,
      message: "Viewer connected",
      billingEnabled: liveStream.ratePerMinute > 0 && !isAdmin,
      ratePerMinute: liveStream.ratePerMinute,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Process real-time billing for live stream viewer
// @route POST /api/live-streams/:id/process-billing
// @access Private
// NOTE: this endpoint is now only an accelerator. The server-side billing
// monitor settles every active viewer on its own schedule, so a client that
// stops calling this (backgrounded tab, dead interval, network blip) no longer
// gets to watch for free.
const processLiveStreamBilling = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const liveStream = await LiveStream.findById(id);
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }

    const viewerIndex = liveStream.viewers.findIndex(viewer =>
      viewer.user.toString() === userId.toString());

    if (viewerIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "You are not in this live stream",
      });
    }

    const viewer = liveStream.viewers[viewerIndex];
    const isAdmin = req.user.isAdminAccount === true || req.user.isAdmin === true;

    // Admins watch for free — never charge them.
    if (isAdmin) {
      if (viewer.isAdminViewer !== true) {
        viewer.isAdminViewer = true;
        viewer.isPaid = true;
        viewer.billingStarted = false;
        await liveStream.save();
      }
      return res.status(200).json({
        success: true,
        message: "Admin viewer, no billing",
      });
    }

    // NOTE: no "free stream" short-circuit here. settleViewerBilling enforces a
    // ₹1/min minimum, so even a legacy stream stored with ratePerMinute=0 is
    // billed. Returning early on rate<=0 would let those viewers watch free.

    const now = new Date();

    // A viewer hitting this endpoint is definitionally watching, so anchor
    // billing if the /viewer-connected call never landed.
    if (!viewer.billingStarted || !viewer.webrtcConnectedAt) {
      viewer.viewerType = req.user.isGuest === true ? 'Guest' : 'User';
      anchorBillingSegment(viewer, now);
      await liveStream.save();
      return res.status(200).json({
        success: true,
        message: "Billing started",
        data: { duration: viewer.duration || 0, totalCharged: viewer.amountToPay || 0 },
      });
    }

    const result = await settleViewerBilling(liveStream, viewer, { now });
    await liveStream.save();

    if (result.shortOfFunds) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        consultationEnded: true,
        currentBalance: result.balance,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        duration: viewer.duration,
        totalCharged: viewer.amountToPay,
        currentBalance: result.balance,
        ratePerMinute: liveStream.ratePerMinute,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc Leave a live stream
// @route POST /api/live-streams/:id/leave
// @access Private
const leaveLiveStream = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    const liveStream = await LiveStream.findById(id);
    
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }
    
    const viewerIndex = liveStream.viewers.findIndex(viewer => 
      viewer.user.toString() === userId.toString());
    
    if (viewerIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "You are not in this live stream",
      });
    }
    
    const now = new Date();
    // Update viewer's left time
    liveStream.viewers[viewerIndex].leftAt = now;
    
    // Process final billing for this viewer
    const io = req.app.get('io');
    await processFinalBilling(liveStream, liveStream.viewers[viewerIndex], now);
    
    await liveStream.save();
    
    // Populate streamer to exclude from streamer._id
    await liveStream.populate('streamer', '_id');
    
    // Calculate active viewers count (exclude streamer)
    const activeViewersCount = liveStream.viewers.filter(viewer => 
      !viewer.leftAt && viewer.user.toString() !== liveStream.streamer._id.toString()
    ).length;
    
    // Socket notification
    if (io) {
      io.to(`live-stream:${id}`).emit('live-stream:viewer-left', {
        userId,
        viewerCount: activeViewersCount,
      });
    }
    
    res.status(200).json({
      success: true,
      data: liveStream,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Get active live streams
// @route GET /api/live-streams
// @access Public
const getLiveStreams = async (req, res, next) => {
  try {
    const liveStreams = await LiveStream.find({
      isActive: true,
    })
    .populate('streamer', 'fullName profilePhoto')
    .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: liveStreams,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Get a single live stream
// @route GET /api/live-streams/:id
// @access Public
const getLiveStream = async (req, res, next) => {
  try {
    const { id } = req.params;
    const liveStream = await LiveStream.findById(id)
    .populate('streamer', 'fullName profilePhoto')
    .populate('viewers.user', 'fullName profilePhoto');
    
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: "Live stream not found",
      });
    }
    
    res.status(200).json({
      success: true,
      data: liveStream,
    });
  } catch (error) {
    next(error);
  }
};

// @desc Get live stream history for the logged-in user
//       Returns streams they hosted (streamer) and streams they joined (viewer)
// @route GET /api/live-streams/history
// @access Private
const getLiveStreamHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Streams the user hosted
    const hostedStreams = await LiveStream.find({ streamer: userId })
      .populate('streamer', 'fullName profilePhoto')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Streams the user watched (viewer entry exists)
    const watchedStreams = await LiveStream.find({
      'viewers.user': userId,
      // Exclude streams where the user is also the streamer (already in hostedStreams)
      streamer: { $ne: userId },
    })
      .populate('streamer', 'fullName profilePhoto')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Normalise to a flat list with a `role` and viewer info attached
    const hosted = hostedStreams.map(s => {
      const plain = s.toObject();
      return {
        ...plain,
        role: 'streamer',
        // How long the stream ran
        durationSeconds: s.endedAt && s.startedAt
          ? Math.floor((new Date(s.endedAt) - new Date(s.startedAt)) / 1000)
          : null,
      };
    });

    const watched = watchedStreams.map(s => {
      const plain = s.toObject();
      const viewerEntry = plain.viewers.find(
        v => v.user?.toString() === userId.toString(),
      );
      return {
        ...plain,
        role: 'viewer',
        viewerEntry,
        // How long the viewer watched (seconds, from their viewer record)
        durationSeconds: viewerEntry?.duration ?? null,
      };
    });

    res.status(200).json({
      success: true,
      data: [...hosted, ...watched].sort(
        (a, b) => new Date(b.startedAt || b.createdAt) - new Date(a.startedAt || a.createdAt),
      ),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startLiveStream,
  endLiveStream,
  joinLiveStream,
  leaveLiveStream,
  getLiveStreams,
  getLiveStream,
  getLiveStreamHistory,
  markViewerConnected,
  processLiveStreamBilling,
  // Billing internals used by the socket layer and server bootstrap
  setSocketIO,
  startLiveStreamBillingMonitor,
  liveStreamBillingTick,
  settleViewerExit,
  anchorBillingSegment,
};
