const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * EMERGENCY LIVE FIX: Fix the current ghost billing issue
 * Fix consultation 695cfa80075fb3aa84f9f734 and prevent future occurrences
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

async function emergencyLiveFix() {
  console.log("🚨 EMERGENCY LIVE GHOST BILLING FIX");
  console.log("=".repeat(70));
  console.log("Fixing the current live ghost billing issue");
  console.log("=".repeat(70));

  try {
    await connectDB();

    // 1. Find the problematic consultation
    const consultationId = "695cfa80075fb3aa84f9f734";
    const consultation = await Consultation.findById(consultationId);

    if (!consultation) {
      console.log("❌ Consultation not found");
      return;
    }

    console.log("📋 PROBLEMATIC CONSULTATION:");
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Client: ${consultation.user}`);
    console.log(`   Provider: ${consultation.provider}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Duration: ${consultation.duration} min`);
    console.log(`   Total Amount: ₹${consultation.totalAmount}`);
    console.log(`   Rate: ₹${consultation.rate}/min`);

    // 2. Get Nandu and Sai
    const nandu = await User.findById(consultation.user);
    const sai = await User.findById(consultation.provider);

    if (!nandu || !sai) {
      console.log("❌ Users not found");
      return;
    }

    console.log(`\n👤 BEFORE FIX:`);
    console.log(`   Nandu Wallet: ₹${nandu.wallet}`);
    console.log(`   Sai Wallet: ₹${sai.wallet}`);
    console.log(`   Sai Earnings: ₹${sai.earnings}`);

    // 3. Check if client payment exists
    const clientPayment = await Transaction.findOne({
      user: consultation.user,
      consultationId: consultationId,
      type: { $in: ["consultation_payment", "consultation"] },
      amount: { $gt: 0 },
    });

    console.log(`\n🔍 CLIENT PAYMENT CHECK:`);
    if (clientPayment) {
      console.log(`   ✅ Client payment found: ₹${clientPayment.amount}`);
      console.log("   No fix needed - payment exists");
      return;
    } else {
      console.log(`   🚨 NO CLIENT PAYMENT FOUND - Ghost billing confirmed!`);
    }

    // 4. Find the ghost earning transaction
    const ghostEarning = await Transaction.findOne({
      user: consultation.provider,
      consultationId: consultationId,
      type: "earning",
      amount: { $gt: 0 },
    });

    if (!ghostEarning) {
      console.log("❌ Ghost earning transaction not found");
      return;
    }

    console.log(`\n💰 GHOST EARNING FOUND:`);
    console.log(`   Amount: ₹${ghostEarning.amount}`);
    console.log(`   Time: ${ghostEarning.createdAt}`);

    // 5. REVERSE THE GHOST BILLING
    console.log(`\n🔄 REVERSING GHOST BILLING...`);

    // Calculate the amounts
    const ghostAmount = ghostEarning.amount;
    const originalTotalAmount = consultation.totalAmount;

    // Reverse Sai's wallet and earnings
    sai.wallet -= ghostAmount;
    sai.earnings -= ghostAmount;
    await sai.save();

    console.log(`✅ REVERSED SAI'S GHOST EARNINGS:`);
    console.log(`   Deducted: ₹${ghostAmount}`);
    console.log(`   New Wallet: ₹${sai.wallet}`);
    console.log(`   New Earnings: ₹${sai.earnings}`);

    // 6. Create reversal transaction for Sai
    const reversalTransaction = new Transaction({
      user: sai._id,
      userType: "User",
      type: "refund",
      category: "adjustment",
      amount: ghostAmount,
      balance: sai.wallet,
      description: `Ghost billing reversal - No client payment found for consultation ${consultationId}`,
      status: "completed",
      consultationId: consultationId,
      transactionId: `GHOST_REV_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      metadata: {
        originalTransactionId: ghostEarning._id,
        reason: "ghost_billing_emergency_fix",
        consultationType: consultation.type,
        originalAmount: ghostAmount,
        fixedAt: new Date(),
      },
    });

    await reversalTransaction.save();
    console.log(`✅ REVERSAL TRANSACTION CREATED: ${reversalTransaction._id}`);

    // 7. Mark the ghost earning as cancelled
    ghostEarning.status = "cancelled";
    ghostEarning.metadata = {
      ...ghostEarning.metadata,
      reversalTransactionId: reversalTransaction._id,
      cancelledAt: new Date(),
      reason: "ghost_billing_fix",
    };
    await ghostEarning.save();

    console.log(`✅ GHOST EARNING MARKED AS CANCELLED`);

    // 8. Update consultation to reflect the fix
    consultation.totalAmount = 0; // No client payment = no amount
    consultation.endReason = "system_error";
    consultation.metadata = {
      ...consultation.metadata,
      ghostBillingFixed: true,
      fixedAt: new Date(),
      originalAmount: originalTotalAmount,
      reason: "no_client_payment_found",
    };
    await consultation.save();

    console.log(`✅ CONSULTATION UPDATED - Amount set to ₹0`);

    // 9. Check for any other ongoing consultations that might be stuck
    console.log(`\n🔍 CHECKING FOR OTHER STUCK CONSULTATIONS...`);

    const ongoingConsultations = await Consultation.find({
      status: "ongoing",
      createdAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) }, // Older than 5 minutes
    }).populate("user provider");

    if (ongoingConsultations.length > 0) {
      console.log(
        `🚨 FOUND ${ongoingConsultations.length} STUCK CONSULTATIONS:`
      );

      for (const stuckConsultation of ongoingConsultations) {
        console.log(
          `   - ${stuckConsultation._id}: ${stuckConsultation.user?.fullName} -> ${stuckConsultation.provider?.fullName}`
        );
        console.log(`     Created: ${stuckConsultation.createdAt}`);
        console.log(
          `     Duration: ${(
            (new Date() - stuckConsultation.createdAt) /
            (1000 * 60)
          ).toFixed(1)} minutes ago`
        );

        // Auto-end stuck consultations older than 10 minutes
        if (new Date() - stuckConsultation.createdAt > 10 * 60 * 1000) {
          console.log(`     🛑 AUTO-ENDING (older than 10 minutes)`);

          stuckConsultation.status = "completed";
          stuckConsultation.endTime = new Date();
          stuckConsultation.endReason = "auto_ended_stuck";
          stuckConsultation.duration = 0;
          stuckConsultation.totalAmount = 0;

          await stuckConsultation.save();
          console.log(`     ✅ Auto-ended stuck consultation`);
        }
      }
    } else {
      console.log(`✅ No other stuck consultations found`);
    }

    console.log(`\n🎯 EMERGENCY FIX COMPLETE:`);
    console.log(`   ✅ Reversed ₹${ghostAmount} from Sai (ghost billing)`);
    console.log(`   ✅ Created reversal transaction`);
    console.log(`   ✅ Marked ghost earning as cancelled`);
    console.log(`   ✅ Updated consultation record`);
    console.log(`   ✅ Checked for other stuck consultations`);

    console.log(`\n👤 AFTER FIX:`);
    console.log(
      `   Nandu Wallet: ₹${nandu.wallet} (unchanged - no payment was made)`
    );
    console.log(`   Sai Wallet: ₹${sai.wallet} (ghost earnings reversed)`);
    console.log(`   Sai Earnings: ₹${sai.earnings} (ghost earnings reversed)`);

    console.log(`\n📋 NEXT STEPS:`);
    console.log(
      `   1. Frontend should refresh to show correct consultation status`
    );
    console.log(`   2. Both users should see consultation as "completed"`);
    console.log(`   3. No more "Join Video/End" buttons should appear`);
    console.log(
      `   4. Implement enhanced frontend error handling to prevent future ghost billing`
    );

    process.exit(0);
  } catch (error) {
    console.error("❌ Emergency fix failed:", error);
    process.exit(1);
  }
}

emergencyLiveFix();
