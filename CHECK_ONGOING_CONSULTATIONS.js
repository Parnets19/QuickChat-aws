const mongoose = require("mongoose");
const { Consultation, User } = require("./src/models");
require("dotenv").config();

/**
 * CHECK: Find any ongoing consultations and end them
 */

const connectDB = async () => {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

async function checkOngoingConsultations() {
  console.log("🔍 CHECKING ONGOING CONSULTATIONS");
  console.log("=".repeat(50));

  try {
    await connectDB();

    // Find all ongoing consultations
    const ongoingConsultations = await Consultation.find({
      status: "ongoing",
    })
      .populate("user", "fullName")
      .populate("provider", "fullName");

    console.log(
      `📋 FOUND ${ongoingConsultations.length} ONGOING CONSULTATIONS:`
    );

    if (ongoingConsultations.length === 0) {
      console.log("✅ No ongoing consultations found");
      process.exit(0);
      return;
    }

    for (let i = 0; i < ongoingConsultations.length; i++) {
      const consultation = ongoingConsultations[i];
      console.log(`\n${i + 1}. CONSULTATION ${consultation._id}:`);
      console.log(`   Client: ${consultation.user?.fullName || "Unknown"}`);
      console.log(
        `   Provider: ${consultation.provider?.fullName || "Unknown"}`
      );
      console.log(`   Type: ${consultation.type}`);
      console.log(`   Rate: ₹${consultation.rate}/min`);
      console.log(`   Status: ${consultation.status}`);
      console.log(`   Created: ${consultation.createdAt}`);
      console.log(`   Started: ${consultation.startTime || "Not started"}`);
      console.log(
        `   Both Accepted: ${consultation.bothSidesAcceptedAt || "No"}`
      );
      console.log(`   Billing Started: ${consultation.billingStarted}`);

      // Check how long it's been ongoing
      const now = new Date();
      const createdMinutesAgo = Math.floor(
        (now - consultation.createdAt) / (1000 * 60)
      );
      console.log(`   Created ${createdMinutesAgo} minutes ago`);

      if (consultation.startTime) {
        const startedMinutesAgo = Math.floor(
          (now - consultation.startTime) / (1000 * 60)
        );
        console.log(`   Started ${startedMinutesAgo} minutes ago`);
      }

      // If consultation is older than 10 minutes, it's likely stuck
      if (createdMinutesAgo > 10) {
        console.log(`   🚨 STUCK CONSULTATION - Auto-ending...`);

        // End the stuck consultation
        consultation.status = "completed";
        consultation.endTime = now;
        consultation.endReason = "system_cleanup";
        consultation.duration = 0;
        consultation.totalAmount = 0;

        await consultation.save();
        console.log(`   ✅ Consultation ended automatically`);
      }
    }

    // Check again after cleanup
    const remainingOngoing = await Consultation.find({
      status: "ongoing",
    });

    console.log(`\n📊 SUMMARY:`);
    console.log(
      `   Total ongoing before cleanup: ${ongoingConsultations.length}`
    );
    console.log(
      `   Remaining ongoing after cleanup: ${remainingOngoing.length}`
    );

    if (remainingOngoing.length > 0) {
      console.log(`\n🔧 MANUAL ACTION NEEDED:`);
      console.log(
        `   There are still ${remainingOngoing.length} ongoing consultations`
      );
      console.log(`   These may be legitimate active calls`);
    } else {
      console.log(`\n✅ ALL STUCK CONSULTATIONS CLEANED UP`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Check failed:", error);
    process.exit(1);
  }
}

checkOngoingConsultations();
