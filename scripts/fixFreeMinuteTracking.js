/**
 * Script to fix free minute tracking for users who have completed consultations
 * but weren't marked as having used their free minute
 * 
 * This script finds all completed consultations and marks the free minute as used
 * for the first consultation with each provider
 * 
 * Usage: node scripts/fixFreeMinuteTracking.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { User, Guest, Consultation } = require('../src/models');

async function fixFreeMinuteTracking() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all completed consultations with rate > 0
    const consultations = await Consultation.find({
      status: 'completed',
      rate: { $gt: 0 },
      $or: [
        { bothSidesAcceptedAt: { $exists: true } },
        { duration: { $gt: 0 } },
        { startTime: { $exists: true } }
      ]
    }).sort({ createdAt: 1 }); // Sort by oldest first

    console.log(`📊 Found ${consultations.length} completed consultations\n`);

    let fixedCount = 0;
    let alreadyMarkedCount = 0;
    let errorCount = 0;

    // Group consultations by user and provider
    const userProviderMap = new Map();

    for (const consultation of consultations) {
      const userId = consultation.user.toString();
      const providerId = consultation.provider.toString();
      const key = `${userId}:${providerId}`;

      if (!userProviderMap.has(key)) {
        userProviderMap.set(key, consultation);
      }
    }

    console.log(`🔍 Found ${userProviderMap.size} unique user-provider pairs\n`);

    // Process each unique user-provider pair
    for (const [key, consultation] of userProviderMap) {
      const [userId, providerId] = key.split(':');

      try {
        // Determine if user is guest or regular
        let user = await User.findById(userId);
        let isGuest = false;

        if (!user) {
          user = await Guest.findById(userId);
          isGuest = true;
        }

        if (!user) {
          console.log(`⚠️ User not found: ${userId}`);
          errorCount++;
          continue;
        }

        // Initialize freeMinutesUsed if it doesn't exist
        if (!user.freeMinutesUsed) {
          user.freeMinutesUsed = [];
        }

        // Check if already marked
        const alreadyMarked = user.freeMinutesUsed.some(
          entry => entry.providerId.toString() === providerId
        );

        if (alreadyMarked) {
          console.log(`✓ Already marked: ${user.fullName || user.name} → Provider ${providerId}`);
          alreadyMarkedCount++;
          continue;
        }

        // Mark as used
        user.freeMinutesUsed.push({
          providerId: providerId,
          consultationId: consultation._id,
          usedAt: consultation.endTime || consultation.createdAt
        });

        await user.save();

        // Also update the consultation
        consultation.freeMinuteUsed = true;
        await consultation.save();

        console.log(`✅ Fixed: ${user.fullName || user.name} (${isGuest ? 'Guest' : 'User'}) → Provider ${providerId}`);
        console.log(`   Consultation: ${consultation._id}`);
        console.log(`   Date: ${consultation.createdAt}\n`);
        
        fixedCount++;
      } catch (error) {
        console.error(`❌ Error processing ${key}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 SUMMARY:');
    console.log(`✅ Fixed: ${fixedCount}`);
    console.log(`✓ Already marked: ${alreadyMarkedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📋 Total processed: ${userProviderMap.size}\n`);

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixFreeMinuteTracking();
