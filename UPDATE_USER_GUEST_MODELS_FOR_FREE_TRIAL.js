/**
 * UPDATE USER AND GUEST MODELS FOR FIRST TIME FREE TRIAL
 *
 * This script adds new fields to User and Guest models to track
 * the one-time free trial usage (instead of per-provider free minutes)
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { User, Guest } = require("./src/models");

async function updateModelsForFreeTrial() {
  try {
    console.log("🔄 Connecting to database...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    console.log("🔄 Updating User model for First Time Free Trial...");

    // Add new fields to all users
    const userUpdateResult = await User.updateMany(
      {},
      {
        $set: {
          hasUsedFreeTrialCall: false, // Has user used their one-time free trial?
          freeTrialUsedAt: null, // When was the free trial used?
          freeTrialConsultationId: null, // Which consultation was the free trial?
        },
      }
    );

    console.log("✅ User model updates:", userUpdateResult);

    console.log("🔄 Updating Guest model for First Time Free Trial...");

    const guestUpdateResult = await Guest.updateMany(
      {},
      {
        $set: {
          hasUsedFreeTrialCall: false,
          freeTrialUsedAt: null,
          freeTrialConsultationId: null,
        },
      }
    );

    console.log("✅ Guest model updates:", guestUpdateResult);

    // For existing users who have freeMinutesUsed entries, mark them as having used free trial
    console.log(
      "🔄 Migrating existing free minute users to free trial system..."
    );

    const usersWithFreeMinutes = await User.find({
      freeMinutesUsed: { $exists: true, $not: { $size: 0 } },
    });

    console.log(
      `📊 Found ${usersWithFreeMinutes.length} users with existing free minutes`
    );

    for (const user of usersWithFreeMinutes) {
      if (user.freeMinutesUsed && user.freeMinutesUsed.length > 0) {
        const firstFreeMinute = user.freeMinutesUsed[0];
        await User.findByIdAndUpdate(user._id, {
          hasUsedFreeTrialCall: true,
          freeTrialUsedAt: firstFreeMinute.usedAt,
          freeTrialConsultationId: firstFreeMinute.consultationId,
        });
        console.log(
          `✅ Migrated user ${user._id} - marked as having used free trial`
        );
      }
    }

    const guestsWithFreeMinutes = await Guest.find({
      freeMinutesUsed: { $exists: true, $not: { $size: 0 } },
    });

    console.log(
      `📊 Found ${guestsWithFreeMinutes.length} guests with existing free minutes`
    );

    for (const guest of guestsWithFreeMinutes) {
      if (guest.freeMinutesUsed && guest.freeMinutesUsed.length > 0) {
        const firstFreeMinute = guest.freeMinutesUsed[0];
        await Guest.findByIdAndUpdate(guest._id, {
          hasUsedFreeTrialCall: true,
          freeTrialUsedAt: firstFreeMinute.usedAt,
          freeTrialConsultationId: firstFreeMinute.consultationId,
        });
        console.log(
          `✅ Migrated guest ${guest._id} - marked as having used free trial`
        );
      }
    }

    console.log("");
    console.log("🎉 FREE TRIAL SYSTEM MIGRATION COMPLETED!");
    console.log("");
    console.log("📊 SUMMARY:");
    console.log(`- Updated ${userUpdateResult.modifiedCount} user records`);
    console.log(`- Updated ${guestUpdateResult.modifiedCount} guest records`);
    console.log(
      `- Migrated ${usersWithFreeMinutes.length} users with existing free minutes`
    );
    console.log(
      `- Migrated ${guestsWithFreeMinutes.length} guests with existing free minutes`
    );
    console.log("");
    console.log("✅ All users now have free trial tracking fields");
    console.log(
      "✅ Existing free minute users marked as having used their free trial"
    );
    console.log("✅ New users will be eligible for first-time free trial");

    await mongoose.disconnect();
    console.log("✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error updating models for free trial:", error);
    process.exit(1);
  }
}

// Run the migration
updateModelsForFreeTrial();
