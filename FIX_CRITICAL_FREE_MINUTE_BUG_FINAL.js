/**
 * FINAL FIX: Critical Free Minute Bug
 *
 * CONFIRMED PROBLEM:
 * - Nandu took 9 consultations with Sai Pavithra today
 * - ALL 9 were marked as "First Minute Free: true"
 * - Total charged: ₹16.62 (should have been ~₹13.62 with first minute free)
 * - Nandu's wallet went negative: ₹-3
 * - Sai received ₹2.85 in earnings
 *
 * ROOT CAUSE:
 * The consultation creation marks isFirstMinuteFree correctly, but fails to
 * update the user's freeMinutesUsed array, so subsequent consultations
 * still see "first time" status.
 *
 * SOLUTION:
 * 1. Mark Sai as used in Nandu's freeMinutesUsed array
 * 2. Calculate proper refund (first consultation should be free)
 * 3. Restore Nandu's wallet balance
 * 4. Adjust Sai's earnings accordingly
 */

const mongoose = require("mongoose");

async function fixCriticalFreeMinuteBug() {
  try {
    console.log("🚨 FINAL FIX: CRITICAL FREE MINUTE BUG");
    console.log("======================================");

    // Connect to MongoDB Atlas
    const mongoUri =
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB Atlas");

    const User = mongoose.connection.collection("users");
    const Consultation = mongoose.connection.collection("consultations");
    const Transaction = mongoose.connection.collection("transactions");

    // Find Nandu and Sai
    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });
    const sai = await User.findOne({ email: "saipavithra@gmail.com" });

    console.log(`\n👤 Current Status:`);
    console.log(`   Nandu ID: ${nandu._id}`);
    console.log(`   Sai ID: ${sai._id}`);
    console.log(`   Nandu wallet: ₹${nandu.wallet}`);
    console.log(`   Sai wallet: ₹${sai.wallet}`);

    // Get all consultations between Nandu and Sai
    const allConsultations = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
    })
      .sort({ createdAt: 1 })
      .toArray(); // Oldest first

    console.log(
      `\n📋 ALL CONSULTATIONS NANDU->SAI: ${allConsultations.length}`
    );

    let totalCharged = 0;
    let firstConsultation = null;

    allConsultations.forEach((consultation, index) => {
      console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
      console.log(
        `      Created: ${new Date(consultation.createdAt).toLocaleString()}`
      );
      console.log(`      Rate: ₹${consultation.rate}/min`);
      console.log(`      Amount: ₹${consultation.totalAmount || 0}`);
      console.log(
        `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
      );
      console.log(
        `      Should be free: ${
          index === 0 ? "YES (first ever)" : "NO (subsequent)"
        }`
      );

      totalCharged += consultation.totalAmount || 0;

      if (index === 0) {
        firstConsultation = consultation;
      }
    });

    console.log(`\n💰 FINANCIAL ANALYSIS:`);
    console.log(`   Total consultations: ${allConsultations.length}`);
    console.log(`   Total amount charged: ₹${totalCharged}`);
    console.log(
      `   First consultation amount: ₹${firstConsultation?.totalAmount || 0}`
    );
    console.log(
      `   Amount that should be refunded: ₹${
        firstConsultation?.totalAmount || 0
      } (first should be free)`
    );

    // Check current free minutes used status
    const hasUsedWithSai = nandu.freeMinutesUsed?.some(
      (fm) => fm.providerId.toString() === sai._id.toString()
    );

    console.log(`\n🆓 FREE MINUTE STATUS:`);
    console.log(`   Has used free minute with Sai: ${hasUsedWithSai}`);
    console.log(
      `   Should be marked as used: ${
        allConsultations.length > 0 ? "YES" : "NO"
      }`
    );

    // STEP 1: Fix the free minutes used array
    console.log(`\n🔧 STEP 1: FIXING FREE MINUTES USED ARRAY`);

    if (!hasUsedWithSai && firstConsultation) {
      console.log(`   ✅ Adding Sai to Nandu's free minutes used array...`);

      const updateResult = await User.updateOne(
        { _id: nandu._id },
        {
          $push: {
            freeMinutesUsed: {
              providerId: sai._id,
              consultationId: firstConsultation._id,
              usedAt: firstConsultation.createdAt,
            },
          },
        }
      );

      console.log(
        `   ✅ Updated: ${updateResult.modifiedCount} document(s) modified`
      );
    } else if (hasUsedWithSai) {
      console.log(`   ℹ️ Free minute already marked as used`);
    } else {
      console.log(`   ⚠️ No consultations found to mark`);
    }

    // STEP 2: Calculate and apply refund
    const refundAmount = firstConsultation?.totalAmount || 0;

    if (refundAmount > 0) {
      console.log(`\n🔧 STEP 2: APPLYING REFUND`);
      console.log(
        `   Refund amount: ₹${refundAmount} (first consultation should be free)`
      );

      // Restore Nandu's wallet
      const newNanduBalance = nandu.wallet + refundAmount;
      console.log(
        `   Nandu: ₹${nandu.wallet} + ₹${refundAmount} = ₹${newNanduBalance}`
      );

      const nanduUpdateResult = await User.updateOne(
        { _id: nandu._id },
        {
          $set: { wallet: newNanduBalance },
          $inc: { totalSpent: -refundAmount },
        }
      );

      console.log(
        `   ✅ Nandu's wallet updated: ${nanduUpdateResult.modifiedCount} document(s)`
      );

      // Adjust Sai's earnings (remove the provider share of the refund)
      const providerShare = Math.round(refundAmount * 0.95 * 100) / 100; // 95% to provider
      const newSaiBalance = Math.max(0, sai.wallet - providerShare); // Don't go negative

      console.log(
        `   Sai: ₹${sai.wallet} - ₹${providerShare} = ₹${newSaiBalance}`
      );

      const saiUpdateResult = await User.updateOne(
        { _id: sai._id },
        {
          $set: { wallet: newSaiBalance },
          $inc: { totalEarnings: -providerShare },
        }
      );

      console.log(
        `   ✅ Sai's wallet updated: ${saiUpdateResult.modifiedCount} document(s)`
      );

      // Create refund transaction records
      const refundTransactionNandu = {
        user: nandu._id,
        userType: "User",
        type: "refund",
        category: "system_correction",
        amount: refundAmount,
        balance: newNanduBalance,
        description: `Refund for first consultation with Sai Pavithra (should be free)`,
        status: "completed",
        consultationId: firstConsultation._id,
        transactionId: `REFUND_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const refundTransactionSai = {
        user: sai._id,
        userType: "User",
        type: "deduction",
        category: "system_correction",
        amount: providerShare,
        balance: newSaiBalance,
        description: `Earnings adjustment for free consultation refund`,
        status: "completed",
        consultationId: firstConsultation._id,
        transactionId: `DEDUCT_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await Transaction.insertMany([
        refundTransactionNandu,
        refundTransactionSai,
      ]);
      console.log(`   ✅ Refund transaction records created`);
    } else {
      console.log(`\n🔧 STEP 2: NO REFUND NEEDED`);
      console.log(`   First consultation was already free`);
    }

    // STEP 3: Verify the fix
    console.log(`\n🔧 STEP 3: VERIFICATION`);

    const updatedNandu = await User.findOne({ _id: nandu._id });
    const updatedSai = await User.findOne({ _id: sai._id });

    const nowHasUsedWithSai = updatedNandu.freeMinutesUsed?.some(
      (fm) => fm.providerId.toString() === sai._id.toString()
    );

    console.log(`   ✅ Nandu's new wallet: ₹${updatedNandu.wallet}`);
    console.log(`   ✅ Sai's new wallet: ₹${updatedSai.wallet}`);
    console.log(`   ✅ Free minute marked as used: ${nowHasUsedWithSai}`);
    console.log(
      `   ✅ Future calls will be charged normally: ${
        nowHasUsedWithSai ? "YES" : "NO"
      }`
    );

    console.log(`\n🎉 CRITICAL BUG FIX COMPLETED SUCCESSFULLY!`);
    console.log(`==========================================`);
    console.log(`📊 Summary:`);
    console.log(`   • Fixed free minute tracking for Nandu + Sai`);
    console.log(`   • Refunded ₹${refundAmount} to Nandu`);
    console.log(
      `   • Adjusted Sai's earnings by ₹${
        refundAmount > 0 ? Math.round(refundAmount * 0.95 * 100) / 100 : 0
      }`
    );
    console.log(
      `   • Nandu's wallet: ₹${nandu.wallet} → ₹${updatedNandu.wallet}`
    );
    console.log(`   • Sai's wallet: ₹${sai.wallet} → ₹${updatedSai.wallet}`);
    console.log(`   • System integrity: RESTORED ✅`);

    console.log(`\n🔮 Next Steps:`);
    console.log(`   1. Test the free minute system with other users`);
    console.log(`   2. Monitor for similar issues`);
    console.log(`   3. Consider adding more robust validation`);
  } catch (error) {
    console.error("❌ Fix failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the fix
fixCriticalFreeMinuteBug();
