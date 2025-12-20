// Check all transactions for Ravi to understand his wallet balance
const mongoose = require('mongoose');
require('dotenv').config();

const { Transaction, User } = require('../src/models');

async function checkRaviTransactions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const raviId = '693bb59f52886864ad343644';
    
    console.log('\n🔍 CHECKING RAVI\'S TRANSACTIONS');
    console.log('=' .repeat(50));

    // Get Ravi's current data
    const ravi = await User.findById(raviId);
    console.log('👤 Ravi\'s Current Data:');
    console.log(`   💰 Wallet: ₹${ravi.wallet}`);
    console.log(`   📊 Earnings: ₹${ravi.earnings}`);
    console.log(`   💸 Total Spent: ₹${ravi.totalSpent || 0}`);

    // Get all transactions for Ravi
    const transactions = await Transaction.find({
      user: raviId
    }).sort({ createdAt: 1 });

    console.log(`\n📊 Found ${transactions.length} transactions for Ravi:`);
    console.log('-'.repeat(80));

    let runningBalance = 0;
    transactions.forEach((txn, index) => {
      const sign = txn.type === 'earning' || txn.type === 'credit' || txn.type === 'deposit' ? '+' : '-';
      runningBalance += txn.type === 'earning' || txn.type === 'credit' || txn.type === 'deposit' ? txn.amount : -txn.amount;
      
      console.log(`${index + 1}. ${txn.type.toUpperCase()} | ${sign}₹${txn.amount} | Balance: ₹${txn.balance} | ${txn.description}`);
      console.log(`   📅 ${new Date(txn.createdAt).toLocaleString()}`);
      console.log(`   🔗 Consultation: ${txn.consultationId || 'N/A'}`);
      console.log(`   📝 Transaction ID: ${txn.transactionId}`);
      console.log('');
    });

    console.log('💡 ANALYSIS:');
    console.log(`   Expected Balance from Transactions: ₹${runningBalance}`);
    console.log(`   Actual Wallet Balance: ₹${ravi.wallet}`);
    console.log(`   Difference: ₹${ravi.wallet - runningBalance}`);

    // Check if there are any earnings transactions not from our consultation
    const consultationId = '69452a373819d9ac130c5ddb';
    const nonConsultationEarnings = transactions.filter(txn => 
      txn.type === 'earning' && txn.consultationId?.toString() !== consultationId
    );

    if (nonConsultationEarnings.length > 0) {
      console.log('\n⚠️ FOUND NON-CONSULTATION EARNINGS:');
      nonConsultationEarnings.forEach((txn, index) => {
        console.log(`   ${index + 1}. ₹${txn.amount} - ${txn.description} - ${new Date(txn.createdAt).toLocaleString()}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkRaviTransactions();