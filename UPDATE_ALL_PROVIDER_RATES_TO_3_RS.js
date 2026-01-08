/**
 * UPDATE ALL PROVIDER RATES TO ₹3 PER MINUTE
 *
 * This script updates all service providers to charge ₹3 per minute
 * for audio/video consultations
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { User } = require("./src/models");

async function updateAllProviderRatesTo3Rs() {
  try {
    console.log("🔄 Connecting to database...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    console.log("🔄 Finding all service providers...");

    // Find all users who are service providers
    const providers = await User.find({
      isServiceProvider: true,
    }).select("_id fullName rates");

    console.log(`📊 Found ${providers.length} service providers`);

    let updatedCount = 0;

    for (const provider of providers) {
      console.log(
        `\n🔄 Updating rates for: ${provider.fullName} (${provider._id})`
      );

      // Current rates
      const currentRates = provider.rates || {};
      console.log("   Current rates:", {
        audioVideo: currentRates.perMinute?.audioVideo || 0,
        audio: currentRates.perMinute?.audio || 0,
        video: currentRates.perMinute?.video || 0,
        defaultChargeType: currentRates.defaultChargeType || "per-minute",
      });

      // Update to ₹3 per minute
      const updatedRates = {
        chat: currentRates.chat || 0, // Keep chat rates as they are
        perMinute: {
          audioVideo: 3, // Set to ₹3 per minute
          audio: 3, // Legacy field
          video: 3, // Legacy field
        },
        perHour: {
          audioVideo: currentRates.perHour?.audioVideo || 0, // Keep per-hour rates
          audio: currentRates.perHour?.audio || 0,
          video: currentRates.perHour?.video || 0,
        },
        defaultChargeType: "per-minute", // Ensure per-minute is default
        // Legacy fields for backward compatibility
        audio: 3,
        video: 3,
        chargeType: "per-minute",
      };

      await User.findByIdAndUpdate(provider._id, {
        rates: updatedRates,
      });

      console.log("   ✅ Updated to ₹3/min for audio/video calls");
      updatedCount++;
    }

    console.log("\n🎉 RATE UPDATE COMPLETED!");
    console.log("");
    console.log("📊 SUMMARY:");
    console.log(`- Found ${providers.length} service providers`);
    console.log(`- Updated ${updatedCount} providers to ₹3/min`);
    console.log("- All audio/video calls now charge ₹3 per minute");
    console.log("- Chat rates remain unchanged");
    console.log("");
    console.log(
      "✅ All providers now charge ₹3 per minute for audio/video consultations"
    );

    // Verify the updates
    console.log("\n🔍 VERIFICATION:");
    const verifyProviders = await User.find({
      isServiceProvider: true,
      "rates.perMinute.audioVideo": { $gt: 0 },
    }).select("fullName rates.perMinute.audioVideo");

    console.log("Updated providers with their new rates:");
    verifyProviders.forEach((provider) => {
      console.log(
        `   ${provider.fullName}: ₹${provider.rates.perMinute.audioVideo}/min`
      );
    });

    await mongoose.disconnect();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error updating provider rates:", error);
    process.exit(1);
  }
}

// Run the update
updateAllProviderRatesTo3Rs();
