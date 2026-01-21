const { User } = require("../models");
const { AppError } = require("../middlewares/errorHandler");

// @desc    Block a user
// @route   POST /api/users/block/:userId
// @access  Private
const blockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const currentUserId = req.user.id || req.user._id;

    if (userId === currentUserId.toString()) {
      return next(new AppError("You cannot block yourself", 400));
    }

    // Check if user exists
    const userToBlock = await User.findById(userId);
    if (!userToBlock) {
      return next(new AppError("User not found", 404));
    }

    // Check if already blocked
    const currentUser = await User.findById(currentUserId);
    const alreadyBlocked = currentUser.blockedUsers.some(
      (blocked) => blocked.userId.toString() === userId
    );

    if (alreadyBlocked) {
      return next(new AppError("User is already blocked", 400));
    }

    // Add to blocked users
    currentUser.blockedUsers.push({
      userId,
      reason: reason || "No reason provided",
      blockedAt: new Date(),
    });

    await currentUser.save();

    console.log(`✅ User ${currentUserId} blocked user ${userId}`);

    res.status(200).json({
      success: true,
      message: "User blocked successfully",
      data: {
        blockedUserId: userId,
        blockedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Unblock a user
// @route   DELETE /api/users/block/:userId
// @access  Private
const unblockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id || req.user._id;

    const currentUser = await User.findById(currentUserId);

    // Remove from blocked users
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (blocked) => blocked.userId.toString() !== userId
    );

    await currentUser.save();

    console.log(`✅ User ${currentUserId} unblocked user ${userId}`);

    res.status(200).json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get blocked users list
// @route   GET /api/users/blocked
// @access  Private
const getBlockedUsers = async (req, res, next) => {
  try {
    const currentUserId = req.user.id || req.user._id;

    const currentUser = await User.findById(currentUserId).populate(
      "blockedUsers.userId",
      "fullName profilePhoto"
    );

    res.status(200).json({
      success: true,
      data: {
        blockedUsers: currentUser.blockedUsers,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Report a user
// @route   POST /api/users/report/:userId
// @access  Private
const reportUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason, description } = req.body;
    const currentUserId = req.user.id || req.user._id;

    if (!reason) {
      return next(new AppError("Reason is required", 400));
    }

    if (userId === currentUserId.toString()) {
      return next(new AppError("You cannot report yourself", 400));
    }

    // Check if user exists
    const userToReport = await User.findById(userId);
    if (!userToReport) {
      return next(new AppError("User not found", 404));
    }

    const currentUser = await User.findById(currentUserId);

    // Add to reported users
    currentUser.reportedUsers.push({
      userId,
      reason,
      description: description || "",
      reportedAt: new Date(),
      status: "pending",
    });

    await currentUser.save();

    console.log(`✅ User ${currentUserId} reported user ${userId} for: ${reason}`);

    res.status(200).json({
      success: true,
      message: "User reported successfully. Our team will review this report.",
      data: {
        reportedUserId: userId,
        reportedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if user is blocked
// @route   GET /api/users/block/check/:userId
// @access  Private
const checkBlockStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id || req.user._id;

    const currentUser = await User.findById(currentUserId);
    const otherUser = await User.findById(userId);

    if (!otherUser) {
      return next(new AppError("User not found", 404));
    }

    // Check if current user blocked the other user
    const isBlockedByMe = currentUser.blockedUsers.some(
      (blocked) => blocked.userId.toString() === userId
    );

    // Check if other user blocked current user
    const isBlockedByThem = otherUser.blockedUsers.some(
      (blocked) => blocked.userId.toString() === currentUserId.toString()
    );

    res.status(200).json({
      success: true,
      data: {
        isBlockedByMe,
        isBlockedByThem,
        isBlocked: isBlockedByMe || isBlockedByThem,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser,
  checkBlockStatus,
};
