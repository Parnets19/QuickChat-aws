const mongoose = require('mongoose');
const { LiveStream, User, Transaction } = require('../models');
const { createNotification } = require('../utils/notifications');

const PLATFORM_COMMISSION_RATE = 0.10;

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

// Helper function to process final billing for a viewer
const processFinalBilling = async (liveStream, viewer, now, io) => {
  if (!viewer.isPaid && viewer.webrtcConnectedAt && liveStream.ratePerMinute > 0) {
    const billingStartTime = viewer.webrtcConnectedAt;
    const durationInSeconds = Math.floor(((viewer.leftAt || now) - billingStartTime) / 1000);
    const durationInMinutes = billableMinutes(durationInSeconds);
    const lastBilledMinutes = viewer.duration ? billableMinutes(viewer.duration) : 0;
    const minutesToBill = durationInMinutes - lastBilledMinutes;

    if (minutesToBill > 0) {
      const amountToBill = preciseMoneyCalculation(minutesToBill, liveStream.ratePerMinute, "multiply");

      // Get viewer and streamer users
      const viewerUser = await User.findById(viewer.user);
      const streamerUser = await User.findById(liveStream.streamer);

      if (viewerUser && streamerUser) {
        // Only deduct if viewer has enough balance
        if (viewerUser.wallet >= amountToBill) {
          // Deduct from viewer
          viewerUser.wallet = preciseMoneyCalculation(viewerUser.wallet, amountToBill, "subtract");
          viewerUser.totalSpent = preciseMoneyCalculation(viewerUser.totalSpent, amountToBill, "add");
          await viewerUser.save();

          // Credit to streamer (minus commission)
          const platformCommission = preciseMoneyCalculation(amountToBill, PLATFORM_COMMISSION_RATE, "multiply");
          const streamerEarnings = preciseMoneyCalculation(amountToBill, platformCommission, "subtract");
          streamerUser.earnings = preciseMoneyCalculation(streamerUser.earnings, streamerEarnings, "add");
          streamerUser.wallet = preciseMoneyCalculation(streamerUser.wallet, streamerEarnings, "add");
          await streamerUser.save();

          // Calculate total minutes for the whole session so far
          const totalMinutes = durationInMinutes;
          const newAmountToPay = preciseMoneyCalculation(viewer.amountToPay || 0, amountToBill, "add");

          // Upsert a single transaction per viewer per live stream (update if exists, create if not)
          await Transaction.findOneAndUpdate(
            { user: viewer.user, category: "live-stream", consultationId: liveStream._id, type: "debit" },
            {
              $set: {
                amount: newAmountToPay,
                balance: viewerUser.wallet,
                description: `Live stream with ${streamerUser.fullName} - ${totalMinutes} minute(s) @ ₹${liveStream.ratePerMinute}/min`,
                status: "completed",
                paymentMethod: "wallet",
                userType: "User",
              },
              $setOnInsert: {
                user: viewer.user,
                category: "live-stream",
                type: "debit",
                consultationId: liveStream._id,
              },
            },
            { upsert: true, new: true }
          );

          // Upsert a single transaction per streamer per live stream (update if exists, create if not)
          const totalStreamerEarnings = preciseMoneyCalculation(
            (await Transaction.findOne({ user: liveStream.streamer, category: "live-stream", consultationId: liveStream._id, type: "credit" }))?.amount || 0,
            streamerEarnings,
            "add"
          );
          await Transaction.findOneAndUpdate(
            { user: liveStream.streamer, category: "live-stream", consultationId: liveStream._id, type: "credit" },
            {
              $set: {
                amount: totalStreamerEarnings,
                balance: streamerUser.wallet,
                description: `Live stream earnings from ${viewerUser.fullName} - ${totalMinutes} minute(s) @ ₹${liveStream.ratePerMinute}/min`,
                status: "completed",
                paymentMethod: "wallet",
                userType: "User",
              },
              $setOnInsert: {
                user: liveStream.streamer,
                category: "live-stream",
                type: "credit",
                consultationId: liveStream._id,
              },
            },
            { upsert: true, new: true }
          );

          // Update viewer
          viewer.duration = durationInSeconds;
          viewer.amountToPay = newAmountToPay;
          viewer.isPaid = true;
          viewer.lastBillingTime = now;
          // FIXED: Add streamer earnings (after commission), not full amount
          liveStream.totalEarnings = preciseMoneyCalculation(liveStream.totalEarnings, streamerEarnings, "add");
        }
      }
    } else {
      // Already billed all minutes
      viewer.isPaid = true;
    }
  }
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

    // Get streamer's rate
    const streamer = await User.findById(userId);
    const streamRate = ratePerMinute || streamer.rates.live || 0;

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
      await processFinalBilling(liveStream, viewer, now, io);
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
    const isAdmin = req.user.role === "admin";
    
    // Check wallet balance if ratePerMinute > 0 (skip entirely for admins)
    if (!isAdmin && liveStream.ratePerMinute > 0) {
      const viewerUser = await User.findById(userId);
      if (!viewerUser || viewerUser.wallet < liveStream.ratePerMinute) {
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
      // User already joined, check if they left before
      liveStream.viewers[existingViewerIndex].leftAt = null;
      // Ensure an admin viewer stays flagged non-billable
      if (isAdmin) {
        liveStream.viewers[existingViewerIndex].isPaid = true;
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
    
    // Add new viewer. Admins are flagged isPaid so final/periodic billing skips them.
    liveStream.viewers.push({
      user: userId,
      joinedAt: new Date(),
      isPaid: isAdmin ? true : false,
    });
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
    liveStream.viewers[viewerIndex].webrtcConnectedAt = now;
    
    // Admins watch for free: never start billing for them.
    if (req.user.role === "admin") {
      liveStream.viewers[viewerIndex].billingStarted = false;
      liveStream.viewers[viewerIndex].isPaid = true;
    } else {
      liveStream.viewers[viewerIndex].billingStarted = true;
      liveStream.viewers[viewerIndex].lastBillingTime = now;
    }
    
    await liveStream.save();
    
    res.status(200).json({
      success: true,
      message: "Viewer connected",
    });
  } catch (error) {
    next(error);
  }
};

// @desc Process real-time billing for live stream viewer
// @route POST /api/live-streams/:id/process-billing
// @access Private
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
    
    // Admins watch for free — never charge them.
    if (req.user.role === "admin") {
      return res.status(200).json({
        success: true,
        message: "Admin viewer, no billing",
      });
    }
    
    // If rate is 0, no billing needed
    if (liveStream.ratePerMinute === 0) {
      return res.status(200).json({
        success: true,
        message: "Free live stream, no billing needed",
      });
    }
    
    // Check if billing has started and webrtc is connected
    if (!viewer.billingStarted || !viewer.webrtcConnectedAt) {
      return res.status(200).json({
        success: true,
        message: "Billing not started yet",
      });
    }
    
    const now = new Date();
    const billingStartTime = viewer.webrtcConnectedAt;
    const elapsedMs = now - billingStartTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const elapsedMinutes = billableMinutes(elapsedSeconds);
    const lastBilledMinutes = viewer.duration ? billableMinutes(viewer.duration) : 0;
    
    if (elapsedMinutes > lastBilledMinutes) {
      const minutesToBill = elapsedMinutes - lastBilledMinutes;
      const amountToBill = preciseMoneyCalculation(minutesToBill, liveStream.ratePerMinute, "multiply");
      
      // Get viewer and streamer users
      const viewerUser = await User.findById(userId);
      const streamerUser = await User.findById(liveStream.streamer);
      
      if (!viewerUser || !streamerUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      
      // Check if viewer has enough balance
      if (viewerUser.wallet < amountToBill) {
        // Not enough balance, end viewer's session
        viewer.leftAt = now;
        viewer.duration = elapsedSeconds;
        await liveStream.save();
        
        // Notify via socket
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${userId}`).emit('live-stream:insufficient-funds', {
            liveStreamId: id,
            message: "Insufficient wallet balance, you have been removed from the live stream",
          });
          io.to(`live-stream:${id}`).emit('live-stream:viewer-left', {
            userId,
          });
        }
        
        return res.status(400).json({
          success: false,
          message: "Insufficient wallet balance",
          consultationEnded: true,
        });
      }
      
      // Deduct from viewer
      viewerUser.wallet = preciseMoneyCalculation(viewerUser.wallet, amountToBill, "subtract");
      viewerUser.totalSpent = preciseMoneyCalculation(viewerUser.totalSpent, amountToBill, "add");
      await viewerUser.save();
      
      // Credit to streamer (minus commission)
      const platformCommission = preciseMoneyCalculation(amountToBill, PLATFORM_COMMISSION_RATE, "multiply");
      const streamerEarnings = preciseMoneyCalculation(amountToBill, platformCommission, "subtract");
      streamerUser.earnings = preciseMoneyCalculation(streamerUser.earnings, streamerEarnings, "add");
      streamerUser.wallet = preciseMoneyCalculation(streamerUser.wallet, streamerEarnings, "add");
      await streamerUser.save();
      
      // Calculate total accumulated amount for this session
      const newAmountToPay = preciseMoneyCalculation(viewer.amountToPay || 0, amountToBill, "add");

      // Upsert a single transaction per viewer per live stream (update if exists, create if not)
      const liveStreamObjId = new mongoose.Types.ObjectId(id);
      await Transaction.findOneAndUpdate(
        { user: userId, category: "live-stream", consultationId: liveStreamObjId, type: "debit" },
        {
          $set: {
            amount: newAmountToPay,
            balance: viewerUser.wallet,
            description: `Live stream with ${streamerUser.fullName} - ${elapsedMinutes} minute(s) @ ₹${liveStream.ratePerMinute}/min`,
            status: "completed",
            paymentMethod: "wallet",
            userType: "User",
          },
          $setOnInsert: {
            user: userId,
            category: "live-stream",
            type: "debit",
            consultationId: liveStreamObjId,
          },
        },
        { upsert: true, new: true }
      );

      // Upsert a single transaction per streamer per live stream (update if exists, create if not)
      const existingStreamerTx = await Transaction.findOne({ user: liveStream.streamer, category: "live-stream", consultationId: liveStreamObjId, type: "credit" });
      const totalStreamerEarnings = preciseMoneyCalculation(existingStreamerTx?.amount || 0, streamerEarnings, "add");
      await Transaction.findOneAndUpdate(
        { user: liveStream.streamer, category: "live-stream", consultationId: liveStreamObjId, type: "credit" },
        {
          $set: {
            amount: totalStreamerEarnings,
            balance: streamerUser.wallet,
            description: `Live stream earnings from ${viewerUser.fullName} - ${elapsedMinutes} minute(s) @ ₹${liveStream.ratePerMinute}/min`,
            status: "completed",
            paymentMethod: "wallet",
            userType: "User",
          },
          $setOnInsert: {
            user: liveStream.streamer,
            category: "live-stream",
            type: "credit",
            consultationId: liveStreamObjId,
          },
        },
        { upsert: true, new: true }
      );

      // Update viewer
      viewer.duration = elapsedSeconds;
      viewer.amountToPay = newAmountToPay;
      viewer.lastBillingTime = now;
      // FIXED: Add streamer earnings (after commission), not full amount
      liveStream.totalEarnings = preciseMoneyCalculation(liveStream.totalEarnings, streamerEarnings, "add");
      await liveStream.save();
      
      // Emit billing update via socket
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${userId}`).emit('live-stream:billing-update', {
          liveStreamId: id,
          currentBalance: viewerUser.wallet,
          totalCharged: viewer.amountToPay,
          duration: elapsedSeconds,
        });
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        duration: viewer.duration,
        totalCharged: viewer.amountToPay,
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
    await processFinalBilling(liveStream, liveStream.viewers[viewerIndex], now, io);
    
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
};
