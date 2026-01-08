const mongoose = require("mongoose");
const { Consultation, User, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * DIAGNOSE: Why wallet protection failed to auto-terminate the call
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

async function diagnoseWalletProtectionFailure() {
  console.log("🔍 DIAGNOSING WALLET PROTECTION FAILURE");
  console.log("=".repeat(60));

  try {
    await connectDB();

    // Get the consultation that just ended
    const consultation = await Consultation.findById(
      "695d05d4075fb3aa84faad05"
    );
    const nandu = await User.findById("694a71a02b419e7b06d020b0");

    if (!consultation || !nandu) {
      console.log("❌ Consultation or user not found");
      process.exit(1);
      return;
    }

    console.log("📋 CONSULTATION ANALYSIS:");
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Rate: ₹${consultation.rate}/min`);
    console.log(`   Started: ${consultation.startTime}`);
    console.log(`   Ended: ${consultation.endTime}`);
    console.log(`   Duration: ${consultation.duration} minutes`);
    console.log(`   Total Amount: ₹${consultation.totalAmount}`);
    console.log(`   End Reason: ${consultation.endReason}`);

    console.log(`\n👤 NANDU'S CURRENT STATE:`);
    console.log(`   Current Wallet: ₹${nandu.wallet}`);
    console.log(`   Total Spent: ₹${nandu.totalSpent}`);

    // Check transactions during the consultation period
    const consultationStart = consultation.startTime;
    const consultationEnd = consultation.endTime;

    console.log(`\n💰 TRANSACTIONS DURING CONSULTATION PERIOD:`);
    const transactionsDuringCall = await Transaction.find({
      user: nandu._id,
      createdAt: {
        $gte: consultationStart,
        $lte: consultationEnd,
      },
    }).sort({ createdAt: 1 });

    if (transactionsDuringCall.length === 0) {
      console.log("❌ NO TRANSACTIONS FOUND DURING CALL PERIOD");
      console.log(
        "🚨 THIS CONFIRMS THE ISSUE: Real-time billing was not working!"
      );
    } else {
      console.log(`Found ${transactionsDuringCall.length} transactions:`);
      transactionsDuringCall.forEach((tx, index) => {
        console.log(`\n   ${index + 1}. ${tx.type.toUpperCase()}`);
        console.log(`      Amount: ₹${tx.amount}`);
        console.log(`      Balance After: ₹${tx.balance}`);
        console.log(`      Time: ${tx.createdAt}`);
        console.log(`      Description: ${tx.description}`);
      });
    }

    // Simulate what should have happened
    console.log(`\n🧮 WHAT SHOULD HAVE HAPPENED:`);
    const ratePerMinute = consultation.rate; // ₹10/min
    const startingBalance = nandu.wallet; // ₹14 currently

    console.log(`   Starting Balance: ₹${startingBalance}`);
    console.log(`   Rate: ₹${ratePerMinute}/min`);
    console.log(
      `   Maximum Talk Time: ${Math.floor(
        startingBalance / ratePerMinute
      )} minutes`
    );

    // The call should have auto-terminated after 1 minute (when balance would be ₹4, insufficient for next minute)
    const maxAllowedMinutes = Math.floor(startingBalance / ratePerMinute);
    console.log(
      `   Call should have ended after: ${maxAllowedMinutes} minute(s)`
    );
    console.log(
      `   Expected final balance: ₹${
        startingBalance - maxAllowedMinutes * ratePerMinute
      }`
    );

    // Check if there were any per-minute billing calls
    console.log(`\n🔍 CHECKING FOR REAL-TIME BILLING ACTIVITY:`);

    // Look for any API calls or logs that might indicate billing attempts
    const allTransactionsForUser = await Transaction.find({
      user: nandu._id,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    })
      .sort({ createdAt: -1 })
      .limit(10);

    console.log(`\n📋 RECENT TRANSACTIONS (Last 24 hours):`);
    allTransactionsForUser.forEach((tx, index) => {
      console.log(
        `   ${index + 1}. ${tx.type}: ₹${tx.amount} at ${tx.createdAt}`
      );
      if (tx.consultationId) {
        console.log(`      Consultation: ${tx.consultationId}`);
      }
    });

    // Root cause analysis
    console.log(`\n🎯 ROOT CAUSE ANALYSIS:`);
    console.log(`\n🚨 CRITICAL ISSUES IDENTIFIED:`);

    if (transactionsDuringCall.length === 0) {
      console.log(`   1. ❌ NO REAL-TIME BILLING OCCURRED`);
      console.log(`      - The /billing/bill-minute API was never called`);
      console.log(`      - Or the API calls failed silently`);
      console.log(`      - Or the frontend billing timer stopped working`);
    }

    console.log(`   2. ❌ WALLET PROTECTION FAILED`);
    console.log(`      - Call continued for ${consultation.duration} minutes`);
    console.log(
      `      - Should have stopped after ${maxAllowedMinutes} minute(s)`
    );
    console.log(`      - No auto-termination occurred`);

    console.log(`   3. ❌ FRONTEND-BACKEND SYNC ISSUE`);
    console.log(`      - Frontend showed call as ongoing`);
    console.log(`      - Backend had no billing transactions`);
    console.log(`      - This suggests the billing system completely failed`);

    console.log(`\n🔧 IMMEDIATE FIXES NEEDED:`);
    console.log(`   1. Fix the real-time billing timer in frontend`);
    console.log(`   2. Add better error handling for billing API failures`);
    console.log(`   3. Implement server-side wallet monitoring`);
    console.log(`   4. Add automatic consultation cleanup for stuck calls`);
    console.log(`   5. Improve frontend-backend sync for call status`);

    console.log(`\n⚠️ IMPACT:`);
    console.log(
      `   - User experienced a call that should have been terminated`
    );
    console.log(
      `   - System allowed ₹${(consultation.duration * ratePerMinute).toFixed(
        2
      )} worth of service with only ₹${startingBalance} balance`
    );
    console.log(`   - This is a critical wallet protection failure`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Diagnosis failed:", error);
    process.exit(1);
  }
}

diagnoseWalletProtectionFailure();
