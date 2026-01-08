const mongoose = require("mongoose");
const { Consultation, User, Guest } = require("./src/models");
require("dotenv").config();

/**
 * Emergency consultation cleanup job
 * Finds and ends consultations that have been running too long without proper termination
 */
async function emergencyConsultationCleanup() {
  try {
    console.log("🚨 EMERGENCY CONSULTATION CLEANUP JOB");
    console.log("=====================================");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago

    // Find consultations that are stuck in ongoing state
    const stuckConsultations = await Consultation.find({
      status: "ongoing",
      $or: [
        // Consultations older than 1 hour
        { startTime: { $lt: oneHourAgo } },
        // Consultations without startTime but created more than 30 minutes ago
        {
          startTime: null,
          createdAt: { $lt: thirtyMinutesAgo },
        },
      ],
    }).populate("user provider");

    console.log(`🔍 Found ${stuckConsultations.length} stuck consultations`);

    if (stuckConsultations.length === 0) {
      console.log("✅ No stuck consultations found");
      await mongoose.disconnect();
      return;
    }

    let cleanedCount = 0;
    let errorCount = 0;

    for (const consultation of stuckConsultations) {
      try {
        console.log(`\n🔧 Cleaning consultation ${consultation._id}:`);
        console.log(`   User: ${consultation.user?.fullName || "Unknown"}`);
        console.log(
          `   Provider: ${consultation.provider?.fullName || "Unknown"}`
        );
        console.log(`   Rate: ₹${consultation.rate}/min`);
        console.log(
          `   Start time: ${consultation.startTime || "Not started"}`
        );
        console.log(`   Created: ${consultation.createdAt}`);

        // Calculate duration and final amount
        let finalDuration = 0;
        let finalAmount = 0;

        if (consultation.startTime) {
          // Calculate actual duration
          const durationMs =
            now.getTime() - new Date(consultation.startTime).getTime();
          finalDuration = Math.round((durationMs / (1000 * 60)) * 100) / 100; // Round to 2 decimal places

          // Calculate amount based on rate
          if (consultation.rate > 0) {
            finalAmount =
              Math.round(finalDuration * consultation.rate * 100) / 100;
          }
        }

        // Update consultation to completed
        const updateResult = await Consultation.findByIdAndUpdate(
          consultation._id,
          {
            status: "completed",
            endTime: now,
            endReason: "emergency_cleanup",
            duration: finalDuration,
            totalAmount: finalAmount,
          },
          { new: true }
        );

        console.log(`   ✅ Updated consultation:`);
        console.log(`   Duration: ${finalDuration} minutes`);
        console.log(`   Final amount: ₹${finalAmount}`);

        // If there was billing, process the final charges
        if (finalAmount > 0 && consultation.user) {
          try {
            const isGuest = consultation.userType === "Guest";
            const UserModel = isGuest ? Guest : User;

            const user = await UserModel.findById(
              consultation.user._id || consultation.user
            );
            const provider = await User.findById(
              consultation.provider._id || consultation.provider
            );

            if (user && provider) {
              // Deduct from user (if they have balance)
              if (user.wallet >= finalAmount) {
                user.wallet -= finalAmount;
                user.totalSpent = (user.totalSpent || 0) + finalAmount;
                await user.save();
                console.log(`   💰 Deducted ₹${finalAmount} from user wallet`);
              } else {
                console.log(
                  `   ⚠️ User has insufficient balance (₹${user.wallet}) for final charge (₹${finalAmount})`
                );
              }

              // Credit provider (95% of amount)
              const providerEarnings =
                Math.round(finalAmount * 0.95 * 100) / 100;
              provider.wallet = (provider.wallet || 0) + providerEarnings;
              provider.earnings = (provider.earnings || 0) + providerEarnings;
              await provider.save();
              console.log(`   💰 Credited ₹${providerEarnings} to provider`);
            }
          } catch (billingError) {
            console.error(
              `   ❌ Error processing final billing:`,
              billingError.message
            );
          }
        }

        cleanedCount++;
      } catch (error) {
        console.error(
          `❌ Error cleaning consultation ${consultation._id}:`,
          error.message
        );
        errorCount++;
      }
    }

    console.log(`\n📊 CLEANUP SUMMARY:`);
    console.log(`✅ Successfully cleaned: ${cleanedCount} consultations`);
    console.log(`❌ Errors: ${errorCount} consultations`);
    console.log(`🕒 Cleanup completed at: ${now.toISOString()}`);

    await mongoose.disconnect();
    console.log("✅ Database connection closed");
  } catch (error) {
    console.error("❌ Emergency cleanup failed:", error);
    process.exit(1);
  }
}

// Run cleanup if called directly
if (require.main === module) {
  emergencyConsultationCleanup()
    .then(() => {
      console.log("🎉 Emergency cleanup completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Emergency cleanup failed:", error);
      process.exit(1);
    });
}

module.exports = emergencyConsultationCleanup;
