/**
 * Reset Shivani's free minute usage with Chotibahu to allow fresh testing
 */

const mongoose = require("mongoose");
require("dotenv").config();

// Import models
const { User, Guest, Consultation, Transaction } = require("./src/models");

async function resetShivaniFreeMinte() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find the users
    const shivani = await User.findOne({ email: "shivani@gmail.com" });
    const chotibahu = await User.findOne({ email: "chotibahu123@gmail.com" });

    if (!shivani || !chotibahu) {
      console.log("❌ Users not found");
      return;
    }

    console.log("👤 USERS FOUND:");
    console.log(`Shivani: ${shivani.fullName} (${shivani._id})`);
    console.log(`Chotibahu: ${chotibahu.fullName} (${chotibahu._id})`);

    // Reset Shivani's free minute usage
    console.log("\n🔄 RESETTING SHIVANI'S FREE MINUTE USAGE...");

    // Remove any free minute usage with Chotibahu
    if (shivani.freeMinutesUsed && shivani.freeMinutesUsed.length > 0) {
      shivani.freeMinutesUsed = shivani.freeMinutesUsed.filter(
        (entry) => entry.providerId.toString() !== chotibahu._id.toString()
      );
    } else {
      // Initialize if doesn't exist
      shivani.freeMinutesUsed = [];
    }

    await shivani.save();
    console.log("✅ Shivani's free minute usage reset");

    // Also reset Chotibahu's free minute usage with Shivani (in case they test reverse)
    if (chotibahu.freeMinutesUsed && chotibahu.freeMinutesUsed.length > 0) {
      chotibahu.freeMinutesUsed = chotibahu.freeMinutesUsed.filter(
        (entry) => entry.providerId.toString() !== shivani._id.toString()
      );
    } else {
      chotibahu.freeMinutesUsed = [];
    }

    await chotibahu.save();
    console.log("✅ Chotibahu's free minute usage reset");

    // Delete any existing consultations between them to start fresh
    console.log("\n🗑️ DELETING EXISTING CONSULTATIONS...");
    const deletedConsultations = await Consultation.deleteMany({
      $or: [
        { user: shivani._id, provider: chotibahu._id },
        { user: chotibahu._id, provider: shivani._id },
      ],
    });
    console.log(
      `✅ Deleted ${deletedConsultations.deletedCount} consultations`
    );

    // Delete any existing transactions between them
    console.log("\n🗑️ DELETING EXISTING TRANSACTIONS...");
    const deletedTransactions = await Transaction.deleteMany({
      $or: [
        {
          user: shivani._id,
          description: { $regex: "Choti Bahu", $options: "i" },
        },
        {
          user: chotibahu._id,
          description: { $regex: "Shivani", $options: "i" },
        },
      ],
    });
    console.log(`✅ Deleted ${deletedTransactions.deletedCount} transactions`);

    // Verify the reset
    console.log("\n✅ VERIFICATION:");
    const updatedShivani = await User.findById(shivani._id);
    const updatedChotibahu = await User.findById(chotibahu._id);

    const shivaniHasFreeMinte = !updatedShivani.freeMinutesUsed?.some(
      (entry) => entry.providerId.toString() === chotibahu._id.toString()
    );

    const chotibahu123HasFreeMinte = !updatedChotibahu.freeMinutesUsed?.some(
      (entry) => entry.providerId.toString() === shivani._id.toString()
    );

    console.log(
      `Shivani can use free minute with Chotibahu: ${shivaniHasFreeMinte}`
    );
    console.log(
      `Chotibahu can use free minute with Shivani: ${chotibahu123HasFreeMinte}`
    );

    console.log("\n🎯 READY FOR TESTING:");
    console.log("1. Shivani should now get first minute FREE with Chotibahu");
    console.log("2. No existing consultations or transactions");
    console.log("3. Fresh start for free minute testing");

    mongoose.connection.close();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error:", error);
    mongoose.connection.close();
  }
}

resetShivaniFreeMinte();
