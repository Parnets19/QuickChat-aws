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

const debugActiveConsultations = async () => {
  console.log('🔍 DEBUGGING ACTIVE CONSULTATIONS');
  console.log('==================================');

  try {
    await connectDB();

    // Find all active consultations (ongoing or pending)
    const activeConsultations = await Consultation.find({
      status: { $in: ['ongoing', 'pending'] }
    })
    .populate('user', 'fullName mobile')
    .populate('provider', 'fullName mobile consultationStatus')
    .sort({ createdAt: -1 });

    console.log(`📊 Found ${activeConsultations.length} active consultations`);

    if (activeConsultations.length === 0) {
      console.log('✅ No active consultations found');
      
      // Still check provider statuses
      console.log('\n👨‍⚕️ CURRENT PROVIDER STATUSES');
      console.log('==============================');
      const allProviders = await User.find({ 
        isServiceProvider: true 
      }).select('fullName mobile consultationStatus isOnline');

      allProviders.forEach(provider => {
        console.log(`   ${provider.fullName} (${provider.mobile}): ${provider.consultationStatus || 'available'} ${provider.isOnline ? '(online)' : '(offline)'}`);
      });
      
      return;
    }

    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    let cleanedUp = 0;

    for (const consultation of activeConsultations) {
      const consultationAge = now - new Date(consultation.createdAt);
      const ageInHours = Math.round(consultationAge / (1000 * 60 * 60));
      const ageInMinutes = Math.round(consultationAge / (1000 * 60));
      
      console.log(`\n📋 Consultation ID: ${consultation._id}`);
      console.log(`   📊 Status: ${consultation.status}`);
      console.log(`   👤 Client: ${consultation.user?.fullName || 'Unknown'} (${consultation.user?.mobile || 'No mobile'})`);
      console.log(`   👨‍⚕️ Provider: ${consultation.provider?.fullName || 'Unknown'} (${consultation.provider?.mobile || 'No mobile'})`);
      console.log(`   📅 Created: ${consultation.createdAt.toLocaleString()}`);
      console.log(`   ⏰ Age: ${ageInHours} hours (${ageInMinutes} minutes)`);
      console.log(`   🎯 Type: ${consultation.type}`);
      console.log(`   💰 Rate: ₹${consultation.rate || 0}`);
      console.log(`   ⏰ Start Time: ${consultation.startTime ? consultation.startTime.toLocaleString() : 'Not started'}`);
      console.log(`   🏁 End Time: ${consultation.endTime ? consultation.endTime.toLocaleString() : 'Not ended'}`);
      console.log(`   ✅ Client Accepted: ${consultation.clientAccepted || false}`);
      console.log(`   ✅ Provider Accepted: ${consultation.providerAccepted || false}`);
      console.log(`   💰 Billing Started: ${consultation.billingStarted || false}`);
      console.log(`   👨‍⚕️ Provider Status: ${consultation.provider?.consultationStatus || 'Unknown'}`);

      // Check if consultation is stuck (older than 24 hours)
      if (consultationAge > maxAge) {
        console.log(`   🧹 CLEANUP NEEDED: Consultation is ${ageInHours} hours old and still ${consultation.status}`);
        
        // Mark as cancelled
        consultation.status = 'cancelled';
        consultation.endTime = now;
        consultation.endReason = 'system_error'; // Use valid enum value
        await consultation.save();
        
        console.log(`   ✅ CLEANED UP: Marked consultation as cancelled`);
        cleanedUp++;
      } else if (consultation.status === 'pending' && consultationAge > 5 * 60 * 1000) {
        // If pending for more than 5 minutes, mark as no_answer
        console.log(`   🧹 TIMEOUT CLEANUP: Pending consultation is ${ageInMinutes} minutes old`);
        
        consultation.status = 'no_answer';
        consultation.endTime = now;
        consultation.endReason = 'system_error'; // Use valid enum value
        await consultation.save();
        
        console.log(`   ✅ TIMEOUT CLEANED UP: Marked consultation as no_answer`);
        cleanedUp++;
      } else if (consultation.status === 'ongoing' && !consultation.startTime && consultationAge > 10 * 60 * 1000) {
        // If ongoing but never actually started (no startTime) and older than 10 minutes
        console.log(`   🧹 STUCK CLEANUP: Ongoing consultation with no start time, ${ageInMinutes} minutes old`);
        
        consultation.status = 'cancelled';
        consultation.endTime = now;
        consultation.endReason = 'system_error'; // Use valid enum value
        await consultation.save();
        
        console.log(`   ✅ STUCK CLEANED UP: Marked consultation as cancelled`);
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      console.log(`\n🧹 CLEANUP SUMMARY: Cleaned up ${cleanedUp} stuck consultations`);
      
      // Update provider statuses
      console.log('\n🔄 Updating provider statuses...');
      const providers = await User.find({ 
        isServiceProvider: true,
        consultationStatus: { $in: ['busy', 'offline'] }
      });

      for (const provider of providers) {
        // Check if provider still has active consultations
        const stillActive = await Consultation.findOne({
          provider: provider._id,
          status: { $in: ['ongoing', 'pending'] }
        });

        if (!stillActive && provider.consultationStatus === 'busy') {
          provider.consultationStatus = 'available';
          await provider.save();
          console.log(`   ✅ Updated ${provider.fullName} status from busy to available`);
        }
      }
    } else {
      console.log('\n✅ No cleanup needed - all consultations are recent');
    }

    // Show current provider statuses
    console.log('\n👨‍⚕️ CURRENT PROVIDER STATUSES');
    console.log('==============================');
    const allProviders = await User.find({ 
      isServiceProvider: true 
    }).select('fullName mobile consultationStatus isOnline');

    allProviders.forEach(provider => {
      console.log(`   ${provider.fullName} (${provider.mobile}): ${provider.consultationStatus || 'available'} ${provider.isOnline ? '(online)' : '(offline)'}`);
    });

  } catch (error) {
    console.error('\n💥 Debug failed with error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
};

// Run the debug
debugActiveConsultations().catch(console.error);