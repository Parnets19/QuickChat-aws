const { Reel, ReelComment, User } = require('../models');
const { AppError } = require('../middlewares/errorHandler');
const { createNotification } = require('../utils/notifications');

// Helper: get the provider (owner) ID for a reel
const getReelOwnerId = async (reelId) => {
  if (reelId.startsWith('provider:')) {
    return reelId.split(':')[1];
  }
  const reel = await Reel.findById(reelId).select('user');
  return reel?.user?.toString() || null;
};

// @desc    Create a new reel
// @route   POST /api/reels
// @access  Private
const createReel = async (req, res, next) => {
  try {
    const { videoUrl, thumbnailUrl, caption, tags } = req.body;
    const userId = req.user._id;

    const reel = await Reel.create({
      user: userId,
      videoUrl,
      thumbnailUrl,
      caption,
      tags,
    });

    res.status(201).json({ success: true, data: reel });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all reels (with Instagram-like algorithm: mix of following, trending, etc.)
// @route   GET /api/reels
// @access  Public/Optional
// Updated to show provider portfolio media (4)
const getReels = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 15);

    // Simple Instagram-like algorithm:
    // 1. Reels from users you follow first
    // 2. Trending reels (by views/likes/shares
    // 3. Recent reels
    // 4. Also include providers' portfolio media (images & videos)

    // Only surface content from verified, active, visible, non-deleted providers.
    const providerFilter = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: 'active',
      providerVerificationStatus: 'verified',
      isDeleted: { $ne: true },
    };

    // Get all providers (advisers) with portfolio media OR profession video
    const providers = await User.find(providerFilter)
      .select('_id fullName profilePhoto bio profession portfolioMedia professionVideo');

    // Build the set of allowed owner IDs so reels from unverified accounts are excluded
    const verifiedProviderIds = providers.map(p => p._id);

    let reels = await Reel.find({ isActive: true, user: { $in: verifiedProviderIds } })
      .populate('user', '_id fullName profilePhoto')
      .sort({ createdAt: -1 })
      .limit(50);

    console.log('🔍 [Reels Debug] Found providers:', providers.length);
    providers.forEach(p => {
      console.log('  → Provider:', p.fullName, 
        'portfolioMedia:', p.portfolioMedia?.length, 
        'professionVideo:', p.professionVideo?.length);
    });

    // Get user IDs that already have reels
    const userIdsWithReels = new Set(reels.map(reel => reel.user._id.toString()));

    // Create reels from providers' portfolio media AND profession video
    const providerPortfolioItems = [];
    providers.forEach(provider => {
      // First, add items from professionVideo if any
      if (provider.professionVideo && Array.isArray(provider.professionVideo)) {
        provider.professionVideo.forEach((video, index) => {
          // Skip items an admin has hidden
          if (typeof video === 'object' && video.hidden) return;
          const videoUrl = typeof video === 'string' ? video : video.url;
          console.log('🔍 [Reels Debug] Creating profession reel for', provider.fullName, 'videoUrl:', videoUrl);
          providerPortfolioItems.push({
            _id: `provider:${provider._id}:profession:${index}`,
            user: provider,
            type: 'video',
            videoUrl,
            imageUrl: undefined,
            caption: provider.bio || provider.profession || 'Professional video',
            likes: video.likes || [],
            comments: video.comments || [],
            views: video.views || 0,
            shares: video.shares || 0,
            isActive: true,
            createdAt: video.createdAt || new Date(Date.now() - index * 1000),
            isProviderReel: true,
            source: 'professionVideo',
            sourceIndex: index
          });
        });
      }

      // Then add items from portfolioMedia if any
      if (provider.portfolioMedia && Array.isArray(provider.portfolioMedia)) {
        provider.portfolioMedia.forEach((media, index) => {
          // Skip items an admin has hidden
          if (typeof media === 'object' && media.hidden) return;
          const mediaType = media.type || (media.url?.match(/\.(mp4|webm|mov)$/i) ? 'video' : 'image');
          // Reels feed shows videos only — skip images
          if (mediaType !== 'video') return;
          const url = typeof media === 'string' ? media : media.url;
          console.log('🔍 [Reels Debug] Creating portfolio reel for', provider.fullName, 'type:', mediaType, 'url:', url);
          providerPortfolioItems.push({
            _id: `provider:${provider._id}:portfolio:${index}`,
            user: provider,
            type: mediaType,
            videoUrl: mediaType === 'video' ? url : undefined,
            imageUrl: mediaType === 'image' ? url : undefined,
            caption: provider.bio || provider.profession || '',
            likes: media.likes || [],
            comments: media.comments || [],
            views: media.views || 0,
            shares: media.shares || 0,
            isActive: true,
            createdAt: media.createdAt || new Date(Date.now() - index * 1000),
            isProviderReel: true,
            source: 'portfolioMedia',
            sourceIndex: index
          });
        });
      }

      // Reels feed is video-only, so no profile-photo image fallback.
    });

    console.log('🔍 [Reels Debug] Created providerPortfolioItems:', providerPortfolioItems.length, providerPortfolioItems);

    // Combine reels and provider portfolio items — videos only
    let combinedItems = [...reels, ...providerPortfolioItems].filter(
      item => item.type === 'video' && (item.videoUrl)
    );

    // If user is logged in, prioritize items from followed users
    if (userId) {
      const currentUser = await User.findById(userId).select('following');
      const followingIds = currentUser.following.map(id => id.toString());

      // Sort combined items: following first, then videos before images, then by engagement
      combinedItems.sort((a, b) => {
        const aIsFollowing = followingIds.includes(a.user._id.toString());
        const bIsFollowing = followingIds.includes(b.user._id.toString());

        // Step 1: Following users first
        if (aIsFollowing && !bIsFollowing) return -1;
        if (!aIsFollowing && bIsFollowing) return 1;

        // Step 2: Videos before images
        const aIsVideo = a.type === 'video';
        const bIsVideo = b.type === 'video';
        if (aIsVideo && !bIsVideo) return -1;
        if (!aIsVideo && bIsVideo) return 1;

        // Step 3: Engagement score
        const aScore = (a.views || 0) * 0.5 + (a.likes?.length || 0) * 0.3 + (a.shares || 0) * 0.2;
        const bScore = (b.views || 0) * 0.5 + (b.likes?.length || 0) * 0.3 + (b.shares || 0) * 0.2;
        return bScore - aScore;
      });
    } else {
      // If not logged in: videos first, then engagement
      combinedItems.sort((a, b) => {
        // Step 1: Videos before images
        const aIsVideo = a.type === 'video';
        const bIsVideo = b.type === 'video';
        if (aIsVideo && !bIsVideo) return -1;
        if (!aIsVideo && bIsVideo) return 1;

        // Step 2: Engagement score
        const aScore = (a.views || 0) * 0.5 + (a.likes?.length || 0) * 0.3 + (a.shares || 0) * 0.2;
        const bScore = (b.views || 0) * 0.5 + (b.likes?.length || 0) * 0.3 + (b.shares || 0) * 0.2;
        return bScore - aScore;
      });
    }

    // Apply pagination
    const total = combinedItems.length;
    const start = (page - 1) * limit;
    const pagedItems = combinedItems.slice(start, start + limit);

    res.status(200).json({
      success: true,
      data: pagedItems,
      pagination: {
        page,
        limit,
        total,
        hasMore: start + limit < total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single reel
// @route   GET /api/reels/:id
// @access  Public
const getReel = async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.id).populate('user', '_id fullName profilePhoto');
    if (!reel) return next(new AppError('Reel not found', 404));
    res.status(200).json({ success: true, data: reel });
  } catch (error) {
    next(error);
  }
};

