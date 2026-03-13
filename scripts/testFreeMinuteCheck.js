/**
 * Test script to verify the free minute check logic
 * Shows what the API endpoint will return for a user
 * 
 * Usage: node scripts/testFreeMinuteCheck.js <userId> <providerId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { User, Guest, Consultation } = require('../src/models');

async function testFreeMinuteCheck(userId, providerId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

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

    console.log('👤 USER INFO:');
    console.log('User ID:', userId);
    console.log('User Type:', isGuest ? 'Guest' : 'Regular');
    console.log('User Name:', user.fullName || user.name);
    console.log('');

    // Check freeMinutesUsed array
    const hasUsedFreeMinute = user.freeMinutesUsed?.some(
      (entry) => entry.providerId.toString() === providerId
    );

    console.log('📋 ARRAY CHECK (freeMinutesUsed):');
    console.log('Has entry in array:', hasUsedFreeMinute ? '✅ YES' : '❌ NO');
    if (user.freeMinutesUsed && user.freeMinutesUsed.length > 0) {
      console.log('Total providers in array:', user.freeMinutesUsed.length);
      const targetEntry = user.freeMinutesUsed.find(
        (entry) => entry.providerId.toString() === providerId
      );
      if (targetEntry) {
        console.log('Entry details:', {
          providerId: targetEntry.providerId,
          consultationId: targetEntry.consultationId,
          usedAt: targetEntry.usedAt
        });
      }
    }
    console.log('');

    // Check actual completed consultations
    const completedConsultations = await Consultation.countDocuments({
      user: userId,
      provider: providerId,
      status: "completed",
      $or: [
        { bothSidesAcceptedAt: { $exists: true } },
        { duration: { $gt: 0 } },
        { startTime: { $exists: true } }
      ]
    });

    console.log('📞 ACTUAL CONSULTATIONS CHECK:');
    console.log('Completed consultations:', completedConsultations);
    console.log('Has completed calls:', completedConsultations > 0 ? '✅ YES' : '❌ NO');
    console.log('');

    // Calculate final result (same logic as API endpoint)
    const isFirstTime = !hasUsedFreeMinute && completedConsultations === 0;
    const finalHasUsed = hasUsedFreeMinute || completedConsultations > 0;

    console.log('🎯 FINAL RESULT (What API Returns):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('hasUsedFreeMinute:', finalHasUsed ? '✅ true' : '❌ false');
    console.log('isFirstTime:', isFirstTime ? '✅ true (SHOW FREE BADGE)' : '❌ false (HIDE FREE BADGE)');
    console.log('completedConsultations:', completedConsultations);
    console.log('userType:', isGuest ? 'guest' : 'regular');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Show API response
    console.log('📡 API RESPONSE:');
    console.log('GET /api/free-minute/check/' + providerId);
    console.log(JSON.stringify({
      success: true,
      data: {
        hasUsedFreeMinute: finalHasUsed,
        isFirstTime: isFirstTime,
        userType: isGuest ? 'guest' : 'regular',
        completedConsultations: completedConsultations
      }
    }, null, 2));
    console.log('');

    // Explanation
    console.log('💡 EXPLANATION:');
    if (isFirstTime) {
      console.log('✅ User WILL see "First minute FREE!" badge');
      console.log('   Reason: No entry in array AND no completed consultations');
    } else {
      console.log('❌ User will NOT see "First minute FREE!" badge');
      if (hasUsedFreeMinute) {
        console.log('   Reason: Entry exists in freeMinutesUsed array');
      }
      if (completedConsultations > 0) {
        console.log('   Reason: User has', completedConsultations, 'completed consultation(s) with this provider');
      }
    }
    console.log('');

    // Show recent consultations
    console.log('📋 RECENT CONSULTATIONS WITH THIS PROVIDER:');
    const recentConsultations = await Consultation.find({
      user: userId,
      provider: providerId
    }).sort({ createdAt: -1 }).limit(5);

    if (recentConsultations.length === 0) {
      console.log('❌ No consultations found');
    } else {
      recentConsultations.forEach((consultation, index) => {
        console.log(`\n${index + 1}. ${consultation._id}`);
        console.log('   Status:', consultation.status);
        console.log('   Duration:', consultation.duration, 'minutes');
        console.log('   Amount: ₹' + consultation.totalAmount);
        console.log('   Created:', consultation.createdAt);
        console.log('   bothSidesAcceptedAt:', consultation.bothSidesAcceptedAt || 'Not set');
        console.log('   startTime:', consultation.startTime || 'Not set');
      });
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
  console.error('Usage: node scripts/testFreeMinuteCheck.js <userId> <providerId>');
  console.error('Example: node scripts/testFreeMinuteCheck.js 6992f2178efed4f26e061dbd 69621e4b88b3545378c8542e');
  process.exit(1);
}

testFreeMinuteCheck(userId, providerId);
