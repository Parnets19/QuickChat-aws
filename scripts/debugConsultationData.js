// Debug script to check consultation data directly in database
const mongoose = require('mongoose');
require('dotenv').config();

const { Consultation, User, Transaction } = require('../src/models');

async function debugConsultationData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    const amitId = '6937d5da082dde1474b170b9';
    const raviId = '693bb59f52886864ad343644';

    console.log('\n🔍 DEBUGGING CONSULTATION DATA');
    console.log('=' .repeat(50));

    // 1. Check the consultation record
    console.log('\n📋 CONSULTATION RECORD:');
    const consultation = await Consultation.findById(consultationId);
    if (consultation) {
      console.log('✅ Consultation found:');
      console.log(`   ID: ${consultation._id}`);
      console.log(`   User (Client): ${consultation.user} (should be ${amitId})`);
      console.log(`   Provider: ${consultation.provider} (should be ${raviId})`);
      console.log(`   UserType: ${consultation.userType}`);
      console.log(`   Status: ${consultation.status}`);
      console.log(`   Type: ${consultation.type}`);
      console.log(`   Total Amount: ₹${consultation.totalAmount}`);
      console.log(`   Duration: ${consultation.duration} minutes`);
      console.log(`   Start Time: ${consultation.startTime}`);
      console.log(`   End Time: ${consultation.endTime}`);
      console.log(`   Created: ${consultation.createdAt}`);
    } else {
      console.log('❌ Consultation not found!');
    }

    // 2. Check user records
    console.log('\n👤 USER RECORDS:');
    const amit = await User.findById(amitId);
    const ravi = await User.findById(raviId);
    
    if (amit) {
      console.log('✅ Amit found:');
      console.log(`   Name: ${amit.fullName}`);
      console.log(`   Email: ${amit.email}`);
      console.log(`   Wallet: ₹${amit.wallet}`);
      console.log(`   Earnings: ₹${amit.earnings}`);
      console.log(`   Total Spent: ₹${amit.totalSpent || 0}`);
    }
    
    if (ravi) {
      console.log('✅ Ravi found:');
      console.log(`   Name: ${ravi.fullName}`);
      console.log(`   Email: ${ravi.email}`);
      console.log(`   Wallet: ₹${ravi.wallet}`);
      console.log(`   Earnings: ₹${ravi.earnings}`);
      console.log(`   Total Spent: ₹${ravi.totalSpent || 0}`);
    }

    // 3. Check transaction records for this consultation
    console.log('\n💰 TRANSACTION RECORDS:');
    const transactions = await Transaction.find({ consultationId: consultationId });
    console.log(`Found ${transactions.length} transactions for consultation ${consultationId}:`);
    
    transactions.forEach((txn, index) => {
      console.log(`   ${index + 1}. User: ${txn.user} (${txn.userType})`);
      console.log(`      Type: ${txn.type}`);
      console.log(`      Amount: ₹${txn.amount}`);
      console.log(`      Balance: ₹${txn.balance}`);
      console.log(`      Description: ${txn.description}`);
      console.log(`      Created: ${txn.createdAt}`);
      console.log('');
    });

    // 4. Check all consultations for both users
    console.log('\n📊 ALL CONSULTATIONS:');
    
    console.log('\nAmit\'s consultations (as client):');
    const amitConsultations = await Consultation.find({ user: amitId });
    console.log(`Found ${amitConsultations.length} consultations where Amit is client`);
    amitConsultations.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c._id} - ${c.status} - ${c.type} - Provider: ${c.provider}`);
    });
    
    console.log('\nRavi\'s consultations (as provider):');
    const raviConsultations = await Consultation.find({ provider: raviId });
    console.log(`Found ${raviConsultations.length} consultations where Ravi is provider`);
    raviConsultations.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c._id} - ${c.status} - ${c.type} - Client: ${c.user}`);
    });

    // 5. Check all transactions for both users
    console.log('\n💳 ALL TRANSACTIONS:');
    
    console.log('\nAmit\'s transactions:');
    const amitTransactions = await Transaction.find({ user: amitId }).sort({ createdAt: -1 });
    console.log(`Found ${amitTransactions.length} transactions for Amit`);
    amitTransactions.slice(0, 5).forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.type} - ₹${t.amount} - ${t.description} - ${t.createdAt.toLocaleString()}`);
    });
    
    console.log('\nRavi\'s transactions:');
    const raviTransactions = await Transaction.find({ user: raviId }).sort({ createdAt: -1 });
    console.log(`Found ${raviTransactions.length} transactions for Ravi`);
    raviTransactions.slice(0, 5).forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.type} - ₹${t.amount} - ${t.description} - ${t.createdAt.toLocaleString()}`);
    });

    console.log('\n🎯 ANALYSIS:');
    console.log('1. Check if consultation user field matches Amit\'s ID');
    console.log('2. Check if wallet calculations are correct');
    console.log('3. Verify transaction records are properly linked');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

debugConsultationData();