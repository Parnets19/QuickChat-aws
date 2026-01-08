const mongoose = require("mongoose");
const { Consultation, User, Transaction } = require("./src/models");
require("dotenv").config();

/**
 * END: The stuck ongoing consultation properly
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

async function endStuckConsultation() {
  console.log("🛑 ENDING STUCK CONSULTATION");
  console.log("=".repeat(50));

  try {
    await connectDB();

    // Find the ongoing consultation
    const consultation = await Consultation.findOne({
      status: "ongoing",
    })
      .populate("user", "fullName wallet")
      .populate("provider", "fullName wallet earnings");

    if (!consultation) {
      console.log("✅ No ongoing consultations found");
      process.exit(0);
      return;
    }

    console.log(`📋 FOUND STUCK CONSULTATION:`);
    console.log(`   ID: ${consultation._id}`);
    console.log(
      `   Client: ${consultation.user?.fullName || "Unknown"} (ID: ${
        consultation.user
      })`
    );
    console.log(`   Provider: ${consultation.provider?.fullName || "Unknown"}`);
    console.log(`   Type: ${consultation.type}`);
    console.log(`   Rate: ₹${consultation.rate}/min`);
    console.log(`   Started: ${consultation.startTime}`);
    console.log(`   Both Accepted: ${consultation.bothSidesAcceptedAt}`);
    console.log(`   Billing Started: ${consultation.billingStarted}`);

    // Calculate duration and amount
    const endTime = new Date();
    let finalDuration = 0;
    let finalAmount = 0;

    if (consultation.bothSidesAcceptedAt && consultation.billingStarted) {
      // Calculate EXACT duration in seconds
      const durationInSeconds = Math.floor(
        (endTime - consultation.bothSidesAcceptedAt) / 1000
      );

      // Charge per second for precise billing
      const ratePerSecond = consultation.rate / 60;
      finalAmount = Math.round(durationInSeconds * ratePerSecond * 100) / 100;
      finalDuration = Math.round((durationInSeconds / 60) * 100) / 100;

      console.log(`\n💰 BILLING CALCULATION:`);
      console.log(
        `   Duration: ${finalDuration} minutes (${durationInSeconds} seconds)`
      );
      console.log(`   Rate: ₹${consultation.rate}/min`);
      console.log(`   Total Amount: ₹${finalAmount}`);
    }

    // Check for existing transactions to prevent duplicate billing
    const existingClientPayment = await Transaction.findOne({
      user: consultation.user,
      consultationId: consultation._id,
      type: { $in: ["consultation_payment", "consultation"] },
      amount: { $gt: 0 },
    });

    const existingProviderEarning = await Transaction.findOne({
      user: consultation.provider,
      consultationId: consultation._id,
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

    // End the consultation
    consultation.status = "completed";
    consultation.endTime = endTime;
    consultation.duration = finalDuration;
    consultation.totalAmount = finalAmount;
    consultation.endReason = "manual_cleanup";

    // Only process billing if amount > 0 AND no existing transactions
    if (finalAmount > 0 && !existingClientPayment && !existingProviderEarning) {
      console.log(`\n💰 PROCESSING BILLING...`);

      // Get client (could be User or Guest)
      let client = null;
      if (consultation.userType === "Guest") {
        const { Guest } = require("./src/models");
        client = await Guest.findById(consultation.user);
      } else {
        client = await User.findById(consultation.user);
      }

      const provider = await User.findById(consultation.provider);

      if (!client || !provider) {
        console.log("❌ Client or provider not found - ending without billing");
        consultation.totalAmount = 0;
      } else {
        console.log(`\n👤 CLIENT DETAILS:`);
        console.log(`   Name: ${client.fullName || client.name || "Unknown"}`);
        console.log(`   Wallet: ₹${client.wallet || 0}`);
        console.log(`   Type: ${consultation.userType || "User"}`);

        console.log(`\n👤 PROVIDER DETAILS:`);
        console.log(`   Name: ${provider.fullName}`);
        console.log(`   Wallet: ₹${provider.wallet || 0}`);
        console.log(`   Earnings: ₹${provider.earnings || 0}`);

        // Check if client has sufficient balance
        if (client.wallet >= finalAmount) {
          console.log(
            `\n✅ Client has sufficient balance - processing billing`
          );

          // Calculate commission split
          const platformCommission = Math.round(finalAmount * 0.05 * 100) / 100;
          const providerEarnings = Math.round(finalAmount * 0.95 * 100) / 100;

          console.log(`   Platform Commission (5%): ₹${platformCommission}`);
          console.log(`   Provider Earnings (95%): ₹${providerEarnings}`);

          // Deduct from client
          client.wallet -= finalAmount;
          client.totalSpent = (client.totalSpent || 0) + finalAmount;
          await client.save();
          console.log(`   ✅ Deducted ₹${finalAmount} from client`);

          // Credit to provider
          provider.wallet = (provider.wallet || 0) + providerEarnings;
          provider.earnings = (provider.earnings || 0) + providerEarnings;
          await provider.save();
          console.log(`   ✅ Credited ₹${providerEarnings} to provider`);

          // Create transactions
          const clientTransaction = new Transaction({
            user: client._id,
            userType: consultation.userType || "User",
            type: "consultation_payment",
            category: "consultation",
            amount: finalAmount,
            balance: client.wallet,
            description: `${consultation.type} consultation with ${provider.fullName}`,
            status: "completed",
            consultationId: consultation._id,
            transactionId: `CLEANUP_PAY_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          });

          const providerTransaction = new Transaction({
            user: provider._id,
            userType: "User",
            type: "earning",
            category: "consultation",
            amount: providerEarnings,
            balance: provider.wallet,
            description: `${consultation.type} consultation - ${
              client.fullName || client.name || "Client"
            }`,
            status: "completed",
            consultationId: consultation._id,
            transactionId: `CLEANUP_EARN_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          });

          await Promise.all([
            clientTransaction.save(),
            providerTransaction.save(),
          ]);
          console.log(`   ✅ Created billing transactions`);

          console.log(`\n💰 FINAL BALANCES:`);
          console.log(`   Client Wallet: ₹${client.wallet}`);
          console.log(`   Provider Wallet: ₹${provider.wallet}`);
          console.log(`   Provider Earnings: ₹${provider.earnings}`);
        } else {
          console.log(`\n❌ Insufficient funds - ending without billing`);
          console.log(`   Required: ₹${finalAmount}`);
          console.log(`   Available: ₹${client.wallet}`);
          consultation.totalAmount = 0;
          consultation.endReason = "insufficient_funds";
        }
      }
    } else if (existingClientPayment || existingProviderEarning) {
      console.log(`\n⚠️ Billing already processed - using existing amounts`);
      if (existingClientPayment) {
        consultation.totalAmount = existingClientPayment.amount;
      }
    } else {
      console.log(`\n🆓 No billing needed - free consultation or zero amount`);
    }

    await consultation.save();

    console.log(`\n✅ CONSULTATION ENDED SUCCESSFULLY:`);
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Duration: ${consultation.duration} minutes`);
    console.log(`   Total Amount: ₹${consultation.totalAmount}`);
    console.log(`   End Time: ${consultation.endTime}`);
    console.log(`   End Reason: ${consultation.endReason}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ End consultation failed:", error);
    process.exit(1);
  }
}

endStuckConsultation();
