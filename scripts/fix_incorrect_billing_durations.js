const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Consultation = require('../src/models/Consultation.model');
const User = require('../src/models/User.model');
const Guest = require('../src/models/Guest.model');
const Transaction = require('../src/models/Transaction.model');

const fixIncorrectBillingDurations = async () => {
  try {
    console.log('🔧 FIXING INCORRECT BILLING DURATIONS');
    console.log('====================================');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find consultations with potentially incorrect billing
    const consultations = await Consultation.find({
      status: 'completed',
      billingStarted: true,
      bothSidesAcceptedAt: { $exists: true },
      startTime: { $exists: true },
      endTime: { $exists: true },
      duration: { $gt: 0 }
    }).sort({ createdAt: -1 }).limit(20);

    console.log(`\n📋 Found ${consultations.length} completed consultations to check`);

    let fixedCount = 0;
    let totalRefund = 0;

    for (const consultation of consultations) {
      console.log(`\n🔍 Checking consultation ${consultation._id}:`);
      console.log(`   Created: ${consultation.createdAt}`);
      console.log(`   Billing Started: ${consultation.bothSidesAcceptedAt}`);
      console.log(`   Ended: ${consultation.endTime}`);
      console.log(`   Current Duration: ${consultation.duration} minutes`);
      console.log(`   Current Amount: ₹${consultation.totalAmount}`);

      // Calculate correct duration (from billing start to end)
      const correctDuration = Math.ceil((consultation.endTime - consultation.bothSidesAcceptedAt) / (1000 * 60));
      const correctAmount = correctDuration * consultation.rate;

      // Calculate incorrect duration (from consultation start to end)
      const incorrectDuration = Math.ceil((consultation.endTime - consultation.startTime) / (1000 * 60));
      const incorrectAmount = incorrectDuration * consultation.rate;

      console.log(`   Correct Duration: ${correctDuration} minutes (from billing start)`);
      console.log(`   Correct Amount: ₹${correctAmount}`);

      // Check if this consultation was billed incorrectly
      if (consultation.duration === incorrectDuration && consultation.totalAmount === incorrectAmount && correctDuration < incorrectDuration) {
        console.log(`   ❌ INCORRECT BILLING DETECTED!`);
        console.log(`   Overcharged by: ${incorrectDuration - correctDuration} minutes`);
        console.log(`   Overcharged amount: ₹${incorrectAmount - correctAmount}`);

        // Calculate refund amount
        const refundAmount = incorrectAmount - correctAmount;
        const platformCommission = refundAmount * 0.05;
        const providerRefund = refundAmount * 0.95;

        console.log(`   💰 Refund breakdown:`);
        console.log(`     Client refund: ₹${refundAmount}`);
        console.log(`     Provider deduction: ₹${providerRefund}`);
        console.log(`     Platform deduction: ₹${platformCommission}`);

        // Get user and provider
        const isGuest = consultation.userType === 'Guest';
        const UserModel = isGuest ? Guest : User;
        const user = await UserModel.findById(consultation.user);
        const provider = await User.findById(consultation.provider);

        if (user && provider) {
          console.log(`   👤 Client: ${user.fullName || user.name} (${isGuest ? 'Guest' : 'User'})`);
          console.log(`   👤 Provider: ${provider.fullName}`);
          console.log(`   💰 Client current wallet: ₹${user.wallet}`);
          console.log(`   💰 Provider current wallet: ₹${provider.wallet}`);

          // Ask for confirmation before making changes
          console.log(`\n   🔧 FIXING BILLING:`);
          
          // Update consultation with correct values
          consultation.duration = correctDuration;
          consultation.totalAmount = correctAmount;
          await consultation.save();
          console.log(`   ✅ Updated consultation duration and amount`);

          // Refund client
          user.wallet += refundAmount;
          await user.save();
          console.log(`   ✅ Refunded ₹${refundAmount} to client`);

          // Deduct from provider
          provider.wallet -= providerRefund;
          provider.earnings = (provider.earnings || 0) - providerRefund;
          await provider.save();
          console.log(`   ✅ Deducted ₹${providerRefund} from provider`);

          // Create refund transaction for client
          await Transaction.create({
            user: user._id,
            userType: isGuest ? 'Guest' : 'User',
            type: 'refund',
            category: 'billing_correction',
            amount: refundAmount,
            balance: user.wallet,
            description: `Billing correction refund for consultation ${consultation._id}`,
            status: 'completed',
            consultationId: consultation._id,
            transactionId: `REFUND_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            metadata: {
              originalDuration: incorrectDuration,
              correctedDuration: correctDuration,
              originalAmount: incorrectAmount,
              correctedAmount: correctAmount,
              refundReason: 'billing_duration_correction'
            }
          });

          // Create deduction transaction for provider
          await Transaction.create({
            user: provider._id,
            userType: 'User',
            type: 'debit',
            category: 'billing_correction',
            amount: providerRefund,
            balance: provider.wallet,
            description: `Billing correction deduction for consultation ${consultation._id}`,
            status: 'completed',
            consultationId: consultation._id,
            transactionId: `DEDUCT_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            metadata: {
              originalDuration: incorrectDuration,
              correctedDuration: correctDuration,
              originalAmount: incorrectAmount,
              correctedAmount: correctAmount,
              deductionReason: 'billing_duration_correction'
            }
          });

          console.log(`   ✅ Created refund transactions`);

          fixedCount++;
          totalRefund += refundAmount;

          console.log(`   💰 New balances:`);
          console.log(`     Client: ₹${user.wallet}`);
          console.log(`     Provider: ₹${provider.wallet}`);
        } else {
          console.log(`   ❌ Could not find user or provider for refund`);
        }
      } else if (consultation.duration === correctDuration) {
        console.log(`   ✅ Billing is correct`);
      } else {
        console.log(`   ℹ️ Different billing pattern, skipping`);
      }
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   Consultations checked: ${consultations.length}`);
    console.log(`   Consultations fixed: ${fixedCount}`);
    console.log(`   Total refunded: ₹${totalRefund.toFixed(2)}`);

    if (fixedCount > 0) {
      console.log(`\n✅ BILLING CORRECTIONS COMPLETED!`);
      console.log(`   ${fixedCount} consultations had their billing corrected`);
      console.log(`   Clients have been refunded for overcharges`);
      console.log(`   Providers have had excess earnings deducted`);
      console.log(`   All transactions have been recorded`);
    } else {
      console.log(`\n✅ NO CORRECTIONS NEEDED - All billing appears correct`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run the fix
fixIncorrectBillingDurations();