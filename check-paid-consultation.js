const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const { Consultation, User, Guest, Transaction } = require('./src/models');

async function checkPaidConsultation() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quickchat');
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 CHECKING MOST RECENT PAID CONSULTATION...\n');

    // Get the most recent consultation with actual charges
    const paidConsultation = await Consultation.findOne({
      totalAmount: { $gt: 0 }
    })
      .populate('user', 'fullName email wallet totalSpent')
      .populate('provider', 'fullName email wallet earnings')
      .sort({ createdAt: -1 });

    if (!paidConsultation) {
      console.log('❌ No paid consultations found');
      return;
    }

    const duration = paidConsultation.duration || 0;
    const amount = paidConsultation.totalAmount || 0;
    const platformCommission = Math.round(amount * 0.05 * 100) / 100;
    const providerEarnings = Math.round(amount * 0.95 * 100) / 100;

    console.log('💰 MOST RECENT PAID CONSULTATION:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📞 Consultation ID: ${paidConsultation._id}`);
    console.log(`📅 Date: ${paidConsultation.createdAt.toLocaleString()}`);
    console.log(`👤 Client: ${paidConsultation.user?.fullName || 'Unknown'} (${paidConsultation.userType || 'User'})`);
    console.log(`👨‍💼 Provider: ${paidConsultation.provider?.fullName || 'Unknown'}`);
    console.log(`📱 Type: ${paidConsultation.type?.toUpperCase() || 'UNKNOWN'}`);
    console.log(`⏱️  Duration: ${duration} minutes`);
    console.log(`💰 Rate: ₹${paidConsultation.rate || 0}/minute`);
    console.log(`💸 Total Charged: ₹${amount}`);
    console.log(`💵 Provider Earned: ₹${providerEarnings} (95%)`);
    console.log(`🏢 Platform Commission: ₹${platformCommission} (5%)`);
    console.log(`📊 Status: ${paidConsultation.status?.toUpperCase() || 'UNKNOWN'}`);

    if (paidConsultation.billingStarted) {
      console.log(`✅ Billing Started: ${paidConsultation.bothSidesAcceptedAt ? paidConsultation.bothSidesAcceptedAt.toLocaleString() : 'Yes'}`);
    } else {
      console.log(`❌ Billing Started: No`);
    }

    if (paidConsultation.startTime) {
      console.log(`🚀 Call Started: ${paidConsultation.startTime.toLocaleString()}`);
    }

    if (paidConsultation.endTime) {
      console.log(`🛑 Call Ended: ${paidConsultation.endTime.toLocaleString()}`);
    }

    if (paidConsultation.endReason) {
      console.log(`🔚 End Reason: ${paidConsultation.endReason}`);
    }

    // Show current wallet balances
    if (paidConsultation.user) {
      console.log(`💳 Client Current Wallet: ₹${paidConsultation.user.wallet || 0}`);
      console.log(`📈 Client Total Spent: ₹${paidConsultation.user.totalSpent || 0}`);
    }
    
    if (paidConsultation.provider) {
      console.log(`💰 Provider Current Wallet: ₹${paidConsultation.provider.wallet || 0}`);
      console.log(`📊 Provider Total Earnings: ₹${paidConsultation.provider.earnings || 0}`);
    }

    // Calculate precise billing if call was active
    if (paidConsultation.bothSidesAcceptedAt && paidConsultation.endTime) {
      const durationInSeconds = Math.floor((paidConsultation.endTime - paidConsultation.bothSidesAcceptedAt) / 1000);
      const durationInMinutes = durationInSeconds / 60;
      const ratePerSecond = paidConsultation.rate / 60;
      const preciseAmount = Math.round((durationInSeconds * ratePerSecond) * 100) / 100;
      
      console.log('\n⏰ PRECISE BILLING CALCULATION:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`⏱️  Exact Duration: ${durationInSeconds} seconds (${durationInMinutes.toFixed(2)} minutes)`);
      console.log(`💰 Rate: ₹${paidConsultation.rate}/minute (₹${ratePerSecond.toFixed(4)}/second)`);
      console.log(`💸 Precise Amount: ₹${preciseAmount}`);
      console.log(`📊 Stored Amount: ₹${amount}`);
      console.log(`✅ Billing Method: ${preciseAmount === amount ? 'Per-second (Precise)' : 'Per-minute (Rounded)'}`);
      
      // Show the difference between old and new billing methods
      const oldCeilMethod = Math.ceil(durationInSeconds / 60) * paidConsultation.rate;
      console.log(`🔄 Old Method (ceil): ₹${oldCeilMethod} (would charge for ${Math.ceil(durationInSeconds / 60)} full minutes)`);
      console.log(`💡 Savings for client: ₹${(oldCeilMethod - preciseAmount).toFixed(2)}`);
    }

    // Get related transactions for this consultation
    console.log('\n💳 RELATED TRANSACTIONS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const relatedTransactions = await Transaction.find({
      consultationId: paidConsultation._id
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
        
        if (transaction.metadata) {
          console.log(`   📊 Metadata:`, JSON.stringify(transaction.metadata, null, 6));
        }
        console.log('');
      });
    } else {
      console.log('❌ No transactions found for this consultation');
    }

  } catch (error) {
    console.error('❌ Error checking paid consultation:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the check
checkPaidConsultation();