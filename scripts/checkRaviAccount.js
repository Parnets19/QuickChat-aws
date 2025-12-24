const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../src/models/User.model');

async function checkRaviAccount() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    console.log('🔍 Searching for Ravi\'s account...');

    // Search by email
    const userByEmail = await User.findOne({ email: 'ravi123@gmail.com' });
    console.log('📧 Search by email (ravi123@gmail.com):', userByEmail ? 'FOUND' : 'NOT FOUND');
    
    if (userByEmail) {
      console.log('✅ User found by email:');
      console.log(`   - ID: ${userByEmail._id}`);
      console.log(`   - Name: ${userByEmail.fullName}`);
      console.log(`   - Mobile: ${userByEmail.mobile}`);
      console.log(`   - Email: ${userByEmail.email}`);
      console.log(`   - Is Service Provider: ${userByEmail.isServiceProvider}`);
      console.log(`   - Status: ${userByEmail.status || 'active'}`);
      console.log(`   - Created: ${userByEmail.createdAt}`);
      console.log(`   - Last Updated: ${userByEmail.updatedAt}`);
    }

    // Search by name containing "Ravi"
    const usersByName = await User.find({ 
      fullName: { $regex: /ravi/i } 
    });
    console.log(`\n👤 Search by name containing "Ravi": ${usersByName.length} found`);
    
    usersByName.forEach((user, index) => {
      console.log(`\n   User ${index + 1}:`);
      console.log(`   - ID: ${user._id}`);
      console.log(`   - Name: ${user.fullName}`);
      console.log(`   - Mobile: ${user.mobile}`);
      console.log(`   - Email: ${user.email}`);
      console.log(`   - Is Service Provider: ${user.isServiceProvider}`);
      console.log(`   - Status: ${user.status || 'active'}`);
      console.log(`   - Created: ${user.createdAt}`);
    });

    // Search for any users with similar emails
    const similarEmails = await User.find({
      email: { $regex: /ravi.*gmail/i }
    });
    console.log(`\n📧 Search by similar emails: ${similarEmails.length} found`);
    
    similarEmails.forEach((user, index) => {
      console.log(`\n   User ${index + 1}:`);
      console.log(`   - ID: ${user._id}`);
      console.log(`   - Name: ${user.fullName}`);
      console.log(`   - Email: ${user.email}`);
      console.log(`   - Mobile: ${user.mobile}`);
    });

    // Get total user count
    const totalUsers = await User.countDocuments();
    console.log(`\n📊 Total users in database: ${totalUsers}`);

    // Get recent users (last 10)
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('fullName email mobile createdAt isServiceProvider');
    
    console.log('\n🕒 Last 10 registered users:');
    recentUsers.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.fullName} (${user.email}) - ${user.createdAt.toLocaleDateString()}`);
    });

  } catch (error) {
    console.error('❌ Error during search:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📦 Disconnected from MongoDB');
  }
}

// Run the search
checkRaviAccount();