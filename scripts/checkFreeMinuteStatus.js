/**
 * Script to check free minute status for a user and provider
 * Usage: node scripts/checkFreeMinuteStatus.js <userId> <providerId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { User, Guest, Consultation } = require('../src/models');

async function checkFreeMinuteStatus(userId, providerId) {
  try {
    // await mongoose.connect(process.env.MONGODB_URI);
    // console.log('✅ Connected to MongoDB');

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
    console.log('Wallet Balance:', user.wallet);

    // Check freeMinutesUsed array
    console.log('\n🆓 FREE MINUTES USED:');
    if (!user.freeMinutesUsed || user.freeMinutesUsed.length === 0) {
      console.log('❌ No free minutes used yet (array is empty)');
    } else {
      console.log(`✅ Used free minutes with ${user.freeMinutesUsed.length} provider(s):`);
      user.freeMinutesUsed.forEach((entry, index) => {
        console.log(`\n  ${index + 1}. Provider ID: ${entry.providerId}`);
        console.log(`     Consultation ID: ${entry.consultationId}`);
        console.log(`     Used At: ${entry.usedAt}`);
        console.log(`     Is Target Provider: ${entry.providerId.toString() === providerId ? '✅ YES' : '❌ NO'}`);
      });
    }

    // Check if target provider is in the array
    const hasUsedWithProvider = user.freeMinutesUsed?.some(
      entry => entry.providerId.toString() === providerId
    );

    console.log('\n🎯 TARGET PROVIDER CHECK:');
    console.log('Provider ID:', providerId);
    console.log('Has Used Free Minute:', hasUsedWithProvider ? '✅ YES' : '❌ NO');
    console.log('Is First Time:', hasUsedWithProvider ? '❌ NO' : '✅ YES');

    // Find consultations with this provider
    console.log('\n📞 CONSULTATIONS WITH THIS PROVIDER:');
    const consultations = await Consultation.find({
      user: userId,
      provider: providerId
    }).sort({ createdAt: -1 }).limit(5);

    if (consultations.length === 0) {
      console.log('❌ No consultations found with this provider');
    } else {
      console.log(`✅ Found ${consultations.length} consultation(s):\n`);
      consultations.forEach((consultation, index) => {
        console.log(`  ${index + 1}. Consultation ID: ${consultation._id}`);
        console.log(`     Status: ${consultation.status}`);
        console.log(`     Duration: ${consultation.duration} minutes`);
        console.log(`     Total Amount: ₹${consultation.totalAmount}`);
        console.log(`     Free Minute Used: ${consultation.freeMinuteUsed ? '✅ YES' : '❌ NO'}`);
        console.log(`     Created At: ${consultation.createdAt}`);
        console.log(`     End Time: ${consultation.endTime || 'Not ended'}`);
        console.log('');
      });
    }

    // API response simulation
    console.log('\n🔌 API RESPONSE SIMULATION:');
    console.log('GET /api/free-minute/check/' + providerId);
    console.log(JSON.stringify({
      success: true,
      data: {
        hasUsedFreeMinute: hasUsedWithProvider,
        isFirstTime: !hasUsedWithProvider,
        userType: isGuest ? 'guest' : 'regular'
      }
    }, null, 2));

    // Recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    if (!hasUsedWithProvider && consultations.length > 0) {
      const completedConsultations = consultations.filter(c => c.status === 'completed' && c.duration > 0);
      if (completedConsultations.length > 0) {
        console.log('⚠️  You have completed consultations but free minute is not marked as used!');
        console.log('   This means the backend fix is not applied or server needs restart.');
        console.log('   Solution: Restart the backend server and complete a new call.');
      } else {
        console.log('ℹ️  No completed consultations with duration > 0 found.');
        console.log('   Complete a call that runs for at least 1 minute.');
      }
    } else if (hasUsedWithProvider) {
      console.log('✅ Free minute is correctly marked as used!');
      console.log('   Mobile app should NOT show "First minute FREE!" badge.');
    } else {
      console.log('ℹ️  No consultations found with this provider.');
      console.log('   This is your first time calling them.');
    }

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

if (!userId || !providerId) {
  console.error('Usage: node scripts/checkFreeMinuteStatus.js <userId> <providerId>');
  console.error('Example: node scripts/checkFreeMinuteStatus.js 507f1f77bcf86cd799439011 69621e4b88b3545378c8542e');
  process.exit(1);
}

checkFreeMinuteStatus(userId, providerId);