// @desc    Like/Unlike a reel
// @route   PUT /api/reels/:id/like
// @access  Private
const toggleLikeReel = async (req, res, next) => {
  try {
    const reelId = req.params.id;
    const userId = req.user._id;

    // Check if it's a provider reel
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source = parts[2]; // 'profession', 'portfolio', or 'profile'
      const sourceIndex = parseInt(parts[3]);

      const provider = await User.findById(providerId);
      if (!provider) return next(new AppError('Provider not found', 404));

      let targetArray;
      if (source === 'profession') {
        targetArray = provider.professionVideo;
      } else if (source === 'portfolio') {
        targetArray = provider.portfolioMedia;
      } else if (source === 'profile') {
        // Profile fallback doesn't support likes, just return success
        return res.status(200).json({ success: true, isLiked: false });
      }

      if (!targetArray || !targetArray[sourceIndex]) {
        return next(new AppError('Reel not found', 404));
      }

      const item = targetArray[sourceIndex];
      const isLiked = item.likes.some(id => id.toString() === userId.toString());
      
      if (isLiked) {
        item.likes = item.likes.filter(id => id.toString() !== userId.toString());
      } else {
        item.likes.push(userId);
      }

      await provider.save();

      // Send notification to provider on LIKE (not unlike)
      if (!isLiked && providerId !== userId.toString()) {
        const liker = await User.findById(userId).select('fullName');
        createNotification({
          userId: providerId,
          title: '❤️ New Like',
          message: `${liker?.fullName || 'Someone'} liked your reel`,
          type: 'system',
          data: { reelId, action: 'like' },
          sendPush: true,
        }).catch(err => console.error('Like notification error:', err));
      }

      // Return a full reel-shaped response so frontend doesn't crash
      const url = typeof item === 'string' ? item : (item.url || '');
      const isVideo = url.match(/\.(mp4|webm|mov)$/i) || source === 'profession';
      return res.status(200).json({
        success: true,
        data: {
          _id: reelId,
          type: isVideo ? 'video' : 'image',
          videoUrl: isVideo ? url : null,
          imageUrl: !isVideo ? url : null,
          caption: provider.bio || provider.profession || '',
          user: { _id: provider._id, fullName: provider.fullName, profilePhoto: provider.profilePhoto },
          likes: item.likes || [],
          views: item.views || 0,
          shares: item.shares || 0,
          isProviderReel: true,
        },
        isLiked: !isLiked,
      });
    }

    // Handle regular reel
    const reel = await Reel.findById(reelId);
    if (!reel) return next(new AppError('Reel not found', 404));

    const isLiked = reel.likes.includes(userId);
    if (isLiked) {
      reel.likes.pull(userId);
    } else {
      reel.likes.push(userId);
    }
    await reel.save();

    // Send notification to reel owner on LIKE (not unlike)
    if (!isLiked && reel.user && reel.user.toString() !== userId.toString()) {
      const liker = await User.findById(userId).select('fullName');
      createNotification({
        userId: reel.user.toString(),
        title: '❤️ New Like',
        message: `${liker?.fullName || 'Someone'} liked your reel`,
        type: 'system',
        data: { reelId, action: 'like' },
        sendPush: true,
      }).catch(err => console.error('Like notification error:', err));
    }

    res.status(200).json({ success: true, data: reel, isLiked: !isLiked });
  } catch (error) {
    next(error);
  }
};

