// Create missing transaction records for the consultation billing
const mongoose = require('mongoose');
require('dotenv').config();

const { Transaction } = require('../src/models');

async function createMissingTransactions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    const amitId = '6937d5da082dde1474b170b9';
    const raviId = '693bb59f52886864ad343644';

    console.log('\n📝 CREATING MISSING TRANSACTION RECORDS');
    console.log('=' .repeat(50));

    // Check if transactions already exist
    const existingTransactions = await Transaction.find({
      consultationId: consultationId
    });

    if (existingTransactions.length > 0) {
      console.log('⚠️ Transactions already exist for this consultation');
      return;
    }

    // Consultation details
    const consultationAmount = 540; // 12 minutes × ₹45
    const platformCommission = consultationAmount * 0.05; // ₹27
    const providerEarnings = consultationAmount * 0.95; // ₹513

    console.log('💰 Creating transactions for:');
    console.log(`   Total Amount: ₹${consultationAmount}`);
    console.log(`   Platform Commission: ₹${platformCommission}`);
    console.log(`   Provider Earnings: ₹${providerEarnings}`);

    // 1. Client payment transaction
    const clientTransaction = new Transaction({
      user: amitId,
      userType: 'User',
      type: 'consultation_payment',
      category: 'consultation',
      amount: consultationAmount,
      balance: 210, // Current balance after deduction
      description: `Consultation payment - video with Ravi Roy`,
      status: 'completed',
      consultationId: consultationId,
      transactionId: `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: 'video',
        providerId: raviId,
        ratePerMinute: 45,
        duration: 12,
        retroactiveRecord: true
      }
    });

    // 2. Provider earning transaction
    const providerTransaction = new Transaction({
      user: raviId,
      userType: 'User',
      type: 'earning',
      category: 'consultation',
      amount: providerEarnings,
      balance: 1206, // Current balance after credit
      description: `Consultation earning - video consultation`,
      status: 'completed',
      consultationId: consultationId,
      transactionId: `EARN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: 'video',
        clientId: amitId,
        clientType: 'User',
        ratePerMinute: 45,
        platformCommission: platformCommission,
        grossAmount: consultationAmount,
        netAmount: providerEarnings,
        retroactiveRecord: true
      }
    });

    // Save transactions
    console.log('\n💾 Saving transaction records...');
    
    await clientTransaction.save();
    console.log('✅ Client payment transaction created');
    
    await providerTransaction.save();
    console.log('✅ Provider earning transaction created');

    console.log('\n📊 Transaction Summary:');
    console.log(`   Client (Amit): -₹${consultationAmount} (consultation_payment)`);
    console.log(`   Provider (Ravi): +₹${providerEarnings} (earning)`);
    console.log(`   Platform Commission: ₹${platformCommission} (tracked in metadata)`);

    console.log('\n🎉 Missing transaction records created successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

createMissingTransactions();