/**
 * Manually mark free minute as used for a user with a specific provider
 * This is useful for testing or fixing data after completing calls before the fix was applied
 * 
 * Usage: node scripts/manuallyMarkFreeMinuteUsed.js <userId> <providerId> [consultationId]
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { User, Guest, Consultation } = require('../src/models');

async function manuallyMarkFreeMinuteUsed(userId, providerId, consultationId = null) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if user is regular or guest
    let user = await User.findById(userId);
    let isGuest = false;

    if (!user) {
      user = await Guest.findById(userId);
      isGuest = true;
    }

    if (!user) {
      console.error('❌ User not found:', userId);
      process.exit(1);
    }

    console.log('\n📊 USER INFO:');
    console.log('User ID:', userId);
    console.log('User Type:', isGuest ? 'Guest' : 'Regular');
    console.log('User Name:', user.fullName || user.name);

    // Initialize freeMinutesUsed if it doesn't exist
    if (!user.freeMinutesUsed) {
      user.freeMinutesUsed = [];
    }

    // Check if already marked
    const alreadyMarked = user.freeMinutesUsed.some(
      entry => entry.providerId.toString() === providerId
    );

    if (alreadyMarked) {
      console.log('\n⚠️  FREE MINUTE ALREADY MARKED AS USED');
      console.log('Provider ID:', providerId);
      console.log('No action needed.');
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // If no consultationId provided, find the most recent completed consultation
    if (!consultationId) {
      console.log('\n🔍 Finding most recent completed consultation...');
      const consultation = await Consultation.findOne({
        user: userId,
        provider: providerId,
        status: 'completed',
        duration: { $gt: 0 }
      }).sort({ createdAt: -1 });

      if (consultation) {
        consultationId = consultation._id;
        console.log('✅ Found consultation:', consultationId);
        console.log('   Duration:', consultation.duration, 'minutes');
        console.log('   Amount:', '₹' + consultation.totalAmount);
      } else {
        console.log('⚠️  No completed consultations found with this provider');
        console.log('   Creating entry without consultation ID...');
      }
    }

    // Add provider to freeMinutesUsed array
    console.log('\n🆓 MARKING FREE MINUTE AS USED...');
    user.freeMinutesUsed.push({
      providerId: providerId,
      consultationId: consultationId || new mongoose.Types.ObjectId(),
      usedAt: new Date()
    });

    await user.save();

    console.log('✅ FREE MINUTE MARKED AS USED!');
    console.log('\nDetails:');
    console.log('  User ID:', userId);
    console.log('  Provider ID:', providerId);
    console.log('  Consultation ID:', consultationId || 'N/A');
    console.log('  User Type:', isGuest ? 'Guest' : 'Regular');

    // Update consultation if provided
    if (consultationId) {
      const consultation = await Consultation.findById(consultationId);
      if (consultation) {
        consultation.freeMinuteUsed = true;
        await consultation.save();
        console.log('  Consultation Updated: ✅');
      }
    }

    // Verify the change
    console.log('\n🔍 VERIFICATION:');
    const updatedUser = isGuest 
      ? await Guest.findById(userId)
      : await User.findById(userId);
    
    const isNowMarked = updatedUser.freeMinutesUsed.some(
      entry => entry.providerId.toString() === providerId
    );

    if (isNowMarked) {
      console.log('✅ Verification successful!');
      console.log('   Provider is now in freeMinutesUsed array');
      console.log('   Total providers with free minute used:', updatedUser.freeMinutesUsed.length);
    } else {
      console.log('❌ Verification failed!');
      console.log('   Something went wrong');
    }

    // Show API response simulation
    console.log('\n🔌 API RESPONSE SIMULATION:');
    console.log('GET /api/free-minute/check/' + providerId);
    console.log(JSON.stringify({
      success: true,
      data: {
        hasUsedFreeMinute: true,
        isFirstTime: false,
        userType: isGuest ? 'guest' : 'regular'
      }
    }, null, 2));

    console.log('\n💡 NEXT STEPS:');
    console.log('1. Open the mobile app');
    console.log('2. Try to call this provider');
    console.log('3. Should NOT show "🎉 First minute FREE!" badge');
    console.log('4. Should only show the per-minute rate');

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get command line arguments
const userId = process.argv[2];
const providerId = process.argv[3];
const consultationId = process.argv[4]; // Optional

if (!userId || !providerId) {
  console.error('❌ Missing required arguments!');
  console.error('\nUsage:');
  console.error('  node scripts/manuallyMarkFreeMinuteUsed.js <userId> <providerId> [consultationId]');
  console.error('\nExamples:');
  console.error('  # Auto-find consultation:');
  console.error('  node scripts/manuallyMarkFreeMinuteUsed.js 507f1f77bcf86cd799439011 69621e4b88b3545378c8542e');
  console.error('\n  # With specific consultation:');
  console.error('  node scripts/manuallyMarkFreeMinuteUsed.js 507f1f77bcf86cd799439011 69621e4b88b3545378c8542e 507f191e810c19729de860ea');
  process.exit(1);
}

console.log('⚠️  WARNING: This script will manually modify the database!');
console.log('   Use this only for testing or fixing data issues.');
console.log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

setTimeout(() => {
  manuallyMarkFreeMinuteUsed(userId, providerId, consultationId);
}, 3000);
