const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const { Consultation, User, Guest, Transaction } = require('./src/models');

async function checkRecentConsultations() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quickchat');
    console.log('✅ Connected to MongoDB');

    // Get recent consultations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log('\n🔍 CHECKING RECENT CONSULTATIONS (Last 7 days)...\n');

    const recentConsultations = await Consultation.find({
      createdAt: { $gte: sevenDaysAgo }
    })
    .populate('user', 'fullName email wallet totalSpent')
    .populate('provider', 'fullName email wallet earnings')
    .sort({ createdAt: -1 })
    .limit(20);

    if (recentConsultations.length === 0) {
      console.log('❌ No consultations found in the last 7 days');
      return;
    }

    console.log(`📊 Found ${recentConsultations.length} recent consultations:\n`);

    let totalDeducted = 0;
    let totalEarned = 0;
    let totalPlatformCommission = 0;

    for (const consultation of recentConsultations) {
      const startTime = consultation.startTime || consultation.createdAt;
      const endTime = consultation.endTime || new Date();
      const duration = consultation.duration || 0;
      const amount = consultation.totalAmount || 0;
      
      // Calculate commission (5% platform, 95% provider)
      const platformCommission = Math.round(amount * 0.05 * 100) / 100;
      const providerEarnings = Math.round(amount * 0.95 * 100) / 100;

      totalDeducted += amount;
      totalEarned += providerEarnings;
      totalPlatformCommission += platformCommission;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📞 CONSULTATION ID: ${consultation._id}`);
      console.log(`📅 Date: ${consultation.createdAt.toLocaleString()}`);
      console.log(`👤 Client: ${consultation.user?.fullName || 'Unknown'} (${consultation.userType || 'User'})`);
      console.log(`👨‍💼 Provider: ${consultation.provider?.fullName || 'Unknown'}`);
      console.log(`📱 Type: ${consultation.type?.toUpperCase() || 'UNKNOWN'}`);
      console.log(`⏱️  Duration: ${duration} minutes`);
      console.log(`💰 Rate: ₹${consultation.rate || 0}/minute`);
      console.log(`💸 Total Charged: ₹${amount}`);
      console.log(`📊 Status: ${consultation.status?.toUpperCase() || 'UNKNOWN'}`);
      
      if (amount > 0) {
        console.log(`💵 Provider Earned: ₹${providerEarnings} (95%)`);
        console.log(`🏢 Platform Commission: ₹${platformCommission} (5%)`);
      }

      if (consultation.billingStarted) {
        console.log(`✅ Billing Started: ${consultation.bothSidesAcceptedAt ? consultation.bothSidesAcceptedAt.toLocaleString() : 'Yes'}`);
      } else {
        console.log(`❌ Billing Started: No`);
      }

      if (consultation.endReason) {
        console.log(`🔚 End Reason: ${consultation.endReason}`);
      }

      // Show current wallet balances
      if (consultation.user) {
        console.log(`💳 Client Current Wallet: ₹${consultation.user.wallet || 0}`);
        console.log(`📈 Client Total Spent: ₹${consultation.user.totalSpent || 0}`);
      }
      
      if (consultation.provider) {
        console.log(`💰 Provider Current Wallet: ₹${consultation.provider.wallet || 0}`);
        console.log(`📊 Provider Total Earnings: ₹${consultation.provider.earnings || 0}`);
      }

      console.log('');
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SUMMARY (Last 7 days):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💸 Total Amount Deducted from Clients: ₹${totalDeducted.toFixed(2)}`);
    console.log(`💰 Total Earned by Providers: ₹${totalEarned.toFixed(2)}`);
    console.log(`🏢 Total Platform Commission: ₹${totalPlatformCommission.toFixed(2)}`);
    console.log(`📞 Total Consultations: ${recentConsultations.length}`);
    
    // Breakdown by status
    const statusBreakdown = {};
    recentConsultations.forEach(c => {
      const status = c.status || 'unknown';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });
    
    console.log('\n📊 Status Breakdown:');
    Object.entries(statusBreakdown).forEach(([status, count]) => {
      console.log(`   ${status.toUpperCase()}: ${count}`);
    });

    // Get recent transactions for more detailed billing info
    console.log('\n💳 RECENT BILLING TRANSACTIONS:\n');
    
    const recentTransactions = await Transaction.find({
      type: { $in: ['consultation_payment', 'earning'] },
      createdAt: { $gte: sevenDaysAgo }
    })
    .populate('user', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(10);

    if (recentTransactions.length > 0) {
      recentTransactions.forEach(transaction => {
        const isPayment = transaction.type === 'consultation_payment';
        const icon = isPayment ? '💸' : '💰';
        const action = isPayment ? 'PAID' : 'EARNED';
        
        console.log(`${icon} ${transaction.user?.fullName || 'Unknown'} ${action} ₹${transaction.amount}`);
        console.log(`   📅 ${transaction.createdAt.toLocaleString()}`);
        console.log(`   📝 ${transaction.description}`);
        console.log(`   💳 Balance after: ₹${transaction.balance}`);
        console.log('');
      });
    } else {
      console.log('❌ No recent billing transactions found');
    }

  } catch (error) {
    console.error('❌ Error checking consultations:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the check
checkRecentConsultations();