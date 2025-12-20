// Check transaction records in database directly
const mongoose = require('mongoose');
require('dotenv').config();

const { Transaction, EarningsTransaction } = require('../src/models');

async function checkTransactionRecords() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    const amitId = '6937d5da082dde1474b170b9';
    const raviId = '693bb59f52886864ad343644';

    console.log('\n📊 CHECKING TRANSACTION RECORDS IN DATABASE');
    console.log('=' .repeat(50));

    // Check Transaction model
    console.log('\n1️⃣ Checking Transaction model...');
    const transactions = await Transaction.find({
      $or: [
        { user: amitId },
        { user: raviId },
        { consultationId: consultationId }
      ]
    }).sort({ createdAt: -1 });

    console.log(`Found ${transactions.length} transactions in Transaction model:`);
    transactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.description}`);
      console.log(`      User: ${tx.user} (${tx.userType})`);
      console.log(`      Status: ${tx.status}`);
      console.log(`      Date: ${tx.createdAt}`);
      if (tx.consultationId) console.log(`      Consultation: ${tx.consultationId}`);
      console.log('');
    });

    // Check EarningsTransaction model
    console.log('\n2️⃣ Checking EarningsTransaction model...');
    const earningsTransactions = await EarningsTransaction.find({
      $or: [
        { userId: amitId },
        { userId: raviId },
        { consultationId: consultationId }
      ]
    }).sort({ createdAt: -1 });

    console.log(`Found ${earningsTransactions.length} transactions in EarningsTransaction model:`);
    earningsTransactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.description}`);
      console.log(`      User: ${tx.userId}`);
      console.log(`      Status: ${tx.status}`);
      console.log(`      Date: ${tx.createdAt}`);
      if (tx.consultationId) console.log(`      Consultation: ${tx.consultationId}`);
      console.log('');
    });

    // Check for consultation-specific transactions
    console.log('\n3️⃣ Checking consultation-specific transactions...');
    const consultationTransactions = await Transaction.find({
      consultationId: consultationId
    });

    console.log(`Found ${consultationTransactions.length} transactions for consultation ${consultationId}:`);
    consultationTransactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.description}`);
      console.log(`      User: ${tx.user} (${tx.userType})`);
      console.log(`      Status: ${tx.status}`);
      console.log('');
    });

    // Check recent transactions for both users
    console.log('\n4️⃣ Recent transactions by user...');
    
    console.log(`\nAmit's transactions (${amitId}):`);
    const amitTransactions = await Transaction.find({ user: amitId }).sort({ createdAt: -1 }).limit(5);
    amitTransactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.description} (${tx.createdAt.toLocaleString()})`);
    });

    console.log(`\nRavi's transactions (${raviId}):`);
    const raviTransactions = await Transaction.find({ user: raviId }).sort({ createdAt: -1 }).limit(5);
    raviTransactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.description} (${tx.createdAt.toLocaleString()})`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkTransactionRecords();