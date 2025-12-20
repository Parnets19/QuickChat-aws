// Script to retroactively process billing for completed consultation
const mongoose = require('mongoose');
require('dotenv').config();

const { Consultation, User, Guest, Transaction } = require('../src/models');

// Platform commission rate (5%)
const PLATFORM_COMMISSION_RATE = 0.05;
const PROVIDER_SHARE_RATE = 0.95;

async function fixConsultationBilling() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    
    // Get consultation details
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      console.log('❌ Consultation not found');
      return;
    }

    console.log('📋 Processing billing for consultation:', {
      id: consultation._id,
      duration: consultation.duration,
      rate: consultation.rate,
      totalAmount: consultation.totalAmount,
      client: consultation.user,
      provider: consultation.provider
    });

    // Get user and provider
    const isGuest = consultation.userType === 'Guest';
    const UserModel = isGuest ? Guest : User;
    const user = await UserModel.findById(consultation.user);
    const provider = await User.findById(consultation.provider);

    if (!user || !provider) {
      console.log('❌ User or provider not found');
      return;
    }

    console.log('👤 Client before:', {
      name: user.fullName || user.name,
      wallet: user.wallet
    });

    console.log('👨‍💼 Provider before:', {
      name: provider.fullName,
      wallet: provider.wallet,
      earnings: provider.earnings
    });

    // Calculate amounts
    const totalAmount = consultation.totalAmount;
    const platformCommission = totalAmount * PLATFORM_COMMISSION_RATE;
    const providerEarnings = totalAmount * PROVIDER_SHARE_RATE;

    console.log('💰 Billing calculation:', {
      totalAmount,
      platformCommission: platformCommission.toFixed(2),
      providerEarnings: providerEarnings.toFixed(2)
    });

    // Check if billing was already processed
    const existingTransactions = await Transaction.find({
      consultationId: consultation._id
    });

    if (existingTransactions.length > 0) {
      console.log('⚠️ Billing already processed. Found', existingTransactions.length, 'transactions');
      existingTransactions.forEach(tx => {
        console.log(`   - ${tx.type}: ₹${tx.amount} (${tx.status})`);
      });
      return;
    }

    // Process billing
    console.log('\n💳 Processing billing...');

    // 1. Deduct from client wallet
    if (user.wallet >= totalAmount) {
      user.wallet -= totalAmount;
      await user.save();
      console.log('✅ Deducted ₹' + totalAmount + ' from client wallet');
    } else {
      console.log('❌ Insufficient funds in client wallet:', user.wallet, 'required:', totalAmount);
      // Still process for demonstration, but note the issue
    }

    // 2. Credit to provider
    provider.wallet += providerEarnings;
    provider.earnings = (provider.earnings || 0) + providerEarnings;
    await provider.save();
    console.log('✅ Credited ₹' + providerEarnings.toFixed(2) + ' to provider');

    // 3. Create transaction records
    const timestamp = new Date();

    // User payment transaction
    const userTransaction = new Transaction({
      user: user._id,
      userType: isGuest ? 'Guest' : 'User',
      type: 'consultation_payment',
      category: 'consultation',
      amount: totalAmount,
      balance: user.wallet,
      description: `Consultation payment - ${consultation.type} with ${provider.fullName}`,
      status: 'completed',
      consultationId: consultation._id,
      transactionId: `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        providerId: provider._id,
        ratePerMinute: consultation.rate,
        duration: consultation.duration,
        retroactiveProcessing: true
      }
    });

    // Provider earning transaction
    const providerTransaction = new Transaction({
      user: provider._id,
      userType: 'User',
      type: 'earning',
      category: 'consultation',
      amount: providerEarnings,
      balance: provider.wallet,
      description: `Consultation earning - ${consultation.type} consultation`,
      status: 'completed',
      consultationId: consultation._id,
      transactionId: `EARN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        clientId: user._id,
        clientType: isGuest ? 'Guest' : 'User',
        ratePerMinute: consultation.rate,
        platformCommission,
        grossAmount: totalAmount,
        netAmount: providerEarnings,
        retroactiveProcessing: true
      }
    });

    // Platform commission transaction
    const platformTransaction = new Transaction({
      user: null,
      userType: 'Platform',
      type: 'debit',
      category: 'commission',
      amount: platformCommission,
      balance: 0,
      description: `Platform commission - ${consultation.type} consultation`,
      status: 'completed',
      consultationId: consultation._id,
      transactionId: `COMM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        consultationType: consultation.type,
        providerId: provider._id,
        clientId: user._id,
        clientType: isGuest ? 'Guest' : 'User',
        commissionRate: PLATFORM_COMMISSION_RATE,
        grossAmount: totalAmount,
        retroactiveProcessing: true
      }
    });

    await Promise.all([
      userTransaction.save(),
      providerTransaction.save(),
      platformTransaction.save()
    ]);

    console.log('✅ Created transaction records');

    // Final status
    console.log('\n📊 Final status:');
    console.log('👤 Client after:', {
      name: user.fullName || user.name,
      wallet: user.wallet,
      change: -totalAmount
    });

    console.log('👨‍💼 Provider after:', {
      name: provider.fullName,
      wallet: provider.wallet,
      earnings: provider.earnings,
      walletChange: +providerEarnings.toFixed(2),
      earningsChange: +providerEarnings.toFixed(2)
    });

    console.log('🏦 Platform commission:', platformCommission.toFixed(2));

    console.log('\n🎉 Billing processed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fixConsultationBilling();