// @desc    Add comment to reel
// @route   POST /api/reels/:id/comments
// @access  Private
const addComment = async (req, res, next) => {
  try {
    const { text } = req.body;
    const reelId = req.params.id;
    const userId = req.user._id;

    // Check if it's a provider reel
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source = parts[2];
      const sourceIndex = parseInt(parts[3]);

      const provider = await User.findById(providerId);
      if (!provider) return next(new AppError('Provider not found', 404));

      let targetArray;
      if (source === 'profession') {
        targetArray = provider.professionVideo;
      } else if (source === 'portfolio') {
        targetArray = provider.portfolioMedia;
      } else if (source === 'profile') {
        // Profile fallback doesn't support comments
        return res.status(400).json({ success: false, message: 'Comments not supported for this reel' });
      }

      if (!targetArray || !targetArray[sourceIndex]) {
        return next(new AppError('Reel not found', 404));
      }

      const newComment = { user: userId, text };
      targetArray[sourceIndex].comments.push(newComment);

      await provider.save();

      // Send notification to provider about new comment
      if (providerId !== userId.toString()) {
        const commenter = await User.findById(userId, '_id fullName profilePhoto');
        createNotification({
          userId: providerId,
          title: '💬 New Comment',
          message: `${commenter?.fullName || 'Someone'} commented: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
          type: 'system',
          data: { reelId, action: 'comment' },
          sendPush: true,
        }).catch(err => console.error('Comment notification error:', err));

        // Populate user info for the new comment
        const populatedComment = { ...newComment, user: commenter, _id: new Date().getTime() };
        return res.status(201).json({ success: true, data: populatedComment });
      }

      // Populate user info for the new comment
      const user = await User.findById(userId, '_id fullName profilePhoto');
      const populatedComment = { ...newComment, user, _id: new Date().getTime() };

      return res.status(201).json({ success: true, data: populatedComment });
    }

    // Handle regular reel
    const comment = await ReelComment.create({
      reel: reelId,
      user: userId,
      text,
    });

    // Populate user info
    const populatedComment = await ReelComment.findById(comment._id).populate('user', '_id fullName profilePhoto');

    // Send notification to reel owner about new comment
    const reelForNotif = await Reel.findById(reelId).select('user');
    if (reelForNotif?.user && reelForNotif.user.toString() !== userId.toString()) {
      const commenter = await User.findById(userId).select('fullName');
      createNotification({
        userId: reelForNotif.user.toString(),
        title: '💬 New Comment',
        message: `${commenter?.fullName || 'Someone'} commented: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        type: 'system',
        data: { reelId, action: 'comment' },
        sendPush: true,
      }).catch(err => console.error('Comment notification error:', err));
    }

    res.status(201).json({ success: true, data: populatedComment });
  } catch (error) {
    next(error);
  }
};

