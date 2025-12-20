// Fix wallet calculation issues
const mongoose = require('mongoose');
require('dotenv').config();

const { User, Transaction } = require('../src/models');

async function fixWalletCalculations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const amitId = '6937d5da082dde1474b170b9';
    const raviId = '693bb59f52886864ad343644';

    console.log('\n🔧 FIXING WALLET CALCULATIONS');
    console.log('=' .repeat(50));

    // 1. Fix Amit's totalSpent
    console.log('\n👤 FIXING AMIT\'S TOTAL SPENT:');
    const amit = await User.findById(amitId);
    
    // Calculate total spent from transactions
    const amitSpentTransactions = await Transaction.find({
      user: amitId,
      type: { $in: ['consultation_payment', 'debit'] }
    });
    
    const totalSpent = amitSpentTransactions.reduce((sum, txn) => sum + txn.amount, 0);
    console.log(`   Current totalSpent: ₹${amit.totalSpent || 0}`);
    console.log(`   Calculated from transactions: ₹${totalSpent}`);
    
    amit.totalSpent = totalSpent;
    await amit.save();
    console.log(`   ✅ Updated Amit's totalSpent to ₹${totalSpent}`);

    // 2. Fix Ravi's wallet calculation
    console.log('\n👨‍⚕️ FIXING RAVI\'S WALLET:');
    const ravi = await User.findById(raviId);
    
    // Get all Ravi's transactions
    const raviTransactions = await Transaction.find({ user: raviId }).sort({ createdAt: 1 });
    console.log(`   Found ${raviTransactions.length} transactions for Ravi`);
    
    // Calculate wallet balance from transactions
    let calculatedBalance = 0;
    raviTransactions.forEach(txn => {
      if (txn.type === 'earning' || txn.type === 'credit' || txn.type === 'deposit') {
        calculatedBalance += txn.amount;
      } else if (txn.type === 'debit' || txn.type === 'withdrawal' || txn.type === 'consultation_payment') {
        calculatedBalance -= txn.amount;
      }
    });
    
    console.log(`   Current wallet: ₹${ravi.wallet}`);
    console.log(`   Current earnings: ₹${ravi.earnings}`);
    console.log(`   Calculated from transactions: ₹${calculatedBalance}`);
    
    // The issue might be that earnings are being added twice
    // Let's check if there are any other wallet deposits
    const raviDeposits = await Transaction.find({
      user: raviId,
      type: 'deposit'
    });
    
    console.log(`   Found ${raviDeposits.length} deposit transactions`);
    
    // Check if Ravi has any manual wallet additions
    if (raviDeposits.length === 0) {
      // If no deposits, wallet should equal earnings from consultations
      console.log('   No deposits found, wallet should equal consultation earnings');
      ravi.wallet = calculatedBalance;
    } else {
      // If there are deposits, calculate properly
      const totalDeposits = raviDeposits.reduce((sum, txn) => sum + txn.amount, 0);
      const totalEarnings = raviTransactions
        .filter(txn => txn.type === 'earning')
        .reduce((sum, txn) => sum + txn.amount, 0);
      
      console.log(`   Total deposits: ₹${totalDeposits}`);
      console.log(`   Total earnings: ₹${totalEarnings}`);
      
      ravi.wallet = totalDeposits + totalEarnings;
    }
    
    await ravi.save();
    console.log(`   ✅ Updated Ravi's wallet to ₹${ravi.wallet}`);

    // 3. Verify the fixes
    console.log('\n✅ VERIFICATION:');
    const updatedAmit = await User.findById(amitId);
    const updatedRavi = await User.findById(raviId);
    
    console.log(`   Amit - Wallet: ₹${updatedAmit.wallet}, Total Spent: ₹${updatedAmit.totalSpent}, Earnings: ₹${updatedAmit.earnings}`);
    console.log(`   Ravi - Wallet: ₹${updatedRavi.wallet}, Total Spent: ₹${updatedRavi.totalSpent || 0}, Earnings: ₹${updatedRavi.earnings}`);

    console.log('\n🎉 Wallet calculations fixed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fixWalletCalculations();