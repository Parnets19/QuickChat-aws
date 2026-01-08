const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * EMERGENCY: End the currently stuck consultation
 * Consultation ID: 695d01c3075fb3aa84fa4ea3
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

async function emergencyEndStuckConsultation() {
  console.log("🚨 EMERGENCY: ENDING STUCK CONSULTATION");
  console.log("=".repeat(60));
  console.log("Ending consultation 695d01c3075fb3aa84fa4ea3");
  console.log("=".repeat(60));

  try {
    await connectDB();

    const consultationId = "695d01c3075fb3aa84fa4ea3";

    // 1. Get the stuck consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      console.log("❌ Consultation not found");
      return;
    }

    console.log("📋 STUCK CONSULTATION:");
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Client: ${consultation.user}`);
    console.log(`   Provider: ${consultation.provider}`);
    console.log(`   Type: ${consultation.type}`);
    console.log(`   Rate: ₹${consultation.rate}/min`);
    console.log(`   Created: ${consultation.createdAt}`);
    console.log(`   Both Sides Accepted: ${consultation.bothSidesAcceptedAt}`);
    console.log(`   Billing Started: ${consultation.billingStarted}`);

    // 2. Calculate how long it's been running
    const now = new Date();
    const runningTime = consultation.bothSidesAcceptedAt
      ? (now - consultation.bothSidesAcceptedAt) / (1000 * 60)
      : 0;

    console.log(`   🕐 Running Time: ${runningTime.toFixed(2)} minutes`);

    // 3. Get users
    const nandu = await User.findById(consultation.user);
    const sai = await User.findById(consultation.provider);

    if (!nandu || !sai) {
      console.log("❌ Users not found");
      return;
    }

    console.log(`\n👤 BEFORE ENDING:`);
    console.log(`   Nandu Wallet: ₹${nandu.wallet}`);
    console.log(`   Sai Wallet: ₹${sai.wallet}`);

    // 4. Calculate billing for the actual time
    let finalDuration = 0;
    let finalAmount = 0;

    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      const durationInSeconds = Math.floor(
        (now - consultation.bothSidesAcceptedAt) / 1000
      );
      const ratePerSecond = consultation.rate / 60;
      finalAmount = Math.round(durationInSeconds * ratePerSecond * 100) / 100;
      finalDuration = Math.round((durationInSeconds / 60) * 100) / 100;

      console.log(`\n💰 BILLING CALCULATION:`);
      console.log(`   Duration: ${finalDuration} minutes`);
      console.log(`   Rate: ₹${consultation.rate}/min`);
      console.log(`   Total Amount: ₹${finalAmount}`);
    }

    // 5. Check if Nandu has sufficient balance
    if (finalAmount > 0 && nandu.wallet >= finalAmount) {
      console.log(`\n💸 PROCESSING BILLING:`);

      // Calculate commission
      const platformCommission = Math.round(finalAmount * 0.05 * 100) / 100;
      const providerEarnings = Math.round(finalAmount * 0.95 * 100) / 100;

      // Deduct from Nandu
      nandu.wallet -= finalAmount;
      await nandu.save();
      console.log(`   ✅ Deducted ₹${finalAmount} from Nandu`);

      // Credit to Sai
      sai.wallet += providerEarnings;
      sai.earnings = (sai.earnings || 0) + providerEarnings;
      await sai.save();
      console.log(`   ✅ Credited ₹${providerEarnings} to Sai`);

      // Create transactions
      const clientTransaction = new Transaction({
        user: nandu._id,
        userType: "User",
        type: "consultation_payment",
        category: "consultation",
        amount: finalAmount,
        balance: nandu.wallet,
        description: `video consultation with ${sai.fullName}`,
        status: "completed",
        consultationId: consultation._id,
        transactionId: `PAY_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
      });

      const providerTransaction = new Transaction({
        user: sai._id,
        userType: "User",
        type: "earning",
        category: "consultation",
        amount: providerEarnings,
        balance: sai.wallet,
        description: `Video Consultation - ${nandu.fullName}`,
        status: "completed",
        consultationId: consultation._id,
        transactionId: `EARN_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
      });

      await Promise.all([clientTransaction.save(), providerTransaction.save()]);
      console.log(`   ✅ Created billing transactions`);
    } else if (finalAmount > 0) {
      console.log(`\n⚠️ INSUFFICIENT FUNDS:`);
      console.log(`   Required: ₹${finalAmount}`);
      console.log(`   Available: ₹${nandu.wallet}`);
      console.log(`   Ending consultation without charge`);
      finalAmount = 0;
    } else {
      console.log(`\n🆓 NO BILLING NEEDED (Free or zero duration)`);
    }

    // 6. End the consultation
    consultation.status = "completed";
    consultation.endTime = now;
    consultation.duration = finalDuration;
    consultation.totalAmount = finalAmount;
    consultation.endReason = "manual";

    await consultation.save();

    console.log(`\n✅ CONSULTATION ENDED SUCCESSFULLY:`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Duration: ${consultation.duration} minutes`);
    console.log(`   Amount: ₹${consultation.totalAmount}`);
    console.log(`   End Time: ${consultation.endTime}`);

    console.log(`\n👤 AFTER ENDING:`);
    console.log(`   Nandu Wallet: ₹${nandu.wallet}`);
    console.log(`   Sai Wallet: ₹${sai.wallet}`);
    console.log(`   Sai Earnings: ₹${sai.earnings}`);

    console.log(`\n🎯 FRONTEND SHOULD NOW SHOW:`);
    console.log(`   ✅ Consultation as "Completed"`);
    console.log(`   ✅ No more "Join Video/End" buttons`);
    console.log(`   ✅ Proper billing amounts`);

    // 7. Check for any other stuck consultations
    const otherStuck = await Consultation.find({
      status: "ongoing",
      createdAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    if (otherStuck.length > 0) {
      console.log(
        `\n🚨 WARNING: Found ${otherStuck.length} other stuck consultations`
      );
      otherStuck.forEach((stuck) => {
        console.log(`   - ${stuck._id}: Created ${stuck.createdAt}`);
      });
    } else {
      console.log(`\n✅ No other stuck consultations found`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Emergency end failed:", error);
    process.exit(1);
  }
}

emergencyEndStuckConsultation();
