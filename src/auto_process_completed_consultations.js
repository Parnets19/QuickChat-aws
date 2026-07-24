// Auto-process completed consultations that have no transactions
const { Consultation, User, Guest, Transaction } = require("./models");
const { addEarnings } = require("./controllers/earnings.controller");

async function autoProcessCompletedConsultations() {
  try {
    console.log(
      "🔄 Checking for completed consultations without transactions..."
    );

    // Find completed consultations that have no transactions
    // Only process consultations from the last 2 hours to avoid retroactive charging
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const completedConsultations = await Consultation.find({
      status: "completed",
      totalAmount: { $gt: 0 },
      endTime: { $gte: twoHoursAgo },
    });

    console.log(
      `📋 Found ${completedConsultations.length} completed consultations`
    );

    for (const consultation of completedConsultations) {
      // Check if transactions already exist for this consultation
      const existingClientTx = await Transaction.findOne({
        consultationId: consultation._id,
        type: { $in: ["consultation_payment", "debit"] },
      });

      const existingProviderTx = await Transaction.findOne({
        consultationId: consultation._id,
        type: "earning",
      });

      if (!existingClientTx || !existingProviderTx) {
        console.log(`\n🔧 Processing consultation ${consultation._id}:`);
        console.log(`   Amount: ₹${consultation.totalAmount}`);
        console.log(`   Duration: ${consultation.duration} minutes`);
        console.log(`   Client transaction exists: ${!!existingClientTx}`);
        console.log(`   Provider transaction exists: ${!!existingProviderTx}`);

        // Get users - handle both regular users and guest users
        let client, provider;

        // Get client (could be User or Guest)
        if (consultation.userType === "Guest") {
          client = await Guest.findById(consultation.user);
        } else {
          client = await User.findById(consultation.user);
        }

        // Provider is always a User
        provider = await User.findById(consultation.provider);

        if (!client || !provider) {
          console.log(
            `   ❌ Users not found (client: ${!!client}, provider: ${!!provider}), skipping...`
          );
          continue;
        }

        console.log(
          `   👤 Client: ${client.fullName || client.name} (${
            consultation.userType
          })`
        );
        console.log(`   👤 Provider: ${provider.fullName}`);

        const totalAmount = consultation.totalAmount;
        const PLATFORM_COMMISSION_RATE = 0.10;
        const platformCommission =
          Math.round(totalAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
        const providerEarnings =
          Math.round((totalAmount - platformCommission) * 100) / 100;

        // Process client deduction if missing
        if (!existingClientTx) {
          // 🛡️ WALLET PROTECTION: Check balance and charge what user can afford
          let chargeAmount = totalAmount;
          if (client.wallet < totalAmount) {
            // Charge what they can afford instead of skipping
            chargeAmount = Math.floor(client.wallet * 100) / 100;
            console.log(`   ⚠️ PARTIAL CHARGE: User has ₹${client.wallet}, charging ₹${chargeAmount} instead of ₹${totalAmount}`);
            
            if (chargeAmount < 0.01) {
              console.log(`   🚨 BALANCE TOO LOW (₹${client.wallet}) - skipping`);
              continue;
            }
          }

          // Recalculate commission based on actual charge amount
          const actualPlatformCommission = Math.round(chargeAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
          const actualProviderEarnings = Math.round((chargeAmount - actualPlatformCommission) * 100) / 100;

          console.log(`   💸 Deducting ₹${chargeAmount} from client`);
          client.wallet -= chargeAmount;

          // 🛡️ SAFETY CHECK: Ensure wallet never goes negative
          if (client.wallet < 0) {
            console.log(`   🚨 WALLET WENT NEGATIVE - CORRECTING:`, {
              clientId: client._id,
              walletBefore: client.wallet + totalAmount,
              walletAfter: client.wallet,
              correction: "Setting to 0",
            });
            client.wallet = 0;
          }

          // Update totalSpent for both regular users and guest users
          client.totalSpent = (client.totalSpent || 0) + chargeAmount;

          await client.save();

          await Transaction.create({
            user: client._id,
            userType: consultation.userType,
            type: "consultation_payment",
            category: "consultation",
            amount: chargeAmount,
            balance: client.wallet,
            status: "completed",
            description: `${consultation.type} consultation with ${provider.fullName}`,
            consultationId: consultation._id,
            transactionId: `AUTO_CLIENT_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          });
        }

        // Process provider earnings if missing
        if (!existingProviderTx) {
          const earningsToCredit = existingClientTx ? providerEarnings : actualProviderEarnings;
          console.log(`   💰 Adding ₹${earningsToCredit} to provider`);
          provider.wallet += earningsToCredit;
          provider.earnings = (provider.earnings || 0) + earningsToCredit;
          await provider.save();

          await Transaction.create({
            user: provider._id,
            userType: "User",
            type: "earning",
            category: "consultation",
            amount: earningsToCredit,
            balance: provider.wallet,
            status: "completed",
            description: `${
              consultation.type.charAt(0).toUpperCase() +
              consultation.type.slice(1)
            } Consultation - ${client.fullName || client.name}`,
            consultationId: consultation._id,
            transactionId: `AUTO_PROVIDER_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            metadata: {
              clientName: client.fullName || client.name,
              consultationType: consultation.type,
              duration: consultation.duration,
              rate: consultation.rate,
              platformCommission: existingClientTx ? platformCommission : actualPlatformCommission,
              grossAmount: existingClientTx ? totalAmount : chargeAmount,
              netAmount: earningsToCredit,
            },
          });
        }

        console.log(`   ✅ Consultation processed successfully`);
      }
    }

    console.log("\n✅ Auto-processing completed");
  } catch (error) {
    console.error("❌ Error in auto-processing:", error);
  }
}

module.exports = { autoProcessCompletedConsultations };
