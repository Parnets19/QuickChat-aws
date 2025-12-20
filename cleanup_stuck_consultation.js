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

const cleanupStuckConsultation = async () => {
  console.log('🧹 CLEANING UP STUCK CONSULTATION');
  console.log('=================================');

  try {
    await connectDB();

    const consultationId = '69464114a079c120f60f4fef';
    
    // Find the specific consultation
    const consultation = await Consultation.findById(consultationId)
      .populate('provider', 'fullName mobile consultationStatus');

    if (!consultation) {
      console.log('❌ Consultation not found');
      return;
    }

    const now = new Date();
    const runningTime = consultation.startTime ? now - new Date(consultation.startTime) : 0;
    const runningMinutes = Math.round(runningTime / (1000 * 60));
    
    console.log(`\n📋 Current Consultation Status:`);
    console.log(`   ID: ${consultation._id}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Provider: ${consultation.provider?.fullName}`);
    console.log(`   Running Time: ${runningMinutes} minutes`);
    console.log(`   Provider Status: ${consultation.provider?.consultationStatus}`);

    // End the consultation
    console.log(`\n🧹 ENDING STUCK CONSULTATION...`);
    
    consultation.status = 'completed';
    consultation.endTime = now;
    consultation.duration = runningMinutes;
    consultation.totalAmount = runningMinutes * consultation.rate;
    consultation.endReason = 'system_error';
    
    await consultation.save();
    
    // Update provider status to available
    const updatedProvider = await User.findByIdAndUpdate(
      consultation.provider._id, 
      { consultationStatus: 'available' },
      { new: true }
    );
    
    console.log(`✅ CLEANUP COMPLETE:`);
    console.log(`   - Consultation marked as completed`);
    console.log(`   - Duration set to ${runningMinutes} minutes`);
    console.log(`   - Total amount: ₹${consultation.totalAmount}`);
    console.log(`   - Provider "${updatedProvider.fullName}" status updated to: ${updatedProvider.consultationStatus}`);

    // Verify no more active consultations for this provider
    const remainingActive = await Consultation.find({
      provider: consultation.provider._id,
      status: { $in: ['ongoing', 'pending'] }
    });

    console.log(`\n🔍 Remaining active consultations for provider: ${remainingActive.length}`);
    
    if (remainingActive.length === 0) {
      console.log(`✅ Provider can now toggle status successfully`);
    } else {
      console.log(`⚠️  Provider still has ${remainingActive.length} active consultations`);
      remainingActive.forEach(c => {
        console.log(`   - ${c._id}: ${c.status} (created: ${c.createdAt.toLocaleString()})`);
      });
    }

  } catch (error) {
    console.error('\n💥 Cleanup failed with error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
};

// Run the cleanup
cleanupStuckConsultation().catch(console.error);