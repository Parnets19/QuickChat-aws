const mongoose = require("mongoose");
const { User, Consultation, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * FORENSIC ANALYSIS: Trace money flow to find billing discrepancies
 * Check where Sai got money and verify if clients actually paid
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

async function forensicMoneyTrace() {
  console.log("🔍 FORENSIC MONEY TRACE ANALYSIS");
  console.log("=".repeat(70));
  console.log(
    "Investigating billing discrepancies between client payments and provider earnings"
  );
  console.log("=".repeat(70));

  try {
    await connectDB();

    // Find Sai (provider)
    const sai = await User.findOne({
      $or: [{ email: "sai@example.com" }, { fullName: { $regex: /sai/i } }],
    });

    if (!sai) {
      console.log("❌ Sai not found");
      return;
    }

    console.log(`👤 SAI PROVIDER ANALYSIS:`);
    console.log(`   Name: ${sai.fullName}`);
    console.log(`   Current Wallet: ₹${sai.wallet}`);
    console.log(`   Total Earnings: ₹${sai.earnings || 0}`);
    console.log(
      `   Rate: ₹${sai.rates?.audioVideo || sai.rates?.audio || "Not set"}/min`
    );

    // Get all earning transactions for Sai (last 24 hours)
    console.log(`\n💰 SAI'S EARNING TRANSACTIONS (Last 24 hours):`);

    const saiEarnings = await Transaction.find({
      user: sai._id,
      type: "earning",
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }).sort({ createdAt: -1 });

    if (saiEarnings.length === 0) {
      console.log("❌ No earning transactions found for Sai in last 24 hours");
    } else {
      console.log(`Found ${saiEarnings.length} earning transactions:`);

      let totalEarningsFromTransactions = 0;

      for (let i = 0; i < saiEarnings.length; i++) {
        const earning = saiEarnings[i];
        totalEarningsFromTransactions += earning.amount;

        console.log(`\n${i + 1}. EARNING: ₹${earning.amount}`);
        console.log(`   Time: ${earning.createdAt}`);
        console.log(`   Balance After: ₹${earning.balance}`);
        console.log(`   Description: ${earning.description}`);
        console.log(`   Consultation ID: ${earning.consultationId || "None"}`);

        // If there's a consultation ID, check the consultation details
        if (earning.consultationId) {
          console.log(`   🔍 TRACING CONSULTATION: ${earning.consultationId}`);

          const consultation = await Consultation.findById(
            earning.consultationId
          ).populate("user");

          if (consultation) {
            console.log(
              `      Client: ${consultation.user?.fullName || "Unknown"}`
            );
            console.log(
              `      Client ID: ${consultation.user?._id || "Unknown"}`
            );
            console.log(`      Type: ${consultation.type}`);
            console.log(`      Status: ${consultation.status}`);
            console.log(`      Duration: ${consultation.duration || 0} min`);
            console.log(
              `      Total Amount: ₹${consultation.totalAmount || 0}`
            );
            console.log(`      Rate: ₹${consultation.rate}/min`);

            // Now check if the client actually paid for this consultation
            console.log(`      🔍 CHECKING CLIENT PAYMENT...`);

            const clientPayment = await Transaction.findOne({
              user: consultation.user._id,
              consultationId: earning.consultationId,
              type: { $in: ["consultation", "consultation_payment"] },
              amount: { $gt: 0 }, // Positive amount (deduction from client)
            });

            if (clientPayment) {
              console.log(`      ✅ CLIENT PAID: ₹${clientPayment.amount}`);
              console.log(`         Payment Time: ${clientPayment.createdAt}`);
              console.log(
                `         Client Balance After: ₹${clientPayment.balance}`
              );
              console.log(`         Description: ${clientPayment.description}`);

              // Check if amounts match (considering 5% platform commission)
              const expectedProviderEarning =
                Math.round(clientPayment.amount * 0.95 * 100) / 100;
              const actualProviderEarning = earning.amount;

              if (
                Math.abs(expectedProviderEarning - actualProviderEarning) < 0.01
              ) {
                console.log(
                  `      ✅ AMOUNTS MATCH: Client paid ₹${clientPayment.amount}, Provider got ₹${actualProviderEarning} (95%)`
                );
              } else {
                console.log(`      🚨 AMOUNT MISMATCH:`);
                console.log(`         Client paid: ₹${clientPayment.amount}`);
                console.log(
                  `         Expected provider earning (95%): ₹${expectedProviderEarning}`
                );
                console.log(
                  `         Actual provider earning: ₹${actualProviderEarning}`
                );
                console.log(
                  `         Difference: ₹${Math.abs(
                    expectedProviderEarning - actualProviderEarning
                  )}`
                );
              }
            } else {
              console.log(`      🚨 NO CLIENT PAYMENT FOUND!`);
              console.log(
                `      🚨 BILLING BUG DETECTED: Provider got ₹${earning.amount} but client didn't pay!`
              );

              // Check client's current wallet balance
              const client = await User.findById(consultation.user._id);
              if (client) {
                console.log(`         Client: ${client.fullName}`);
                console.log(
                  `         Client Current Wallet: ₹${client.wallet}`
                );
                console.log(
                  `         Client Total Spent: ₹${client.totalSpent || 0}`
                );
              }

              // Check all client transactions around this time
              console.log(`      🔍 CLIENT'S RECENT TRANSACTIONS:`);
              const clientTransactions = await Transaction.find({
                user: consultation.user._id,
                createdAt: {
                  $gte: new Date(earning.createdAt.getTime() - 10 * 60 * 1000), // 10 min before
                  $lte: new Date(earning.createdAt.getTime() + 10 * 60 * 1000), // 10 min after
                },
              }).sort({ createdAt: 1 });

              if (clientTransactions.length === 0) {
                console.log(
                  `         ❌ No client transactions found around this time`
                );
              } else {
                clientTransactions.forEach((tx, idx) => {
                  console.log(
                    `         ${idx + 1}. ${tx.type}: ₹${
                      tx.amount
                    } (Balance: ₹${tx.balance}) - ${tx.createdAt}`
                  );
                });
              }
            }
          } else {
            console.log(
              `      ❌ Consultation not found: ${earning.consultationId}`
            );
          }
        }

        console.log(`   ${"=".repeat(50)}`);
      }

      console.log(`\n📊 SUMMARY FOR SAI:`);
      console.log(
        `   Total earnings from transactions: ₹${totalEarningsFromTransactions.toFixed(
          2
        )}`
      );
      console.log(`   Current wallet balance: ₹${sai.wallet}`);
      console.log(`   Total earnings field: ₹${sai.earnings || 0}`);
    }

    // Now check Nandu's payments to see if there are unmatched payments
    console.log(`\n\n👤 NANDU CLIENT ANALYSIS:`);

    const nandu = await User.findOne({
      $or: [{ email: "nandu@example.com" }, { fullName: { $regex: /nandu/i } }],
    });

    if (nandu) {
      console.log(`   Name: ${nandu.fullName}`);
      console.log(`   Current Wallet: ₹${nandu.wallet}`);
      console.log(`   Total Spent: ₹${nandu.totalSpent || 0}`);

      // Get Nandu's payment transactions (last 24 hours)
      const nanduPayments = await Transaction.find({
        user: nandu._id,
        type: { $in: ["consultation", "consultation_payment"] },
        amount: { $gt: 0 }, // Positive amount (deduction)
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }).sort({ createdAt: -1 });

      console.log(`\n💸 NANDU'S PAYMENT TRANSACTIONS (Last 24 hours):`);

      if (nanduPayments.length === 0) {
        console.log(
          "❌ No payment transactions found for Nandu in last 24 hours"
        );
      } else {
        console.log(`Found ${nanduPayments.length} payment transactions:`);

        for (let i = 0; i < nanduPayments.length; i++) {
          const payment = nanduPayments[i];

          console.log(`\n${i + 1}. PAYMENT: ₹${payment.amount}`);
          console.log(`   Time: ${payment.createdAt}`);
          console.log(`   Balance After: ₹${payment.balance}`);
          console.log(`   Description: ${payment.description}`);
          console.log(
            `   Consultation ID: ${payment.consultationId || "None"}`
          );

          // Check if there's a matching provider earning
          if (payment.consultationId) {
            const matchingEarning = await Transaction.findOne({
              consultationId: payment.consultationId,
              type: "earning",
              user: { $ne: nandu._id }, // Not Nandu (should be provider)
            });

            if (matchingEarning) {
              const provider = await User.findById(matchingEarning.user);
              console.log(`   ✅ MATCHING PROVIDER EARNING FOUND:`);
              console.log(`      Provider: ${provider?.fullName || "Unknown"}`);
              console.log(`      Provider Earned: ₹${matchingEarning.amount}`);
              console.log(
                `      Expected (95% of ₹${payment.amount}): ₹${
                  Math.round(payment.amount * 0.95 * 100) / 100
                }`
              );
            } else {
              console.log(`   🚨 NO MATCHING PROVIDER EARNING FOUND!`);
              console.log(
                `   🚨 Client paid ₹${payment.amount} but no provider was credited!`
              );
            }
          }
        }
      }
    }

    // Final analysis
    console.log(`\n\n🎯 FORENSIC ANALYSIS RESULTS:`);
    console.log(`${"=".repeat(50)}`);

    // Check for billing bugs
    let bugsFound = 0;

    // Re-check for unmatched earnings
    for (const earning of saiEarnings) {
      if (earning.consultationId) {
        const clientPayment = await Transaction.findOne({
          consultationId: earning.consultationId,
          type: { $in: ["consultation", "consultation_payment"] },
          amount: { $gt: 0 },
        });

        if (!clientPayment) {
          bugsFound++;
          console.log(
            `🚨 BUG ${bugsFound}: Provider earned ₹${earning.amount} without client payment (Consultation: ${earning.consultationId})`
          );
        }
      }
    }

    if (bugsFound === 0) {
      console.log(
        `✅ No billing bugs detected - all provider earnings have matching client payments`
      );
    } else {
      console.log(`🚨 CRITICAL: Found ${bugsFound} billing discrepancies!`);
      console.log(
        `   This indicates the "ghost billing" bug where providers get paid but clients aren't charged`
      );
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Forensic analysis failed:", error);
    process.exit(1);
  }
}

forensicMoneyTrace();
