const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const User = require('../src/models/User.model');

async function recreateRaviAccount() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    console.log('🔍 Checking if Ravi\'s account exists...');

    // Check if user already exists
    const existingUser = await User.findOne({ email: 'ravi123@gmail.com' });
    
    if (existingUser) {
      console.log('✅ Ravi\'s account already exists!');
      console.log(`   - ID: ${existingUser._id}`);
      console.log(`   - Name: ${existingUser.fullName}`);
      console.log(`   - Email: ${existingUser.email}`);
      console.log(`   - Mobile: ${existingUser.mobile}`);
      console.log(`   - Is Service Provider: ${existingUser.isServiceProvider}`);
      return;
    }

    console.log('❌ Ravi\'s account not found. Creating new account...');

    // Hash the password
    const hashedPassword = await bcrypt.hash('Ravi1234@', 12);

    // Create new user account
    const newUser = await User.create({
      fullName: 'Ravi Roy',
      email: 'ravi123@gmail.com',
      mobile: '9876543212', // You may need to update this with the correct mobile
      password: hashedPassword,
      isMobileVerified: true,
      isEmailVerified: true,
      isServiceProvider: true, // Assuming Ravi was a service provider
      profession: 'Service Provider',
      gender: 'male',
      place: {
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India'
      },
      consultationModes: {
        chat: true,
        audio: true,
        video: true
      },
      rates: {
        chat: 0,
        perMinute: {
          audioVideo: 50,
          audio: 50,
          video: 50
        },
        perHour: {
          audioVideo: 0,
          audio: 0,
          video: 0
        },
        defaultChargeType: 'per-minute',
        // Legacy fields
        audio: 50,
        video: 50,
        chargeType: 'per-minute'
      },
      wallet: 0,
      earnings: 0,
      totalSpent: 0,
      providerVerificationStatus: 'verified',
      status: 'active',
      languagesKnown: ['English', 'Hindi'],
      skills: ['Consultation', 'Advice'],
      serviceCategories: ['General Consultation']
    });

    console.log('✅ Ravi\'s account recreated successfully!');
    console.log(`   - ID: ${newUser._id}`);
    console.log(`   - Name: ${newUser.fullName}`);
    console.log(`   - Email: ${newUser.email}`);
    console.log(`   - Mobile: ${newUser.mobile}`);
    console.log(`   - Password: Ravi1234@ (same as before)`);
    console.log(`   - Is Service Provider: ${newUser.isServiceProvider}`);
    console.log(`   - Verification Status: ${newUser.providerVerificationStatus}`);
    
    console.log('\n🎉 Ravi can now login with:');
    console.log('   Email: ravi123@gmail.com');
    console.log('   Password: Ravi1234@');

  } catch (error) {
    console.error('❌ Error recreating account:', error);
    
    if (error.code === 11000) {
      console.log('⚠️ Duplicate key error - account might already exist with different details');
      
      // Check what field is duplicated
      if (error.keyPattern?.email) {
        console.log('   - Email already exists');
      }
      if (error.keyPattern?.mobile) {
        console.log('   - Mobile number already exists');
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n📦 Disconnected from MongoDB');
  }
}

// Run the recreation
recreateRaviAccount();