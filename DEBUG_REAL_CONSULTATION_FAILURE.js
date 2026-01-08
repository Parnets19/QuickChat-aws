const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * DEBUG: Check the real consultation that failed billing
 * Compare it with our successful test to find the difference
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

async function debugRealConsultationFailure() {
  console.log("🔍 DEBUGGING REAL CONSULTATION FAILURE");
  console.log("=".repeat(60));

  try {
    await connectDB();

    // Get the consultation that failed billing (from our earlier debug)
    const failedConsultationId = "695d037e075fb3aa84fa7bc2";
    const failedConsultation = await Consultation.findById(
      failedConsultationId
    );

    if (!failedConsultation) {
      console.log("❌ Failed consultation not found");
      return;
    }

    console.log("📋 FAILED CONSULTATION DETAILS:");
    console.log(`   ID: ${failedConsultation._id}`);
    console.log(`   Status: ${failedConsultation.status}`);
    console.log(`   Type: ${failedConsultation.type}`);
    console.log(`   Rate: ₹${failedConsultation.rate}/min`);
    console.log(`   Duration: ${failedConsultation.duration} min`);
    console.log(`   Total Amount: ₹${failedConsultation.totalAmount}`);
    console.log(`   Created: ${failedConsultation.createdAt}`);
    console.log(`   Ended: ${failedConsultation.endTime}`);
    console.log(`   End Reason: ${failedConsultation.endReason}`);
    console.log(`   Billing Started: ${failedConsultation.billingStarted}`);
    console.log(
      `   Both Sides Accepted: ${failedConsultation.bothSidesAcceptedAt}`
    );
    console.log(`   Client Accepted: ${failedConsultation.clientAccepted}`);
    console.log(`   Provider Accepted: ${failedConsultation.providerAccepted}`);

    // Check the billing conditions that would have been evaluated
    console.log(`\n🔍 BILLING CONDITIONS ANALYSIS:`);

    // 1. Check for existing transactions
    const existingClientPayment = await Transaction.findOne({
      user: failedConsultation.user,
      consultationId: failedConsultationId,
      type: { $in: ["consultation_payment", "consultation"] },
      amount: { $gt: 0 },
    });

    const existingProviderEarning = await Transaction.findOne({
      user: failedConsultation.provider,
      consultationId: failedConsultationId,
      type: "earning",
      amount: { $gt: 0 },
    });

    console.log(
      `   Existing Client Payment: ${
        existingClientPayment ? `₹${existingClientPayment.amount}` : "None"
      }`
    );
    console.log(
      `   Existing Provider Earning: ${
        existingProviderEarning ? `₹${existingProviderEarning.amount}` : "None"
      }`
    );

    // 2. Calculate what the final amount should have been
    let calculatedAmount = 0;
    let calculatedDuration = 0;

    if (
      failedConsultation.bothSidesAcceptedAt &&
      failedConsultation.billingStarted &&
      failedConsultation.endTime
    ) {
      const durationInSeconds = Math.floor(
        (failedConsultation.endTime - failedConsultation.bothSidesAcceptedAt) /
          1000
      );
      const ratePerSecond = failedConsultation.rate / 60;
      calculatedAmount =
        Math.round(durationInSeconds * ratePerSecond * 100) / 100;
      calculatedDuration = Math.round((durationInSeconds / 60) * 100) / 100;
    }

    console.log(`\n💰 CALCULATED BILLING:`);
    console.log(`   Calculated Duration: ${calculatedDuration} minutes`);
    console.log(`   Calculated Amount: ₹${calculatedAmount}`);
    console.log(`   Recorded Duration: ${failedConsultation.duration} minutes`);
    console.log(`   Recorded Amount: ₹${failedConsultation.totalAmount}`);
    console.log(
      `   Amounts Match: ${
        Math.abs(calculatedAmount - failedConsultation.totalAmount) < 0.01
      }`
    );

    // 3. Check user wallet at the time
    const client = await User.findById(failedConsultation.user);
    const provider = await User.findById(failedConsultation.provider);

    console.log(`\n👤 USER DETAILS:`);
    console.log(
      `   Client: ${client?.fullName} (ID: ${failedConsultation.user})`
    );
    console.log(`   Client Current Wallet: ₹${client?.wallet}`);
    console.log(
      `   Provider: ${provider?.fullName} (ID: ${failedConsultation.provider})`
    );
    console.log(`   Provider Current Wallet: ₹${provider?.wallet}`);

    // 4. Evaluate the billing condition
    const shouldProcessBilling =
      calculatedAmount > 0 &&
      !existingClientPayment &&
      !existingProviderEarning;
    console.log(`\n🔍 BILLING CONDITION EVALUATION:`);
    console.log(
      `   calculatedAmount > 0: ${calculatedAmount > 0} (₹${calculatedAmount})`
    );
    console.log(`   !existingClientPayment: ${!existingClientPayment}`);
    console.log(`   !existingProviderEarning: ${!existingProviderEarning}`);
    console.log(`   Should Process Billing: ${shouldProcessBilling}`);

    // 5. Check wallet sufficiency
    if (shouldProcessBilling && client) {
      console.log(`\n💳 WALLET SUFFICIENCY CHECK:`);
      console.log(`   Required Amount: ₹${calculatedAmount}`);
      console.log(`   Client Wallet: ₹${client.wallet}`);
      console.log(`   Sufficient Funds: ${client.wallet >= calculatedAmount}`);

      if (client.wallet < calculatedAmount) {
        console.log(
          `   🚨 INSUFFICIENT FUNDS - This would cause billing to be skipped`
        );
        console.log(`   The consultation would be ended with totalAmount = 0`);
      }
    }

    // 6. Check if this was ended by our emergency script
    if (
      failedConsultation.endReason === "manual" &&
      failedConsultation.totalAmount > 0
    ) {
      console.log(`\n🤔 MYSTERY: Consultation has amount but no transactions`);
      console.log(
        `   This suggests the endConsultation function calculated the amount`
      );
      console.log(`   but failed to create transactions for some reason`);

      // Check if there were any errors in the logs around that time
      console.log(`\n🔍 POSSIBLE CAUSES:`);
      console.log(`   1. Database transaction failed after amount calculation`);
      console.log(`   2. createBillingTransactions function threw an error`);
      console.log(
        `   3. User/Provider models couldn't be found during billing`
      );
      console.log(
        `   4. Network/database connection issue during transaction creation`
      );
    }

    // 7. Compare with our successful test
    console.log(`\n📊 COMPARISON WITH SUCCESSFUL TEST:`);
    const testConsultation = await Consultation.findOne({
      _id: { $ne: failedConsultationId },
      status: "completed",
      totalAmount: { $gt: 0 },
    }).sort({ createdAt: -1 });

    if (testConsultation) {
      console.log(`   Test Consultation: ${testConsultation._id}`);
      console.log(`   Test Amount: ₹${testConsultation.totalAmount}`);

      const testTransactions = await Transaction.find({
        consultationId: testConsultation._id,
      });

      console.log(`   Test Transactions: ${testTransactions.length} found`);

      if (testTransactions.length > 0) {
        console.log(
          `   ✅ Test consultation has transactions - billing worked`
        );
      } else {
        console.log(`   ❌ Test consultation also missing transactions`);
      }
    }

    console.log(`\n🎯 CONCLUSION:`);
    if (!shouldProcessBilling) {
      console.log(
        `❌ Billing condition failed - this is why no transactions were created`
      );
      if (existingClientPayment) {
        console.log(`   Reason: Client payment already exists`);
      }
      if (existingProviderEarning) {
        console.log(`   Reason: Provider earning already exists`);
      }
      if (calculatedAmount <= 0) {
        console.log(`   Reason: Calculated amount is ₹${calculatedAmount}`);
      }
    } else if (client && client.wallet < calculatedAmount) {
      console.log(
        `❌ Insufficient funds - billing was skipped due to low wallet balance`
      );
    } else {
      console.log(
        `🤔 Billing should have worked - there may be a bug in the endConsultation function`
      );
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Debug failed:", error);
    process.exit(1);
  }
}

debugRealConsultationFailure();
