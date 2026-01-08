const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * Debug the live issue - check for consultations created in the last few minutes
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

async function debugLiveIssue() {
  console.log("🚨 DEBUGGING LIVE CALL ISSUE");
  console.log("=".repeat(60));
  console.log("Checking for consultations created in the last 10 minutes...");

  try {
    await connectDB();

    // Check for very recent consultations (last 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    console.log(
      `\n🔍 Looking for consultations since: ${tenMinutesAgo.toLocaleString()}`
    );

    const recentConsultations = await Consultation.find({
      createdAt: { $gte: tenMinutesAgo },
    })
      .populate("user provider")
      .sort({ createdAt: -1 });

    console.log(
      `\n📋 Found ${recentConsultations.length} consultations in last 10 minutes:`
    );

    if (recentConsultations.length === 0) {
      console.log("❌ No recent consultations found");
      console.log("   This might mean:");
      console.log(
        "   1. The consultation was created more than 10 minutes ago"
      );
      console.log("   2. The consultation creation failed");
      console.log("   3. Different database/collection being used");
    } else {
      recentConsultations.forEach((consultation, index) => {
        console.log(`\n${index + 1}. 🔥 LIVE CONSULTATION ${consultation._id}`);
        console.log(`   Client: ${consultation.user?.fullName || "Unknown"}`);
        console.log(
          `   Provider: ${consultation.provider?.fullName || "Unknown"}`
        );
        console.log(`   Type: ${consultation.type}`);
        console.log(`   Status: ${consultation.status} 🚨`);
        console.log(`   Rate: ₹${consultation.rate}/min`);
        console.log(`   Created: ${consultation.createdAt}`);
        console.log(`   Billing Started: ${consultation.billingStarted}`);
        console.log(
          `   Both Sides Accepted: ${
            consultation.bothSidesAcceptedAt ? "Yes" : "No"
          }`
        );
        console.log(`   Duration: ${consultation.duration || 0} min`);
        console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);

        if (consultation.status === "ongoing") {
          console.log(`   🚨 STUCK CALL DETECTED!`);

          if (consultation.bothSidesAcceptedAt) {
            const now = new Date();
            const runningMinutes =
              (now - consultation.bothSidesAcceptedAt) / (1000 * 60);
            const expectedCharge = runningMinutes * consultation.rate;
            console.log(
              `   ⏰ Running for: ${runningMinutes.toFixed(2)} minutes`
            );
            console.log(`   💰 Expected charge: ₹${expectedCharge.toFixed(2)}`);
            console.log(
              `   💰 Recorded charge: ₹${consultation.totalAmount || 0}`
            );

            if (runningMinutes > 1) {
              console.log(`   🚨 NEEDS IMMEDIATE FIX!`);
            }
          }
        }
      });
    }

    // Check ALL ongoing consultations (not just recent)
    console.log("\n📋 ALL ONGOING CONSULTATIONS (any time):");
    const allOngoing = await Consultation.find({
      status: "ongoing",
    })
      .populate("user provider")
      .sort({ createdAt: -1 });

    if (allOngoing.length === 0) {
      console.log("✅ No ongoing consultations found in database");
    } else {
      console.log(`🚨 Found ${allOngoing.length} ongoing consultations:`);

      allOngoing.forEach((consultation, index) => {
        console.log(`\n${index + 1}. ONGOING: ${consultation._id}`);
        console.log(`   Client: ${consultation.user?.fullName || "Unknown"}`);
        console.log(
          `   Provider: ${consultation.provider?.fullName || "Unknown"}`
        );
        console.log(`   Created: ${consultation.createdAt}`);
        console.log(
          `   Age: ${(
            (Date.now() - consultation.createdAt) /
            (1000 * 60)
          ).toFixed(1)} minutes`
        );

        if (consultation.bothSidesAcceptedAt) {
          const runningMinutes =
            (Date.now() - consultation.bothSidesAcceptedAt) / (1000 * 60);
          console.log(`   🕐 Running: ${runningMinutes.toFixed(2)} minutes`);
          console.log(
            `   💰 Should charge: ₹${(
              runningMinutes * consultation.rate
            ).toFixed(2)}`
          );
        }
      });
    }

    // Check Nandu and Sai current wallet balances
    console.log("\n💰 CURRENT WALLET BALANCES:");

    const nandu = await User.findOne({
      $or: [{ email: "nandu@example.com" }, { fullName: { $regex: /nandu/i } }],
    });

    const sai = await User.findOne({
      $or: [{ email: "sai@example.com" }, { fullName: { $regex: /sai/i } }],
    });

    if (nandu) {
      console.log(`👤 Nandu: ₹${nandu.wallet} (was ₹5 before call)`);
    }

    if (sai) {
      console.log(`👤 Sai: ₹${sai.wallet} (was ₹33.27 before call)`);
    }

    // Check very recent transactions (last 5 minutes)
    console.log("\n💳 VERY RECENT TRANSACTIONS (last 5 minutes):");
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const veryRecentTransactions = await Transaction.find({
      createdAt: { $gte: fiveMinutesAgo },
    }).sort({ createdAt: -1 });

    if (veryRecentTransactions.length === 0) {
      console.log("❌ No transactions in last 5 minutes");
    } else {
      veryRecentTransactions.forEach((transaction, index) => {
        console.log(`\n${index + 1}. ${transaction.type.toUpperCase()}`);
        console.log(`   User: ${transaction.user}`);
        console.log(`   Amount: ₹${transaction.amount}`);
        console.log(`   Balance: ₹${transaction.balance}`);
        console.log(`   Time: ${transaction.createdAt}`);
        console.log(`   Description: ${transaction.description}`);
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎯 LIVE ISSUE ANALYSIS:");

    if (allOngoing.length > 0) {
      console.log("🚨 CONFIRMED: Found ongoing consultations in database");
      console.log("   Frontend is showing correct backend state");
      console.log("   Problem: Backend consultation not properly ended");

      console.log("\n🔧 IMMEDIATE ACTIONS:");
      console.log("   1. Run emergency fix to end stuck consultations");
      console.log("   2. Process proper billing for actual duration");
      console.log("   3. Fix frontend endCall function to be more robust");
    } else {
      console.log("🤔 MYSTERY: No ongoing consultations in database");
      console.log("   But frontend shows ongoing - possible causes:");
      console.log("   1. Frontend cache/state not updated");
      console.log("   2. Different database being queried");
      console.log("   3. Race condition in status updates");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Debug failed:", error);
    process.exit(1);
  }
}

debugLiveIssue();
