const mongoose = require('mongoose');
const { User } = require('../src/models');
require('dotenv').config();

async function checkAdminUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const adminUser = await User.findOne({ email: 'admin@skillhub.com' });
    
    if (adminUser) {
      console.log('\n👤 Admin User Details:');
      console.log('ID:', adminUser._id);
      console.log('Name:', adminUser.fullName);
      console.log('Email:', adminUser.email);
      console.log('Is Admin:', adminUser.isAdmin);
      console.log('Is Service Provider:', adminUser.isServiceProvider);
      console.log('Status:', adminUser.status);
    } else {
      console.log('❌ Admin user not found');
    }
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

checkAdminUser();