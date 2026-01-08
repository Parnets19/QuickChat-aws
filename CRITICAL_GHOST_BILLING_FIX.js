const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * CRITICAL FIX: Reverse ghost billing and fix the specific consultation
 * Consultation 695cfa80075fb3aa84f9f734 - Sai got ₹18.52 but client wasn't charged
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

async function fixGhostBilling() {
  console.log("🚨 CRITICAL GHOST BILLING FIX");
  console.log("=".repeat(60));
  console.log("Fixing consultation 695cfa80075fb3aa84f9f734");
  console.log("Reversing ₹18.52 ghost credit to Sai");
  console.log("=".repeat(60));

  try {
    await connectDB();

    const consultationId = "695cfa80075fb3aa84f9f734";
    const ghostAmount = 18.52;

    // 1. Get the consultation
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      console.log("❌ Consultation not found");
      return;
    }

    console.log("📋 CONSULTATION DETAILS:");
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Duration: ${consultation.duration} min`);
    console.log(`   Total Amount: ₹${consultation.totalAmount}`);
    console.log(`   Rate: ₹${consultation.rate}/min`);

    // 2. Get Sai (provider)
    const sai = await User.findById(consultation.provider);
    if (!sai) {
      console.log("❌ Provider (Sai) not found");
      return;
    }

    console.log(`\n👤 SAI BEFORE FIX:`);
    console.log(`   Wallet: ₹${sai.wallet}`);
    console.log(`   Earnings: ₹${sai.earnings}`);

    // 3. Find the ghost earning transaction
    const ghostTransaction = await Transaction.findOne({
      user: sai._id,
      consultationId: consultationId,
      type: "earning",
      amount: ghostAmount,
    });

    if (!ghostTransaction) {
      console.log("❌ Ghost transaction not found");
      return;
    }

    console.log(`\n💰 GHOST TRANSACTION FOUND:`);
    console.log(`   Amount: ₹${ghostTransaction.amount}`);
    console.log(`   Time: ${ghostTransaction.createdAt}`);
    console.log(`   Description: ${ghostTransaction.description}`);

    // 4. REVERSE THE GHOST BILLING
    console.log(`\n🔄 REVERSING GHOST BILLING...`);

    // Deduct the ghost amount from Sai's wallet and earnings
    sai.wallet -= ghostAmount;
    sai.earnings -= ghostAmount;
    await sai.save();

    console.log(`✅ DEDUCTED ₹${ghostAmount} FROM SAI:`);
    console.log(`   New Wallet: ₹${sai.wallet}`);
    console.log(`   New Earnings: ₹${sai.earnings}`);

    // 5. Create reversal transaction
    const reversalTransaction = new Transaction({
      user: sai._id,
      userType: "User",
      type: "refund",
      category: "adjustment",
      amount: ghostAmount,
      balance: sai.wallet,
      description: `Ghost billing reversal - Consultation ${consultationId} (no client payment found)`,
      status: "completed",
      consultationId: consultationId,
      transactionId: `REV_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      metadata: {
        originalTransactionId: ghostTransaction._id,
        reason: "ghost_billing_fix",
        consultationType: consultation.type,
        originalAmount: ghostTransaction.amount,
      },
    });

    await reversalTransaction.save();
    console.log(`✅ REVERSAL TRANSACTION CREATED: ${reversalTransaction._id}`);

    // 6. Mark the original ghost transaction as cancelled
    ghostTransaction.status = "cancelled";
    ghostTransaction.metadata = {
      ...ghostTransaction.metadata,
      reversalTransactionId: reversalTransaction._id,
      reversedAt: new Date(),
      reason: "ghost_billing_fix",
    };
    await ghostTransaction.save();

    console.log(`✅ ORIGINAL TRANSACTION MARKED AS CANCELLED`);

    // 7. Update consultation to reflect the fix
    consultation.totalAmount = 0; // No client payment = no amount
    consultation.endReason = "ghost_billing_fixed";
    consultation.metadata = {
      ...consultation.metadata,
      ghostBillingFixed: true,
      fixedAt: new Date(),
      originalAmount: ghostAmount,
    };
    await consultation.save();

    console.log(`✅ CONSULTATION UPDATED - Amount set to ₹0`);

    console.log(`\n🎯 GHOST BILLING FIX COMPLETE:`);
    console.log(`   ✅ Reversed ₹${ghostAmount} from Sai's wallet`);
    console.log(`   ✅ Reversed ₹${ghostAmount} from Sai's earnings`);
    console.log(`   ✅ Created reversal transaction`);
    console.log(`   ✅ Marked original transaction as reversed`);
    console.log(`   ✅ Updated consultation record`);

    console.log(`\n👤 SAI AFTER FIX:`);
    console.log(`   Wallet: ₹${sai.wallet}`);
    console.log(`   Earnings: ₹${sai.earnings}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Ghost billing fix failed:", error);
    process.exit(1);
  }
}

fixGhostBilling();
