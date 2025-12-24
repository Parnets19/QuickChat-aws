const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const User = require('../src/models/User.model');

async function checkRaviPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    console.log('🔍 Checking Ravi\'s password...');

    // Find Ravi's account
    const user = await User.findOne({ email: 'ravi123@gmail.com' }).select('+password');
    
    if (!user) {
      console.log('❌ Ravi\'s account not found');
      return;
    }

    console.log('✅ User found:');
    console.log(`   - ID: ${user._id}`);
    console.log(`   - Name: ${user.fullName}`);
    console.log(`   - Email: ${user.email}`);
    console.log(`   - Mobile: ${user.mobile}`);
    console.log(`   - Has Password: ${!!user.password}`);
    
    if (user.password) {
      console.log(`   - Password Hash: ${user.password.substring(0, 20)}...`);
      
      // Test the expected password
      const testPassword = 'Ravi1234@';
      console.log(`\n🔐 Testing password: "${testPassword}"`);
      
      try {
        const isValid = await user.comparePassword(testPassword);
        console.log(`   - Password Valid: ${isValid ? '✅ YES' : '❌ NO'}`);
        
        if (!isValid) {
          // Try manual bcrypt comparison
          const manualCheck = await bcrypt.compare(testPassword, user.password);
          console.log(`   - Manual bcrypt check: ${manualCheck ? '✅ YES' : '❌ NO'}`);
          
          // Test some other common passwords
          const commonPasswords = ['Ravi1234', 'ravi1234@', 'RAVI1234@', 'Ravi123@'];
          console.log('\n🔍 Testing other possible passwords:');
          
          for (const pwd of commonPasswords) {
            const testResult = await bcrypt.compare(pwd, user.password);
            console.log(`   - "${pwd}": ${testResult ? '✅ MATCH' : '❌ NO'}`);
          }
        }
      } catch (error) {
        console.error('❌ Error comparing password:', error);
      }
    } else {
      console.log('❌ No password set for this account');
    }

  } catch (error) {
    console.error('❌ Error during check:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📦 Disconnected from MongoDB');
  }
}

// Run the check
checkRaviPassword();