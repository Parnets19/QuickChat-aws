const express = require("express");
const router = express.Router();
const { User, Guest, Consultation } = require("../models");
const { protect } = require("../middlewares/auth");

// Check if user has used free minute with a specific provider
router.get("/check/:providerId", protect, async (req, res) => {
  try {
    const { providerId } = req.params;
    const userId = req.user.id;

    // Handle guest users
    if (req.user.isGuest) {
      const guest = await Guest.findById(userId);
      if (!guest) {
        return res.status(404).json({
          success: false,
          message: "Guest user not found",
        });
      }

      // Check if guest has used free minute with this provider (in freeMinutesUsed array)
      const hasUsedFreeMinute = guest.freeMinutesUsed?.some(
        (entry) => entry.providerId.toString() === providerId
      );

      // CRITICAL FIX: Also check if they have ANY completed consultations with this provider
      // If they do, they should NOT see "first time free" even if freeMinutesUsed is empty
      const completedConsultations = await Consultation.countDocuments({
        user: userId,
        provider: providerId,
        status: "completed",
        $or: [
          { bothSidesAcceptedAt: { $exists: true } },
          { duration: { $gt: 0 } },
          { startTime: { $exists: true } }
        ]
      });

      const isFirstTime = !hasUsedFreeMinute && completedConsultations === 0;

    

      return res.json({
        success: true,
        data: {
          hasUsedFreeMinute: hasUsedFreeMinute || completedConsultations > 0,
          isFirstTime: isFirstTime,
          userType: "guest",
          completedConsultations,
        },
      });
    }

    // Handle regular users
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has used free minute with this provider (in freeMinutesUsed array)
    const hasUsedFreeMinute = user.freeMinutesUsed?.some(
      (entry) => entry.providerId.toString() === providerId
    );

    // CRITICAL FIX: Also check if they have ANY completed consultations with this provider
    // If they do, they should NOT see "first time free" even if freeMinutesUsed is empty
    const completedConsultations = await Consultation.countDocuments({
      user: userId,
      provider: providerId,
      status: "completed",
      $or: [
        { bothSidesAcceptedAt: { $exists: true } },
        { duration: { $gt: 0 } },
        { startTime: { $exists: true } }
      ]
    });

    const isFirstTime = !hasUsedFreeMinute && completedConsultations === 0;

    console.log(
      `📊 Free minute check result: hasUsed=${hasUsedFreeMinute}, completedCalls=${completedConsultations}, isFirstTime=${isFirstTime}`
    );

    res.json({
      success: true,
      data: {
        hasUsedFreeMinute: hasUsedFreeMinute || completedConsultations > 0,
        isFirstTime: isFirstTime,
        userType: "regular",
        completedConsultations,
      },
    });
  } catch (error) {
    console.error("Error checking free minute status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check free minute status",
      error: error.message,
    });
  }
});

// Mark free minute as used for a specific provider
router.post("/mark-used", protect, async (req, res) => {
  try {
    const { providerId, consultationId } = req.body;
    const userId = req.user.id;

    console.log(
      `✅ Marking free minute as used for user ${userId} with provider ${providerId}`
    );

    // Handle guest users
    if (req.user.isGuest) {
      const guest = await Guest.findById(userId);
      if (!guest) {
        return res.status(404).json({
          success: false,
          message: "Guest user not found",
        });
      }

      // Initialize freeMinutesUsed if it doesn't exist
      if (!guest.freeMinutesUsed) {
        guest.freeMinutesUsed = [];
      }

      // Check if already marked as used
      const alreadyUsed = guest.freeMinutesUsed.some(
        (entry) => entry.providerId.toString() === providerId
      );

      if (!alreadyUsed) {
        guest.freeMinutesUsed.push({
          providerId,
          consultationId,
          usedAt: new Date(),
        });
        await guest.save();
        console.log(
          `✅ Free minute marked as used for guest ${userId} with provider ${providerId}`
        );
      }

      return res.json({
        success: true,
        message: "Free minute status updated",
        data: { alreadyUsed },
      });
    }

    // Handle regular users
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Initialize freeMinutesUsed if it doesn't exist
    if (!user.freeMinutesUsed) {
      user.freeMinutesUsed = [];
    }

    // Check if already marked as used
    const alreadyUsed = user.freeMinutesUsed.some(
      (entry) => entry.providerId.toString() === providerId
    );

    if (!alreadyUsed) {
      user.freeMinutesUsed.push({
        providerId,
        consultationId,
        usedAt: new Date(),
      });
      await user.save();
      console.log(
        `✅ Free minute marked as used for user ${userId} with provider ${providerId}`
      );
    }

    res.json({
      success: true,
      message: "Free minute status updated",
      data: { alreadyUsed },
    });
  } catch (error) {
    console.error("Error marking free minute as used:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark free minute as used",
      error: error.message,
    });
  }
});

// Get list of providers user has used free minutes with
router.get("/used-providers", protect, async (req, res) => {
  try {
    const userId = req.user.id;

    // Handle guest users
    if (req.user.isGuest) {
      const guest = await Guest.findById(userId).populate(
        "freeMinutesUsed.providerId",
        "fullName profession"
      );
      if (!guest) {
        return res.status(404).json({
          success: false,
          message: "Guest user not found",
        });
      }

      return res.json({
        success: true,
        data: {
          freeMinutesUsed: guest.freeMinutesUsed || [],
          userType: "guest",
        },
      });
    }

    // Handle regular users
    const user = await User.findById(userId).populate(
      "freeMinutesUsed.providerId",
      "fullName profession"
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        freeMinutesUsed: user.freeMinutesUsed || [],
        userType: "regular",
      },
    });
  } catch (error) {
    console.error("Error getting used providers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get used providers",
      error: error.message,
    });
  }
});

module.exports = router;
