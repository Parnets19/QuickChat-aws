const mongoose = require('mongoose');
const { User, Guest } = require('../src/models');
require('dotenv').config();

async function checkAllUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get all users (providers and non-providers)
    const allUsers = await User.find()
      .select('fullName email isServiceProvider isAdmin createdAt')
      .sort({ createdAt: -1 });
    
    console.log('\n👥 ALL USERS IN DATABASE:');
    console.log('Total Users in User collection:', allUsers.length);
    
    const providers = [];
    const regularUsers = [];
    
    allUsers.forEach((user, index) => {
      const userInfo = `${index + 1}. ${user.fullName} (${user.email}) - Created: ${user.createdAt.toLocaleDateString()}`;
      
      if (user.isServiceProvider) {
        providers.push(userInfo + (user.isAdmin ? ' [ADMIN]' : ''));
      } else {
        regularUsers.push(userInfo);
      }
    });
    
    console.log('\n🔧 PROVIDERS (' + providers.length + '):');
    providers.forEach(provider => console.log(provider));
    
    console.log('\n👤 REGULAR USERS (non-providers) (' + regularUsers.length + '):');
    if (regularUsers.length > 0) {
      regularUsers.forEach(user => console.log(user));
    } else {
      console.log('No regular users found');
    }
    
    // Get all guests
    const allGuests = await Guest.find()
      .select('name mobile createdAt')
      .sort({ createdAt: -1 });
    
    console.log('\n🎭 ALL GUESTS (' + allGuests.length + '):');
    allGuests.forEach((guest, index) => {
      console.log(`${index + 1}. ${guest.name} (${guest.mobile}) - Created: ${guest.createdAt.toLocaleDateString()}`);
    });
    
    console.log('\n📊 SUMMARY:');
    console.log('- Providers:', providers.length);
    console.log('- Regular Users:', regularUsers.length);
    console.log('- Total Users (User collection):', allUsers.length);
    console.log('- Guests:', allGuests.length);
    console.log('- Grand Total (Users + Guests):', allUsers.length + allGuests.length);
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

checkAllUsers();