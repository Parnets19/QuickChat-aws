const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * Simple debug script to check the current call issue
 */

// MongoDB connection
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

async function debugCurrentIssue() {
  console.log("🔍 DEBUGGING CURRENT CALL ISSUE");
  console.log("=".repeat(60));

  try {
    await connectDB();

    // Find Nandu and Sai
    const nandu = await User.findOne({
      $or: [{ email: "nandu@example.com" }, { fullName: { $regex: /nandu/i } }],
    });

    const sai = await User.findOne({
      $or: [{ email: "sai@example.com" }, { fullName: { $regex: /sai/i } }],
    });

    if (nandu) {
      console.log(`👤 Nandu: ${nandu.fullName}`);
      console.log(`   Wallet: ₹${nandu.wallet}`);
      console.log(`   Total Spent: ₹${nandu.totalSpent || 0}`);
    }

    if (sai) {
      console.log(`👤 Sai: ${sai.fullName}`);
      console.log(`   Wallet: ₹${sai.wallet}`);
      console.log(`   Earnings: ₹${sai.earnings || 0}`);
      console.log(
        `   Rate: ₹${
          sai.rates?.audioVideo || sai.rates?.audio || "Not set"
        }/min`
      );
    }

    // Check ongoing consultations
    console.log("\n📋 ONGOING CONSULTATIONS:");
    const ongoingConsultations = await Consultation.find({
      status: "ongoing",
    })
      .populate("user provider")
      .sort({ createdAt: -1 });

    if (ongoingConsultations.length === 0) {
      console.log("✅ No ongoing consultations found");
    } else {
      console.log(
        `🚨 Found ${ongoingConsultations.length} ongoing consultations:`
      );

      ongoingConsultations.forEach((consultation, index) => {
        console.log(`\n${index + 1}. Consultation ${consultation._id}`);
        console.log(`   Client: ${consultation.user?.fullName || "Unknown"}`);
        console.log(
          `   Provider: ${consultation.provider?.fullName || "Unknown"}`
        );
        console.log(`   Type: ${consultation.type}`);
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

        if (consultation.bothSidesAcceptedAt) {
          const now = new Date();
          const runningMinutes =
            (now - consultation.bothSidesAcceptedAt) / (1000 * 60);
          const expectedCharge = runningMinutes * consultation.rate;
          console.log(
            `   🕐 ACTUAL RUNNING TIME: ${runningMinutes.toFixed(2)} minutes`
          );
          console.log(`   💰 EXPECTED CHARGE: ₹${expectedCharge.toFixed(2)}`);

          if (runningMinutes > 10) {
            console.log(
              `   🚨 STUCK CALL: Running for ${runningMinutes.toFixed(
                1
              )} minutes!`
            );
          }
        }
      });
    }

    // Check recent consultations
    console.log("\n📋 RECENT CONSULTATIONS (Last 24 hours):");
    const recentConsultations = await Consultation.find({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .populate("user provider")
      .sort({ createdAt: -1 })
      .limit(5);

    recentConsultations.forEach((consultation, index) => {
      console.log(
        `\n${index + 1}. ${consultation.status.toUpperCase()} - ${
          consultation._id
        }`
      );
      console.log(`   Client: ${consultation.user?.fullName || "Unknown"}`);
      console.log(
        `   Provider: ${consultation.provider?.fullName || "Unknown"}`
      );
      console.log(`   Duration: ${consultation.duration || 0} min`);
      console.log(`   Amount: ₹${consultation.totalAmount || 0}`);
      console.log(`   Created: ${consultation.createdAt}`);
      if (consultation.endTime) {
        console.log(`   Ended: ${consultation.endTime}`);
      }
    });

    // Check recent transactions
    console.log("\n📋 RECENT TRANSACTIONS:");
    const recentTransactions = await Transaction.find({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    recentTransactions.forEach((transaction, index) => {
      console.log(`\n${index + 1}. ${transaction.type.toUpperCase()}`);
      console.log(`   User: ${transaction.user}`);
      console.log(`   Amount: ₹${transaction.amount}`);
      console.log(`   Balance: ₹${transaction.balance}`);
      console.log(`   Description: ${transaction.description}`);
      console.log(`   Time: ${transaction.createdAt}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("🎯 ISSUE ANALYSIS:");

    if (ongoingConsultations.length > 0) {
      console.log("🚨 PROBLEM CONFIRMED: Found ongoing consultations");
      console.log(
        "   This explains why frontend shows 'Join Video/End' buttons"
      );
      console.log("   Backend thinks consultation is still active");

      console.log("\n🔧 IMMEDIATE ACTION NEEDED:");
      console.log("   1. Run emergency fix to end stuck consultations");
      console.log("   2. Process proper billing for actual call duration");
      console.log("   3. Update frontend to handle backend call failures");
    } else {
      console.log("✅ No stuck consultations found");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Debug failed:", error);
    process.exit(1);
  }
}

debugCurrentIssue();
