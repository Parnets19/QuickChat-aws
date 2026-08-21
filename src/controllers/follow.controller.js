const { User } = require('../models');
const { AppError } = require('../middlewares/errorHandler');
const { createNotification } = require('../utils/notifications');

// @desc    Follow a provider
// @route   POST /api/follow/:id
// @access  Private
const followUser = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const currentId = req.user._id;

    if (targetId === currentId.toString()) {
      return next(new AppError('You cannot follow yourself', 400));
    }

    const target = await User.findById(targetId);
    if (!target) return next(new AppError('User not found', 404));

    // Already following?
    const alreadyFollowing = target.followers.some(
      (id) => id.toString() === currentId.toString()
    );
    if (alreadyFollowing) {
      return res.status(200).json({ success: true, following: true, message: 'Already following' });
    }

    // Add to target's followers + current user's following
    await Promise.all([
      User.findByIdAndUpdate(targetId, { $addToSet: { followers: currentId } }),
      User.findByIdAndUpdate(currentId, { $addToSet: { following: targetId } }),
    ]);

    // Send notification to the followed provider
    const follower = await User.findById(currentId).select('fullName');
    createNotification({
      userId: targetId,
      title: '👤 New Follower',
      message: `${follower?.fullName || 'Someone'} started following you`,
      type: 'system',
      data: { followerId: currentId.toString(), action: 'follow' },
      sendPush: true,
    }).catch(err => console.error('Follow notification error:', err));

    res.status(200).json({ success: true, following: true, message: 'Followed successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Unfollow a provider
// @route   DELETE /api/follow/:id
// @access  Private
const unfollowUser = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const currentId = req.user._id;

    await Promise.all([
      User.findByIdAndUpdate(targetId, { $pull: { followers: currentId } }),
      User.findByIdAndUpdate(currentId, { $pull: { following: targetId } }),
    ]);

    res.status(200).json({ success: true, following: false, message: 'Unfollowed successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if current user follows a specific user
// @route   GET /api/follow/:id/status
// @access  Private
const getFollowStatus = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const currentId = req.user._id;

    const target = await User.findById(targetId).select('followers followersCount');
    if (!target) return next(new AppError('User not found', 404));

    const following = target.followers.some(
      (id) => id.toString() === currentId.toString()
    );

    res.status(200).json({
      success: true,
      data: {
        following,
        followersCount: target.followers.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of providers the current user follows
// @route   GET /api/follow/following
// @access  Private
const getFollowing = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('following')
      .populate('following', '_id fullName profilePhoto profession consultationStatus rating');

    res.status(200).json({ success: true, data: user.following });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk check follow status for multiple provider IDs
// @route   POST /api/follow/bulk-status
// @route   GET  /api/follow/status/bulk?userIds=id1,id2,...
// @access  Private
const getBulkFollowStatus = async (req, res, next) => {
  try {
    // Support both POST body { providerIds: [...] } and GET query ?userIds=id1,id2,...
    let providerIds = req.body?.providerIds;
    if (!providerIds && req.query.userIds) {
      providerIds = req.query.userIds.split(',').map(id => id.trim()).filter(Boolean);
    }

    if (!Array.isArray(providerIds) || providerIds.length === 0) {
      return res.status(200).json({ success: true, data: {} });
    }

    const user = await User.findById(req.user._id).select('following');
    const followingSet = new Set(user.following.map((id) => id.toString()));

    const result = {};
    providerIds.forEach((id) => {
      result[id] = followingSet.has(id.toString());
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { followUser, unfollowUser, getFollowStatus, getFollowing, getBulkFollowStatus };
