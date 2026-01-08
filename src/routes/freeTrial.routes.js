const express = require("express");
const router = express.Router();
const { User, Guest } = require("../models");
const { protect } = require("../middlewares/auth");

// Check if user is eligible for first-time free trial
router.get("/check-eligibility", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log(
      `🎯 Checking free trial eligibility for user ${userId} (guest: ${isGuest})`
    );

    let userModel;
    if (isGuest) {
      userModel = await Guest.findById(userId);
    } else {
      userModel = await User.findById(userId);
    }

    if (!userModel) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has used their one-time free trial
    const hasUsedFreeTrial = userModel.hasUsedFreeTrialCall || false;
    const isEligibleForFreeTrial = !hasUsedFreeTrial;

    console.log(
      `🎯 Free trial eligibility result: eligible=${isEligibleForFreeTrial}, hasUsed=${hasUsedFreeTrial}`
    );

    res.json({
      success: true,
      data: {
        isEligibleForFreeTrial,
        hasUsedFreeTrial,
        freeTrialUsedAt: userModel.freeTrialUsedAt,
        userType: isGuest ? "guest" : "regular",
      },
    });
  } catch (error) {
    console.error("Error checking free trial eligibility:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check free trial eligibility",
      error: error.message,
    });
  }
});

// Mark free trial as used
router.post("/mark-used", protect, async (req, res) => {
  try {
    const { consultationId } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    console.log(
      `🎯 Marking free trial as used for user ${userId}, consultation ${consultationId}`
    );

    let updateResult;
    if (isGuest) {
      updateResult = await Guest.findByIdAndUpdate(
        userId,
        {
          hasUsedFreeTrialCall: true,
          freeTrialUsedAt: new Date(),
          freeTrialConsultationId: consultationId,
        },
        { new: true }
      );
    } else {
      updateResult = await User.findByIdAndUpdate(
        userId,
        {
          hasUsedFreeTrialCall: true,
          freeTrialUsedAt: new Date(),
          freeTrialConsultationId: consultationId,
        },
        { new: true }
      );
    }

    if (!updateResult) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`✅ Free trial marked as used for user ${userId}`);

    res.json({
      success: true,
      message: "Free trial marked as used",
      data: {
        hasUsedFreeTrial: true,
        freeTrialUsedAt: updateResult.freeTrialUsedAt,
        consultationId,
      },
    });
  } catch (error) {
    console.error("Error marking free trial as used:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark free trial as used",
      error: error.message,
    });
  }
});

module.exports = router;
