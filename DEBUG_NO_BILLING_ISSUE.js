const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * DEBUG: Why is no billing happening when calls end?
 * Check the recent consultation and see what went wrong
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

async function debugNoBillingIssue() {
  console.log("🔍 DEBUGGING NO BILLING ISSUE");
  console.log("=".repeat(60));
  console.log("Investigating why no billing is happening when calls end");
  console.log("=".repeat(60));

  try {
    await connectDB();

    // 1. Get the most recent consultation
    const recentConsultation = await Consultation.findOne({
      status: "completed",
      createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // Last 2 hours
    }).sort({ createdAt: -1 });

    if (!recentConsultation) {
      console.log("❌ No recent completed consultations found");
      return;
    }

    console.log("📋 MOST RECENT CONSULTATION:");
    console.log(`   ID: ${recentConsultation._id}`);
    console.log(`   Status: ${recentConsultation.status}`);
    console.log(`   Type: ${recentConsultation.type}`);
    console.log(`   Rate: ₹${recentConsultation.rate}/min`);
    console.log(`   Duration: ${recentConsultation.duration} min`);
    console.log(`   Total Amount: ₹${recentConsultation.totalAmount}`);
    console.log(`   Created: ${recentConsultation.createdAt}`);
    console.log(`   Ended: ${recentConsultation.endTime}`);
    console.log(`   End Reason: ${recentConsultation.endReason}`);
    console.log(`   Billing Started: ${recentConsultation.billingStarted}`);
    console.log(
      `   Both Sides Accepted: ${recentConsultation.bothSidesAcceptedAt}`
    );

    // 2. Get client and provider details
    const client = await User.findById(recentConsultation.user);
    const provider = await User.findById(recentConsultation.provider);

    console.log(`\n👤 CLIENT (${client?.fullName || "Unknown"}):`);
    console.log(`   ID: ${recentConsultation.user}`);
    console.log(`   Current Wallet: ₹${client?.wallet || "N/A"}`);
    console.log(`   Total Spent: ₹${client?.totalSpent || 0}`);

    console.log(`\n👤 PROVIDER (${provider?.fullName || "Unknown"}):`);
    console.log(`   ID: ${recentConsultation.provider}`);
    console.log(`   Current Wallet: ₹${provider?.wallet || "N/A"}`);
    console.log(`   Total Earnings: ₹${provider?.earnings || 0}`);

    // 3. Check for transactions related to this consultation
    console.log(`\n💰 TRANSACTIONS FOR THIS CONSULTATION:`);

    const consultationTransactions = await Transaction.find({
      consultationId: recentConsultation._id,
    }).sort({ createdAt: 1 });

    if (consultationTransactions.length === 0) {
      console.log("❌ NO TRANSACTIONS FOUND FOR THIS CONSULTATION!");
      console.log("🚨 This confirms the NO BILLING issue");
    } else {
      console.log(`Found ${consultationTransactions.length} transactions:`);
      consultationTransactions.forEach((tx, index) => {
        console.log(`\n   ${index + 1}. ${tx.type.toUpperCase()}`);
        console.log(`      User: ${tx.user}`);
        console.log(`      Amount: ₹${tx.amount}`);
        console.log(`      Balance After: ₹${tx.balance}`);
        console.log(`      Description: ${tx.description}`);
        console.log(`      Time: ${tx.createdAt}`);
        console.log(`      Status: ${tx.status}`);
      });
    }

    // 4. Analyze why billing didn't happen
    console.log(`\n🔍 BILLING ANALYSIS:`);

    const expectedAmount =
      recentConsultation.duration * recentConsultation.rate;
    console.log(
      `   Expected Amount: ${recentConsultation.duration} min × ₹${
        recentConsultation.rate
      }/min = ₹${expectedAmount.toFixed(2)}`
    );
    console.log(`   Recorded Amount: ₹${recentConsultation.totalAmount}`);

    if (recentConsultation.totalAmount === 0) {
      console.log(`\n🚨 PROBLEM IDENTIFIED: totalAmount is ₹0`);
      console.log(`   Possible reasons:`);

      if (!recentConsultation.billingStarted) {
        console.log(`   ❌ Billing was never started (billingStarted: false)`);
      }

      if (!recentConsultation.bothSidesAcceptedAt) {
        console.log(`   ❌ Both sides never accepted the call`);
      }

      if (recentConsultation.duration === 0) {
        console.log(`   ❌ Duration is 0 minutes`);
      }

      if (recentConsultation.rate === 0) {
        console.log(`   ❌ Rate is ₹0/min (free consultation)`);
      }

      if (recentConsultation.endReason === "insufficient_funds") {
        console.log(`   ❌ Ended due to insufficient funds`);
      }

      // Check if client had sufficient balance at the time
      if (client && expectedAmount > 0) {
        console.log(`\n💳 CLIENT BALANCE CHECK:`);
        console.log(`   Current Balance: ₹${client.wallet}`);
        console.log(`   Required Amount: ₹${expectedAmount.toFixed(2)}`);

        if (client.wallet < expectedAmount) {
          console.log(
            `   🚨 INSUFFICIENT FUNDS: Client doesn't have enough money`
          );
          console.log(`   This is why billing was skipped`);
        } else {
          console.log(
            `   ✅ Client has sufficient funds - billing should have happened`
          );
        }
      }
    } else {
      console.log(`\n✅ Consultation has proper amount recorded`);
      if (consultationTransactions.length === 0) {
        console.log(`🚨 BUT NO TRANSACTIONS CREATED - This is the bug!`);
      }
    }

    // 5. Check recent transactions for both users
    console.log(`\n📋 RECENT CLIENT TRANSACTIONS:`);
    const clientTransactions = await Transaction.find({
      user: recentConsultation.user,
      createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (clientTransactions.length === 0) {
      console.log("❌ No recent transactions for client");
    } else {
      clientTransactions.forEach((tx, index) => {
        console.log(
          `   ${index + 1}. ${tx.type}: ₹${tx.amount} (${tx.createdAt})`
        );
      });
    }

    console.log(`\n📋 RECENT PROVIDER TRANSACTIONS:`);
    const providerTransactions = await Transaction.find({
      user: recentConsultation.provider,
      createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (providerTransactions.length === 0) {
      console.log("❌ No recent transactions for provider");
    } else {
      providerTransactions.forEach((tx, index) => {
        console.log(
          `   ${index + 1}. ${tx.type}: ₹${tx.amount} (${tx.createdAt})`
        );
      });
    }

    // 6. Summary and recommendations
    console.log(`\n🎯 SUMMARY:`);

    if (
      consultationTransactions.length === 0 &&
      recentConsultation.totalAmount > 0
    ) {
      console.log(
        `🚨 CRITICAL BUG: Consultation shows ₹${recentConsultation.totalAmount} but no transactions created`
      );
      console.log(
        `   This means the endConsultation function is not creating transactions properly`
      );
    } else if (recentConsultation.totalAmount === 0) {
      console.log(`⚠️ NO BILLING: Consultation amount is ₹0`);
      console.log(
        `   This could be due to insufficient funds, free consultation, or billing logic issues`
      );
    } else {
      console.log(`✅ Billing appears to be working correctly`);
    }

    console.log(`\n🔧 RECOMMENDED ACTIONS:`);
    console.log(
      `   1. Check the endConsultation function in realTimeBilling.controller.js`
    );
    console.log(
      `   2. Verify the createBillingTransactions function is being called`
    );
    console.log(`   3. Check for any errors in the billing process`);
    console.log(`   4. Test with a consultation that has sufficient funds`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Debug failed:", error);
    process.exit(1);
  }
}

debugNoBillingIssue();