// @desc    Get comments for a reel
// @route   GET /api/reels/:id/comments
// @access  Public
const getReelComments = async (req, res, next) => {
  try {
    const reelId = req.params.id;

    // Check if it's a provider reel
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source = parts[2];
      const sourceIndex = parseInt(parts[3]);

      const provider = await User.findById(providerId);
      if (!provider) return next(new AppError('Provider not found', 404));

      let targetArray;
      if (source === 'profession') {
        targetArray = provider.professionVideo;
      } else if (source === 'portfolio') {
        targetArray = provider.portfolioMedia;
      } else if (source === 'profile') {
        return res.status(200).json({ success: true, data: [] });
      }

      if (!targetArray || !targetArray[sourceIndex]) {
        return next(new AppError('Reel not found', 404));
      }

      // Populate user info for comments
      const comments = targetArray[sourceIndex].comments || [];
      const userIds = comments.map(c => c.user);
      const users = await User.find({ _id: { $in: userIds } }, '_id fullName profilePhoto');
      const userMap = {};
      users.forEach(u => userMap[u._id.toString()] = u);

      const populatedComments = comments.map((c, i) => {
        // Handle both Mongoose subdocuments and plain objects
        const commentObj = c._doc || (c.toObject ? c.toObject() : c);
        const userId = commentObj.user?._id || commentObj.user;
        return {
          _id: commentObj._id || new Date().getTime() + i,
          text: commentObj.text || '',
          createdAt: commentObj.createdAt,
          user: userMap[userId?.toString()] || { fullName: 'Anonymous' },
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json({ success: true, data: populatedComments });
    }

    // Handle regular reel
    const comments = await ReelComment.find({ reel: reelId }).populate('user', '_id fullName profilePhoto').sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    next(error);
  }
};

// @desc    Increment reel views
// @route   PUT /api/reels/:id/view
// @access  Public
const incrementReelViews = async (req, res, next) => {
  try {
    const reelId = req.params.id;

    // Check if it's a provider reel
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source = parts[2];
      const sourceIndex = parseInt(parts[3]);

      const provider = await User.findById(providerId);
      if (!provider) return next(new AppError('Provider not found', 404));

      let targetArray;
      if (source === 'profession') {
        targetArray = provider.professionVideo;
      } else if (source === 'portfolio') {
        targetArray = provider.portfolioMedia;
      } else if (source === 'profile') {
        // Profile fallback doesn't track views
        return res.status(200).json({ success: true });
      }

      if (!targetArray || !targetArray[sourceIndex]) {
        return next(new AppError('Reel not found', 404));
      }

      targetArray[sourceIndex].views += 1;
      await provider.save();

      return res.status(200).json({ success: true, data: targetArray[sourceIndex] });
    }

    // Handle regular reel
    const reel = await Reel.findByIdAndUpdate(
      reelId,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('user', '_id fullName profilePhoto');

    if (!reel) return next(new AppError('Reel not found', 404));

    res.status(200).json({ success: true, data: reel });
  } catch (error) {
    next(error);
  }
};

// @desc    Increment reel shares
// @route   PUT /api/reels/:id/share
// @access  Public
const incrementReelShares = async (req, res, next) => {
  try {
    const reelId = req.params.id;

    // Check if it's a provider reel
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source = parts[2];
      const sourceIndex = parseInt(parts[3]);

      const provider = await User.findById(providerId);
      if (!provider) return next(new AppError('Provider not found', 404));

      let targetArray;
      if (source === 'profession') {
        targetArray = provider.professionVideo;
      } else if (source === 'portfolio') {
        targetArray = provider.portfolioMedia;
      } else if (source === 'profile') {
        return res.status(200).json({ success: true });
      }

      if (!targetArray || !targetArray[sourceIndex]) {
        return next(new AppError('Reel not found', 404));
      }

      targetArray[sourceIndex].shares += 1;
      await provider.save();

      // Send notification to provider about share
      if (req.user && providerId !== req.user._id.toString()) {
        const sharer = await User.findById(req.user._id).select('fullName');
        createNotification({
          userId: providerId,
          title: '🔗 Reel Shared',
          message: `${sharer?.fullName || 'Someone'} shared your reel`,
          type: 'system',
          data: { reelId, action: 'share' },
          sendPush: true,
        }).catch(err => console.error('Share notification error:', err));
      }

      return res.status(200).json({ success: true, data: targetArray[sourceIndex] });
    }

    // Handle regular reel
    const reel = await Reel.findByIdAndUpdate(
      reelId,
      { $inc: { shares: 1 } },
      { new: true }
    ).populate('user', '_id fullName profilePhoto');

    if (!reel) return next(new AppError('Reel not found', 404));

    // Send notification to reel owner about share
    if (req.user && reel.user && reel.user._id && reel.user._id.toString() !== req.user._id.toString()) {
      const sharer = await User.findById(req.user._id).select('fullName');
      createNotification({
        userId: reel.user._id.toString(),
        title: '🔗 Reel Shared',
        message: `${sharer?.fullName || 'Someone'} shared your reel`,
        type: 'system',
        data: { reelId, action: 'share' },
        sendPush: true,
      }).catch(err => console.error('Share notification error:', err));
    }

    res.status(200).json({ success: true, data: reel });
  } catch (error) {
    next(error);
  }
};

// @desc    Get reels by a specific user
// @route   GET /api/reels/user/:userId
// @access  Public
const getUserReels = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Only show reels if the owner is a verified, active, visible, non-deleted provider.
    const owner = await User.findOne({
      _id: userId,
      isServiceProvider: true,
      isProfileHidden: false,
      status: 'active',
      providerVerificationStatus: 'verified',
      isDeleted: { $ne: true },
    }).select('_id');

    if (!owner) {
      return res.status(200).json({ success: true, data: [] });
    }

    const reels = await Reel.find({ user: userId, isActive: true }).sort({ createdAt: -1 }).populate('user', '_id fullName profilePhoto');
    res.status(200).json({ success: true, data: reels });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete reel
// @route   DELETE /api/reels/:id
// @access  Private
const deleteReel = async (req, res, next) => {
  try {
    const reelId = req.params.id;
    const userId = req.user._id;

    const reel = await Reel.findById(reelId);
    if (!reel) return next(new AppError('Reel not found', 404));
    if (reel.user.toString() !== userId.toString()) return next(new AppError('Not authorized to delete this reel', 403));

    await Reel.findByIdAndDelete(reelId);
    await ReelComment.deleteMany({ reel: reelId });
    res.status(200).json({ success: true, message: 'Reel deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single reel by ID — works for BOTH real Reel IDs and provider synthetic IDs
// @route   GET /api/reels/by-id/:id
// @access  Public
const getReelById = async (req, res, next) => {
  try {
    const reelId = req.params.id;

    // ── Provider synthetic ID: provider:{userId}:{source}:{index} ──────────
    if (reelId.startsWith('provider:')) {
      const parts = reelId.split(':');
      const providerId = parts[1];
      const source     = parts[2]; // 'profession' | 'portfolio' | 'profile'
      const sourceIndex = parseInt(parts[3]) || 0;

      const provider = await User.findById(providerId)
        .select('_id fullName profilePhoto bio profession professionVideo portfolioMedia');
      if (!provider) return next(new AppError('Provider not found', 404));

      let item;
      if (source === 'profession') {
        item = provider.professionVideo?.[sourceIndex];
      } else if (source === 'portfolio') {
        item = provider.portfolioMedia?.[sourceIndex];
      } else {
        // 'profile' fallback — no media item, just provider info
        return res.status(200).json({
          success: true,
          data: {
            _id: reelId,
            type: 'image',
            imageUrl: provider.profilePhoto,
            videoUrl: null,
            caption: provider.bio || provider.profession || '',
            user: { _id: provider._id, fullName: provider.fullName, profilePhoto: provider.profilePhoto },
            likes: [],
            views: 0,
            shares: 0,
            isProviderReel: true,
          },
        });
      }

      if (!item) return next(new AppError('Reel not found', 404));

      const url = typeof item === 'string' ? item : (item.url || '');
      const isVideo = url.match(/\.(mp4|webm|mov)$/i) || source === 'profession';

      return res.status(200).json({
        success: true,
        data: {
          _id: reelId,
          type: isVideo ? 'video' : 'image',
          videoUrl: isVideo ? url : null,
          imageUrl: !isVideo ? url : null,
          caption: provider.bio || provider.profession || '',
          user: { _id: provider._id, fullName: provider.fullName, profilePhoto: provider.profilePhoto },
          likes: item.likes || [],
          views: item.views || 0,
          shares: item.shares || 0,
          isProviderReel: true,
        },
      });
    }

    // ── Real MongoDB reel ID ────────────────────────────────────────────────
    const reel = await Reel.findById(reelId).populate('user', '_id fullName profilePhoto');
    if (!reel || !reel.isActive) return next(new AppError('Reel not found', 404));

    res.status(200).json({ success: true, data: reel });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReel,
  getReels,
  getReel,
  getReelById,
  toggleLikeReel,
  addComment,
  getReelComments,
  incrementReelViews,
  incrementReelShares,
  getUserReels,
  deleteReel,
};
