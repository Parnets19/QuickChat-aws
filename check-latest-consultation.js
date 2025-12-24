const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const { Consultation, User, Guest, Transaction } = require('./src/models');

async function checkLatestConsultation() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quickchat');
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 CHECKING LATEST CONSULTATION...\n');

    // Get the most recent consultation
    const latestConsultation = await Consultation.findOne()
      .populate('user', 'fullName email wallet totalSpent')
      .populate('provider', 'fullName email wallet earnings')
      .sort({ createdAt: -1 });

    if (!latestConsultation) {
      console.log('❌ No consultations found');
      return;
    }

    const duration = latestConsultation.duration || 0;
    const amount = latestConsultation.totalAmount || 0;
    const platformCommission = Math.round(amount * 0.05 * 100) / 100;
    const providerEarnings = Math.round(amount * 0.95 * 100) / 100;

    console.log('🎯 LATEST CONSULTATION DETAILS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📞 Consultation ID: ${latestConsultation._id}`);
    console.log(`📅 Date: ${latestConsultation.createdAt.toLocaleString()}`);
    console.log(`👤 Client: ${latestConsultation.user?.fullName || 'Unknown'} (${latestConsultation.userType || 'User'})`);
    console.log(`👨‍💼 Provider: ${latestConsultation.provider?.fullName || 'Unknown'}`);
    console.log(`📱 Type: ${latestConsultation.type?.toUpperCase() || 'UNKNOWN'}`);
    console.log(`⏱️  Duration: ${duration} minutes`);
    console.log(`💰 Rate: ₹${latestConsultation.rate || 0}/minute`);
    console.log(`💸 Total Charged: ₹${amount}`);
    console.log(`📊 Status: ${latestConsultation.status?.toUpperCase() || 'UNKNOWN'}`);
    
    if (amount > 0) {
      console.log(`💵 Provider Earned: ₹${providerEarnings} (95%)`);
      console.log(`🏢 Platform Commission: ₹${platformCommission} (5%)`);
    }

    if (latestConsultation.billingStarted) {
      console.log(`✅ Billing Started: ${latestConsultation.bothSidesAcceptedAt ? latestConsultation.bothSidesAcceptedAt.toLocaleString() : 'Yes'}`);
    } else {
      console.log(`❌ Billing Started: No`);
    }

    if (latestConsultation.startTime) {
      console.log(`🚀 Call Started: ${latestConsultation.startTime.toLocaleString()}`);
    }

    if (latestConsultation.endTime) {
      console.log(`🛑 Call Ended: ${latestConsultation.endTime.toLocaleString()}`);
    }

    if (latestConsultation.endReason) {
      console.log(`🔚 End Reason: ${latestConsultation.endReason}`);
    }

    // Show current wallet balances
    if (latestConsultation.user) {
      console.log(`💳 Client Current Wallet: ₹${latestConsultation.user.wallet || 0}`);
      console.log(`📈 Client Total Spent: ₹${latestConsultation.user.totalSpent || 0}`);
    }
    
    if (latestConsultation.provider) {
      console.log(`💰 Provider Current Wallet: ₹${latestConsultation.provider.wallet || 0}`);
      console.log(`📊 Provider Total Earnings: ₹${latestConsultation.provider.earnings || 0}`);
    }

    // Get related transactions for this consultation
    console.log('\n💳 RELATED TRANSACTIONS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const relatedTransactions = await Transaction.find({
      consultationId: latestConsultation._id
    })
    .populate('user', 'fullName email')
    .sort({ createdAt: -1 });

    if (relatedTransactions.length > 0) {
      relatedTransactions.forEach(transaction => {
        const isPayment = transaction.type === 'consultation_payment';
        const icon = isPayment ? '💸' : '💰';
        const action = isPayment ? 'PAID' : 'EARNED';
        
        console.log(`${icon} ${transaction.user?.fullName || 'Unknown'} ${action} ₹${transaction.amount}`);
        console.log(`   📅 ${transaction.createdAt.toLocaleString()}`);
        console.log(`   📝 ${transaction.description}`);
        console.log(`   💳 Balance after: ₹${transaction.balance}`);
        console.log(`   🆔 Transaction ID: ${transaction.transactionId}`);
        console.log('');
      });
    } else {
      console.log('❌ No transactions found for this consultation');
    }

    // Calculate precise billing if call was active
    if (latestConsultation.bothSidesAcceptedAt && latestConsultation.endTime) {
      const durationInSeconds = Math.floor((latestConsultation.endTime - latestConsultation.bothSidesAcceptedAt) / 1000);
      const durationInMinutes = durationInSeconds / 60;
      const ratePerSecond = latestConsultation.rate / 60;
      const preciseAmount = Math.round((durationInSeconds * ratePerSecond) * 100) / 100;
      
      console.log('\n⏰ PRECISE BILLING CALCULATION:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`⏱️  Exact Duration: ${durationInSeconds} seconds (${durationInMinutes.toFixed(2)} minutes)`);
      console.log(`💰 Rate: ₹${latestConsultation.rate}/minute (₹${ratePerSecond.toFixed(4)}/second)`);
      console.log(`💸 Precise Amount: ₹${preciseAmount}`);
      console.log(`📊 Stored Amount: ₹${amount}`);
      console.log(`✅ Billing Method: ${preciseAmount === amount ? 'Per-second (Precise)' : 'Per-minute (Rounded)'}`);
    }

  } catch (error) {
    console.error('❌ Error checking latest consultation:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the check
checkLatestConsultation();