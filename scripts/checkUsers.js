// Check what users exist in the database
const mongoose = require('mongoose');
require('dotenv').config();

const { User } = require('../src/models');

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({}).select('fullName email mobile wallet earnings isServiceProvider');
    
    console.log(`\n👥 Found ${users.length} users:`);
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.fullName} (${user.email})`);
      console.log(`   📱 Mobile: ${user.mobile}`);
      console.log(`   💰 Wallet: ₹${user.wallet || 0}`);
      console.log(`   📊 Earnings: ₹${user.earnings || 0}`);
      console.log(`   🔧 Service Provider: ${user.isServiceProvider ? 'Yes' : 'No'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkUsers();