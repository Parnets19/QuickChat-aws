/**
 * Script to check and fix provider rates
 * 
 * Usage:
 * 1. Check rate: node scripts/fix-provider-rate.js check <provider-id>
 * 2. Fix rate: node scripts/fix-provider-rate.js fix <provider-id> <new-rate>
 * 
 * Example:
 * node scripts/fix-provider-rate.js check 507f1f77bcf86cd799439011
 * node scripts/fix-provider-rate.js fix 507f1f77bcf86cd799439011 2
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../src/models');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const checkProviderRate = async (providerId) => {
  try {
    const provider = await User.findById(providerId).select('fullName rates');
    
    if (!provider) {
      console.log('❌ Provider not found');
      return;
    }

    console.log('\n📊 Provider Rate Information:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Provider: ${provider.fullName}`);
    console.log(`Provider ID: ${providerId}`);
    console.log('\nCurrent Rates:');
    console.log(JSON.stringify(provider.rates, null, 2));
    
    // Check for common issues
    const audioVideoRate = provider.rates?.perMinute?.audioVideo || 0;
    console.log('\n🔍 Rate Analysis:');
    console.log(`Audio/Video Rate (Per Minute): ₹${audioVideoRate}`);
    
    if (audioVideoRate < 1) {
      console.log('⚠️  WARNING: Rate is less than ₹1/minute');
      console.log('   This might be too low and could cause billing issues.');
      console.log('   Common mistake: Entering 0.2 instead of 2');
    } else if (audioVideoRate > 1000) {
      console.log('⚠️  WARNING: Rate is very high (>₹1000/minute)');
      console.log('   This might be a data entry error.');
    } else {
      console.log('✅ Rate looks reasonable');
    }
    
    console.log('\n💡 To fix the rate, run:');
    console.log(`   node scripts/fix-provider-rate.js fix ${providerId} <new-rate>`);
    console.log('   Example: node scripts/fix-provider-rate.js fix ${providerId} 2');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error checking provider rate:', error);
  }
};

const fixProviderRate = async (providerId, newRate) => {
  try {
    const rate = parseFloat(newRate);
    
    if (isNaN(rate) || rate < 0) {
      console.log('❌ Invalid rate. Please provide a positive number.');
      return;
    }

    const provider = await User.findById(providerId).select('fullName rates');
    
    if (!provider) {
      console.log('❌ Provider not found');
      return;
    }

    console.log('\n📝 Updating Provider Rate:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Provider: ${provider.fullName}`);
    console.log(`Provider ID: ${providerId}`);
    console.log(`Old Rate: ₹${provider.rates?.perMinute?.audioVideo || 0}/minute`);
    console.log(`New Rate: ₹${rate}/minute`);
    
    // Update all rate fields to ensure consistency
    const updatedProvider = await User.findByIdAndUpdate(
      providerId,
      {
        $set: {
          'rates.perMinute.audioVideo': rate,
          'rates.perMinute.video': rate,
          'rates.perMinute.audio': rate,
          'rates.video': rate,
          'rates.audio': rate,
          'rates.audioVideo': rate,
        }
      },
      { new: true }
    ).select('fullName rates');

    console.log('\n✅ Rate updated successfully!');
    console.log('\nUpdated Rates:');
    console.log(JSON.stringify(updatedProvider.rates, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error fixing provider rate:', error);
  }
};

const listAllProviders = async () => {
  try {
    const providers = await User.find({ isServiceProvider: true })
      .select('fullName rates')
      .sort({ fullName: 1 });
    
    console.log('\n📋 All Service Providers:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    providers.forEach((provider, index) => {
      const rate = provider.rates?.perMinute?.audioVideo || 0;
      const warning = rate < 1 ? ' ⚠️' : '';
      console.log(`${index + 1}. ${provider.fullName}`);
      console.log(`   ID: ${provider._id}`);
      console.log(`   Rate: ₹${rate}/minute${warning}`);
      console.log('');
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error listing providers:', error);
  }
};

const main = async () => {
  await connectDB();
  
  const command = process.argv[2];
  const providerId = process.argv[3];
  const newRate = process.argv[4];
  
  if (!command) {
    console.log('\n📖 Usage:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('List all providers:');
    console.log('  node scripts/fix-provider-rate.js list');
    console.log('');
    console.log('Check provider rate:');
    console.log('  node scripts/fix-provider-rate.js check <provider-id>');
    console.log('');
    console.log('Fix provider rate:');
    console.log('  node scripts/fix-provider-rate.js fix <provider-id> <new-rate>');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/fix-provider-rate.js list');
    console.log('  node scripts/fix-provider-rate.js check 507f1f77bcf86cd799439011');
    console.log('  node scripts/fix-provider-rate.js fix 507f1f77bcf86cd799439011 2');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  }
  
  switch (command) {
    case 'list':
      await listAllProviders();
      break;
      
    case 'check':
      if (!providerId) {
        console.log('❌ Please provide a provider ID');
        console.log('   Usage: node scripts/fix-provider-rate.js check <provider-id>');
        process.exit(1);
      }
      await checkProviderRate(providerId);
      break;
      
    case 'fix':
      if (!providerId || !newRate) {
        console.log('❌ Please provide both provider ID and new rate');
        console.log('   Usage: node scripts/fix-provider-rate.js fix <provider-id> <new-rate>');
        process.exit(1);
      }
      await fixProviderRate(providerId, newRate);
      break;
      
    default:
      console.log(`❌ Unknown command: ${command}`);
      console.log('   Valid commands: list, check, fix');
      process.exit(1);
  }
  
  await mongoose.connection.close();
  console.log('✅ Disconnected from MongoDB');
  process.exit(0);
};

main();
