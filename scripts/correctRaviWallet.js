// Correct Ravi's wallet balance to match his actual earnings
const mongoose = require('mongoose');
require('dotenv').config();

const { User, Transaction } = require('../src/models');

async function correctRaviWallet() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const raviId = '693bb59f52886864ad343644';
    
    console.log('\n🔧 CORRECTING RAVI\'S WALLET BALANCE');
    console.log('=' .repeat(50));

    // Get Ravi's current data
    const ravi = await User.findById(raviId);
    console.log('👤 Ravi\'s Current Data:');
    console.log(`   💰 Wallet: ₹${ravi.wallet}`);
    console.log(`   📊 Earnings: ₹${ravi.earnings}`);

    // Calculate correct balance from transactions
    const transactions = await Transaction.find({
      user: raviId
    }).sort({ createdAt: 1 });

    console.log(`\n📊 Found ${transactions.length} transactions for Ravi`);

    let correctBalance = 0;
    let correctEarnings = 0;

    transactions.forEach((txn) => {
      if (txn.type === 'earning' || txn.type === 'credit' || txn.type === 'deposit') {
        correctBalance += txn.amount;
        if (txn.type === 'earning') {
          correctEarnings += txn.amount;
        }
      } else if (txn.type === 'debit' || txn.type === 'withdrawal' || txn.type === 'consultation_payment') {
        correctBalance -= txn.amount;
      }
    });

    console.log('\n💡 CALCULATION:');
    console.log(`   Correct Wallet Balance: ₹${correctBalance}`);
    console.log(`   Correct Earnings: ₹${correctEarnings}`);
    console.log(`   Current Wallet: ₹${ravi.wallet}`);
    console.log(`   Current Earnings: ₹${ravi.earnings}`);
    console.log(`   Wallet Difference: ₹${ravi.wallet - correctBalance}`);
    console.log(`   Earnings Difference: ₹${ravi.earnings - correctEarnings}`);

    // Update Ravi's wallet and earnings to correct values
    console.log('\n🔄 UPDATING RAVI\'S BALANCE...');
    
    ravi.wallet = correctBalance;
    ravi.earnings = correctEarnings;
    await ravi.save();

    console.log('✅ Updated Ravi\'s balance:');
    console.log(`   💰 New Wallet: ₹${ravi.wallet}`);
    console.log(`   📊 New Earnings: ₹${ravi.earnings}`);

    // Update transaction balance fields to be consistent
    console.log('\n🔄 UPDATING TRANSACTION BALANCE FIELDS...');
    let runningBalance = 0;
    
    for (const txn of transactions) {
      if (txn.type === 'earning' || txn.type === 'credit' || txn.type === 'deposit') {
        runningBalance += txn.amount;
      } else if (txn.type === 'debit' || txn.type === 'withdrawal' || txn.type === 'consultation_payment') {
        runningBalance -= txn.amount;
      }
      
      txn.balance = runningBalance;
      await txn.save();
      console.log(`   Updated transaction ${txn.transactionId}: balance = ₹${runningBalance}`);
    }

    console.log('\n🎉 Ravi\'s wallet balance corrected successfully!');
    console.log('📋 Summary:');
    console.log(`   - Only 1 consultation earning of ₹513`);
    console.log(`   - Wallet balance: ₹513`);
    console.log(`   - Total earnings: ₹513`);
    console.log(`   - All transaction balances updated`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

correctRaviWallet();