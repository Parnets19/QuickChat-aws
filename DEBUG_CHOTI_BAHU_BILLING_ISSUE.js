/**
 * DEBUG CHOTI BAHU BILLING ISSUE
 *
 * User reported: "video consultation with Choti Bahu 7 Jan 2026-₹0.36
 * i spoke for 1 minutes more than a minutes still .36 paisa why"
 *
 * Expected: ₹3 for 1+ minute call
 * Actual: ₹0.36
 *
 * This suggests a billing calculation error
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { User, Guest, Consultation, Transaction } = require("./src/models");

async function debugChotiBahuBillingIssue() {
  try {
    console.log("🔍 DEBUGGING CHOTI BAHU BILLING ISSUE");
    console.log("====================================");
    console.log("");
    console.log(
      "Issue: User spoke for 1+ minute but charged only ₹0.36 instead of ₹3"
    );
    console.log("Date: 7 Jan 2026");
    console.log("Provider: Choti Bahu");
    console.log("");

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    // Step 1: Find Choti Bahu provider
    console.log("1️⃣ Finding Choti Bahu provider...");
    const chotiBahu = await User.findOne({
      fullName: { $regex: /choti.*bahu/i },
    }).select("_id fullName rates");

    if (!chotiBahu) {
      console.log("❌ Choti Bahu provider not found");
      return;
    }

    console.log("✅ Found Choti Bahu:");
    console.log(`   ID: ${chotiBahu._id}`);
    console.log(`   Name: ${chotiBahu.fullName}`);
    console.log(`   Current rates:`, {
      audioVideo: chotiBahu.rates?.perMinute?.audioVideo || 0,
      audio: chotiBahu.rates?.perMinute?.audio || 0,
      video: chotiBahu.rates?.perMinute?.video || 0,
      legacy_audio: chotiBahu.rates?.audio || 0,
      legacy_video: chotiBahu.rates?.video || 0,
    });

    // Step 2: Find recent consultations with Choti Bahu (last 7 days)
    console.log("\n2️⃣ Finding recent consultations with Choti Bahu...");

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);

    const consultations = await Consultation.find({
      provider: chotiBahu._id,
      createdAt: { $gte: recentDate },
      status: { $in: ["completed", "ended"] },
    })
      .populate("user", "fullName mobile")
      .sort({ createdAt: -1 })
      .limit(20);

    console.log(
      `📊 Found ${consultations.length} recent consultations with Choti Bahu`
    );

    if (consultations.length === 0) {
      console.log("❌ No recent consultations found");
      return;
    }

    // Step 3: Analyze each consultation
    console.log("\n3️⃣ Analyzing consultations...");

    let foundIssue = false;

    for (const consultation of consultations) {
      console.log(`\n📞 Consultation ${consultation._id}:`);
      console.log(
        `   User: ${consultation.user?.fullName || "Unknown"} (${
          consultation.user?.mobile || "N/A"
        })`
      );
      console.log(`   Date: ${consultation.createdAt}`);
      console.log(`   Type: ${consultation.type}`);
      console.log(`   Rate: ₹${consultation.rate}/min`);
      console.log(`   Duration: ${consultation.duration || 0} minutes`);
      console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);
      console.log(`   Status: ${consultation.status}`);
      console.log(
        `   Free Trial: ${consultation.isFirstTimeFreeTrial ? "YES" : "NO"}`
      );
      console.log(
        `   Entire Call Free: ${consultation.entireCallFree ? "YES" : "NO"}`
      );

      // Check for billing issues
      const totalAmount = consultation.totalAmount || 0;
      const duration = consultation.duration || 0;
      const rate = consultation.rate || 0;

      // Check if this matches the ₹0.36 charge or similar small amounts
      if (totalAmount > 0 && totalAmount < 1) {
        console.log("   🎯 FOUND SUSPICIOUS SMALL CHARGE!");
        foundIssue = true;

        // Calculate what the charge should be
        const expectedRate = 3; // ₹3 per minute
        const expectedCharge = Math.ceil(duration) * expectedRate;

        console.log(`   📊 BILLING ANALYSIS:`);
        console.log(`      Expected rate: ₹${expectedRate}/min`);
        console.log(`      Actual duration: ${duration} minutes`);
        console.log(`      Expected charge: ₹${expectedCharge}`);
        console.log(`      Actual charge: ₹${totalAmount}`);
        console.log(`      Rate used: ₹${rate}/min`);
        console.log(`      Difference: ₹${expectedCharge - totalAmount}`);

        if (rate !== 3) {
          console.log(
            `   ❌ PROBLEM: Consultation used ₹${rate}/min instead of ₹3/min`
          );
        }

        if (consultation.isFirstTimeFreeTrial || consultation.entireCallFree) {
          console.log(
            "   ⚠️  This was marked as free trial - should be ₹0, not ₹" +
              totalAmount
          );
        }

        // Check if it's a fractional billing issue
        if (duration > 0 && totalAmount > 0) {
          const calculatedAmount = duration * rate;
          console.log(
            `      Calculated amount (duration × rate): ₹${calculatedAmount}`
          );

          if (Math.abs(calculatedAmount - totalAmount) < 0.01) {
            console.log(
              "   🔍 ISSUE: Using fractional billing instead of per-minute billing"
            );
            console.log("   🔧 SOLUTION: Should round up to full minutes");
          }
        }
      }

      // Check for correct ₹3 billing
      if (totalAmount >= 3 && rate === 3) {
        console.log("   ✅ CORRECT: Proper ₹3/min billing");
      }
    }

    // Step 4: Check recent transactions for small amounts
    console.log("\n4️⃣ Checking recent transactions for small amounts...");

    const recentTransactions = await Transaction.find({
      providerId: chotiBahu._id,
      amount: { $gt: 0, $lt: 1 },
      createdAt: { $gte: recentDate },
    })
      .populate("userId", "fullName mobile")
      .sort({ createdAt: -1 });

    console.log(
      `📊 Found ${recentTransactions.length} transactions with small amounts`
    );

    for (const transaction of recentTransactions) {
      console.log(`\n💳 Transaction ${transaction._id}:`);
      console.log(`   User: ${transaction.userId?.fullName || "Unknown"}`);
      console.log(`   Amount: ₹${transaction.amount}`);
      console.log(`   Type: ${transaction.type}`);
      console.log(`   Date: ${transaction.createdAt}`);
      console.log(`   Consultation: ${transaction.consultationId}`);

      if (transaction.amount === 0.36) {
        console.log("   🎯 FOUND THE ₹0.36 TRANSACTION!");
        foundIssue = true;
      }
    }

    // Step 5: Provide solution
    console.log("\n🔧 BILLING ISSUE ANALYSIS:");
    console.log("==========================");

    if (!foundIssue) {
      console.log("✅ No obvious billing issues found in recent consultations");
      console.log("💡 The ₹0.36 charge might be from an older consultation");
    } else {
      console.log("❌ BILLING ISSUES DETECTED!");
    }

    console.log("\n💡 POSSIBLE CAUSES OF ₹0.36 CHARGE:");
    console.log("1. Old rate (₹1/min) was used: 0.36 minutes × ₹1 = ₹0.36");
    console.log("2. Fractional billing: 0.12 minutes × ₹3 = ₹0.36");
    console.log("3. Free trial malfunction: Should be ₹0 or ₹3, not ₹0.36");
    console.log("4. Round-up billing not working properly");

    console.log("\n🔧 RECOMMENDED FIXES:");
    console.log("1. ✅ Choti Bahu rate updated to ₹3/min (already done)");
    console.log("2. 🔧 Fix billing to use current provider rates");
    console.log("3. 🔧 Implement proper minute-based billing (round up)");
    console.log("4. 🔧 Fix free trial logic");
    console.log("5. 🔧 Prevent fractional billing");

    await mongoose.disconnect();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error debugging billing issue:", error);
    process.exit(1);
  }
}

// Run the debug
debugChotiBahuBillingIssue();
