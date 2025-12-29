const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../src/models/User.model');

async function fixRaviPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    console.log('🔧 Fixing Ravi\'s password...');

    // Find Ravi's account
    const user = await User.findOne({ email: 'ravi123@gmail.com' });
    
    if (!user) {
      console.log('❌ Ravi\'s account not found');
      return;
    }

    console.log('✅ User found:');
    console.log(`   - ID: ${user._id}`);
    console.log(`   - Name: ${user.fullName}`);
    console.log(`   - Email: ${user.email}`);
    console.log(`   - Mobile: ${user.mobile}`);

    // Update the password (let the model middleware hash it properly)
    user.password = 'Ravi1234@';
    await user.save();

    console.log('✅ Password updated successfully!');
    console.log('');
    console.log('🎉 Ravi can now login with:');
    console.log('   Email: ravi123@gmail.com');
    console.log('   Password: Ravi1234@');

    // Test the password
    console.log('\n🔐 Testing the new password...');
    const isValid = await user.comparePassword('Ravi1234@');
    console.log(`   - Password Valid: ${isValid ? '✅ YES' : '❌ NO'}`);

  } catch (error) {
    console.error('❌ Error fixing password:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📦 Disconnected from MongoDB');
  }
}

// Run the fix
fixRaviPassword();