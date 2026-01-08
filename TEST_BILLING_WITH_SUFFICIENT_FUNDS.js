const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * TEST: Create a test consultation and try to end it with proper billing
 * This will help us see exactly where the billing is failing
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

async function testBillingWithSufficientFunds() {
  console.log("🧪 TESTING BILLING WITH SUFFICIENT FUNDS");
  console.log("=".repeat(60));

  try {
    await connectDB();

    // Get Nandu and Sai
    const nandu = await User.findOne({ fullName: { $regex: /nandu/i } });
    const sai = await User.findOne({ fullName: { $regex: /sai/i } });

    if (!nandu || !sai) {
      console.log("❌ Users not found");
      return;
    }

    console.log("👤 BEFORE TEST:");
    console.log(`   Nandu Wallet: ₹${nandu.wallet}`);
    console.log(`   Sai Wallet: ₹${sai.wallet}`);
    console.log(`   Sai Earnings: ₹${sai.earnings}`);

    // Ensure Nandu has sufficient funds for testing
    if (nandu.wallet < 10) {
      console.log("💰 Adding funds to Nandu for testing...");
      nandu.wallet = 20; // Give him ₹20 for testing
      await nandu.save();
      console.log(`   ✅ Nandu wallet updated to ₹${nandu.wallet}`);
    }

    // Create a test consultation
    const testConsultation = new Consultation({
      user: nandu._id,
      userType: "User",
      provider: sai._id,
      type: "video",
      status: "ongoing",
      rate: 3, // ₹3/min
      startTime: new Date(Date.now() - 2 * 60 * 1000), // Started 2 minutes ago
      billingStarted: true,
      clientAccepted: true,
      providerAccepted: true,
      clientAcceptedAt: new Date(Date.now() - 2 * 60 * 1000),
      providerAcceptedAt: new Date(Date.now() - 2 * 60 * 1000),
      bothSidesAcceptedAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      lastBillingTime: new Date(Date.now() - 2 * 60 * 1000),
    });

    await testConsultation.save();
    console.log(`\n📋 TEST CONSULTATION CREATED:`);
    console.log(`   ID: ${testConsultation._id}`);
    console.log(`   Rate: ₹${testConsultation.rate}/min`);
    console.log(`   Started: ${testConsultation.bothSidesAcceptedAt}`);
    console.log(`   Expected Duration: ~2 minutes`);
    console.log(`   Expected Charge: ~₹6`);

    // Now simulate ending the consultation
    console.log(`\n🛑 SIMULATING CONSULTATION END...`);

    // Calculate duration and amount (same logic as endConsultation)
    const endTime = new Date();
    const durationInSeconds = Math.floor(
      (endTime - testConsultation.bothSidesAcceptedAt) / 1000
    );
    const ratePerSecond = testConsultation.rate / 60;
    const finalAmount =
      Math.round(durationInSeconds * ratePerSecond * 100) / 100;
    const finalDuration = Math.round((durationInSeconds / 60) * 100) / 100;

    console.log(`💰 BILLING CALCULATION:`);
    console.log(`   Duration: ${finalDuration} minutes`);
    console.log(`   Rate: ₹${testConsultation.rate}/min`);
    console.log(`   Total Amount: ₹${finalAmount}`);

    // Check for existing transactions (same logic as endConsultation)
    const existingClientPayment = await Transaction.findOne({
      user: testConsultation.user,
      consultationId: testConsultation._id,
      type: { $in: ["consultation_payment", "consultation"] },
      amount: { $gt: 0 },
    });

    const existingProviderEarning = await Transaction.findOne({
      user: testConsultation.provider,
      consultationId: testConsultation._id,
      type: "earning",
      amount: { $gt: 0 },
    });

    console.log(`\n🔍 EXISTING TRANSACTIONS CHECK:`);
    console.log(
      `   Client Payment: ${
        existingClientPayment ? `₹${existingClientPayment.amount}` : "None"
      }`
    );
    console.log(
      `   Provider Earning: ${
        existingProviderEarning ? `₹${existingProviderEarning.amount}` : "None"
      }`
    );

    // Check the billing condition
    const shouldProcessBilling =
      finalAmount > 0 && !existingClientPayment && !existingProviderEarning;
    console.log(`\n🔍 BILLING CONDITION CHECK:`);
    console.log(`   finalAmount > 0: ${finalAmount > 0} (₹${finalAmount})`);
    console.log(`   !existingClientPayment: ${!existingClientPayment}`);
    console.log(`   !existingProviderEarning: ${!existingProviderEarning}`);
    console.log(`   Should Process Billing: ${shouldProcessBilling}`);

    if (shouldProcessBilling) {
      console.log(`\n✅ BILLING SHOULD PROCEED`);

      // Check wallet balance
      const currentNandu = await User.findById(nandu._id);
      console.log(`   Nandu Current Balance: ₹${currentNandu.wallet}`);
      console.log(`   Required Amount: ₹${finalAmount}`);
      console.log(`   Sufficient Funds: ${currentNandu.wallet >= finalAmount}`);

      if (currentNandu.wallet >= finalAmount) {
        console.log(`\n💰 PROCESSING TEST BILLING...`);

        // Calculate commission
        const platformCommission = Math.round(finalAmount * 0.05 * 100) / 100;
        const providerEarnings = Math.round(finalAmount * 0.95 * 100) / 100;

        console.log(`   Platform Commission (5%): ₹${platformCommission}`);
        console.log(`   Provider Earnings (95%): ₹${providerEarnings}`);

        // Update wallets
        currentNandu.wallet -= finalAmount;
        await currentNandu.save();
        console.log(`   ✅ Deducted ₹${finalAmount} from Nandu`);

        const currentSai = await User.findById(sai._id);
        currentSai.wallet += providerEarnings;
        currentSai.earnings = (currentSai.earnings || 0) + providerEarnings;
        await currentSai.save();
        console.log(`   ✅ Credited ₹${providerEarnings} to Sai`);

        // Create transactions
        const clientTransaction = new Transaction({
          user: currentNandu._id,
          userType: "User",
          type: "consultation_payment",
          category: "consultation",
          amount: finalAmount,
          balance: currentNandu.wallet,
          description: `video consultation with ${currentSai.fullName}`,
          status: "completed",
          consultationId: testConsultation._id,
          transactionId: `TEST_PAY_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
        });

        const providerTransaction = new Transaction({
          user: currentSai._id,
          userType: "User",
          type: "earning",
          category: "consultation",
          amount: providerEarnings,
          balance: currentSai.wallet,
          description: `Video Consultation - ${currentNandu.fullName}`,
          status: "completed",
          consultationId: testConsultation._id,
          transactionId: `TEST_EARN_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
        });

        await Promise.all([
          clientTransaction.save(),
          providerTransaction.save(),
        ]);
        console.log(`   ✅ Created billing transactions`);

        // Update consultation
        testConsultation.status = "completed";
        testConsultation.endTime = endTime;
        testConsultation.duration = finalDuration;
        testConsultation.totalAmount = finalAmount;
        testConsultation.endReason = "manual";
        await testConsultation.save();

        console.log(`\n🎯 TEST BILLING COMPLETED SUCCESSFULLY!`);
        console.log(`   Consultation ID: ${testConsultation._id}`);
        console.log(`   Client Transaction: ${clientTransaction._id}`);
        console.log(`   Provider Transaction: ${providerTransaction._id}`);

        console.log(`\n👤 AFTER TEST:`);
        console.log(`   Nandu Wallet: ₹${currentNandu.wallet}`);
        console.log(`   Sai Wallet: ₹${currentSai.wallet}`);
        console.log(`   Sai Earnings: ₹${currentSai.earnings}`);
      } else {
        console.log(`\n❌ INSUFFICIENT FUNDS - Would skip billing`);
      }
    } else {
      console.log(
        `\n❌ BILLING CONDITION FAILED - This is why no billing happens!`
      );

      if (existingClientPayment) {
        console.log(
          `   Reason: Client payment already exists (₹${existingClientPayment.amount})`
        );
      }
      if (existingProviderEarning) {
        console.log(
          `   Reason: Provider earning already exists (₹${existingProviderEarning.amount})`
        );
      }
      if (finalAmount <= 0) {
        console.log(`   Reason: Final amount is ₹${finalAmount}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testBillingWithSufficientFunds();
