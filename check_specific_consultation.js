const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// Import models
const Consultation = require('./src/models/Consultation.model');
const User = require('./src/models/User.model');
const Transaction = require('./src/models/Transaction.model');

const checkSpecificConsultation = async () => {
  console.log('🔍 CHECKING SPECIFIC CONSULTATION');
  console.log('=================================');

  try {
    await connectDB();

    const consultationId = '69464114a079c120f60f4fef';
    
    // Find the specific consultation
    const consultation = await Consultation.findById(consultationId)
      .populate('user', 'fullName mobile')
      .populate('provider', 'fullName mobile consultationStatus');

    if (!consultation) {
      console.log('❌ Consultation not found');
      return;
    }

    const now = new Date();
    const consultationAge = now - new Date(consultation.createdAt);
    const ageInMinutes = Math.round(consultationAge / (1000 * 60));
    const runningTime = consultation.startTime ? now - new Date(consultation.startTime) : 0;
    const runningMinutes = Math.round(runningTime / (1000 * 60));
    
    console.log(`\n📋 Consultation Details:`);
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Client: ${consultation.user?.fullName || 'Unknown'} (${consultation.user?.mobile || 'No mobile'})`);
    console.log(`   Provider: ${consultation.provider?.fullName || 'Unknown'} (${consultation.provider?.mobile || 'No mobile'})`);
    console.log(`   Created: ${consultation.createdAt.toLocaleString()}`);
    console.log(`   Age: ${ageInMinutes} minutes`);
    console.log(`   Start Time: ${consultation.startTime ? consultation.startTime.toLocaleString() : 'Not started'}`);
    console.log(`   Running Time: ${runningMinutes} minutes`);
    console.log(`   End Time: ${consultation.endTime ? consultation.endTime.toLocaleString() : 'Not ended'}`);
    console.log(`   Client Accepted: ${consultation.clientAccepted}`);
    console.log(`   Provider Accepted: ${consultation.providerAccepted}`);
    console.log(`   Billing Started: ${consultation.billingStarted}`);
    console.log(`   Rate: ₹${consultation.rate}/minute`);
    console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);
    console.log(`   Duration: ${consultation.duration || 0} minutes`);

    // Check for recent transactions related to this consultation
    const transactions = await Transaction.find({
      consultationId: consultation._id
    }).sort({ createdAt: -1 });

    console.log(`\n💰 Related Transactions: ${transactions.length}`);
    transactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type} - ₹${tx.amount} - ${tx.createdAt.toLocaleString()}`);
    });

    // Check if consultation seems stuck
    const isStuck = (
      consultation.status === 'ongoing' && 
      consultation.billingStarted && 
      runningMinutes > 30 && // Running for more than 30 minutes
      transactions.length === 0 // No recent transactions
    );

    if (isStuck) {
      console.log(`\n⚠️  CONSULTATION APPEARS STUCK:`);
      console.log(`   - Running for ${runningMinutes} minutes`);
      console.log(`   - No transactions found`);
      console.log(`   - Provider status: ${consultation.provider?.consultationStatus}`);
      
      const shouldCleanup = await askForCleanup();
      
      if (shouldCleanup) {
        console.log(`\n🧹 CLEANING UP STUCK CONSULTATION...`);
        
        // End the consultation
        consultation.status = 'completed';
        consultation.endTime = now;
        consultation.duration = runningMinutes;
        consultation.totalAmount = runningMinutes * consultation.rate;
        consultation.endReason = 'system_error';
        
        await consultation.save();
        
        // Update provider status to available
        await User.findByIdAndUpdate(consultation.provider._id, {
          consultationStatus: 'available'
        });
        
        console.log(`✅ CLEANUP COMPLETE:`);
        console.log(`   - Consultation marked as completed`);
        console.log(`   - Duration set to ${runningMinutes} minutes`);
        console.log(`   - Total amount: ₹${consultation.totalAmount}`);
        console.log(`   - Provider status updated to available`);
      }
    } else {
      console.log(`\n✅ Consultation appears to be legitimate and active`);
    }

  } catch (error) {
    console.error('\n💥 Check failed with error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
};

const askForCleanup = () => {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Do you want to clean up this stuck consultation? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
};

// Run the check
checkSpecificConsultation().catch(console.error);