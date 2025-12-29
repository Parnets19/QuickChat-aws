const mongoose = require('mongoose');
const { User, Guest } = require('../src/models');
require('dotenv').config(); // Load environment variables

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quickchat');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// Add test wallet balance to users
const addTestWalletBalance = async () => {
  try {
    console.log('🧪 Adding test wallet balance to users...');
    
    // Find all regular users
    const users = await User.find({}).limit(10);
    console.log(`📋 Found ${users.length} regular users`);
    
    for (const user of users) {
      const currentBalance = user.wallet || 0;
      const testAmount = 500; // Add ₹500 for testing
      
      user.wallet = currentBalance + testAmount;
      await user.save();
      
      console.log(`✅ Added ₹${testAmount} to ${user.fullName} (${user.email})`);
      console.log(`   Previous balance: ₹${currentBalance}, New balance: ₹${user.wallet}`);
    }
    
    // Find all guest users
    const guests = await Guest.find({}).limit(5);
    console.log(`📋 Found ${guests.length} guest users`);
    
    for (const guest of guests) {
      const currentBalance = guest.wallet || 0;
      const testAmount = 300; // Add ₹300 for testing
      
      guest.wallet = currentBalance + testAmount;
      await guest.save();
      
      console.log(`✅ Added ₹${testAmount} to guest ${guest.name} (${guest.email})`);
      console.log(`   Previous balance: ₹${currentBalance}, New balance: ₹${guest.wallet}`);
    }
    
    console.log('🎉 Test wallet balances added successfully!');
    
  } catch (error) {
    console.error('❌ Error adding test wallet balance:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Check current wallet balances
const checkWalletBalances = async () => {
  try {
    console.log('💰 Checking current wallet balances...');
    
    // Check regular users
    const users = await User.find({}).select('fullName email wallet earnings').limit(10);
    console.log('\n📊 Regular Users:');
    users.forEach(user => {
      console.log(`   ${user.fullName} (${user.email}): Wallet ₹${user.wallet || 0}, Earnings ₹${user.earnings || 0}`);
    });
    
    // Check guest users
    const guests = await Guest.find({}).select('name email wallet totalSpent').limit(5);
    console.log('\n📊 Guest Users:');
    guests.forEach(guest => {
      console.log(`   ${guest.name} (${guest.email}): Wallet ₹${guest.wallet || 0}, Spent ₹${guest.totalSpent || 0}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking wallet balances:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Main function
const main = async () => {
  await connectDB();
  
  const action = process.argv[2];
  
  if (action === 'add') {
    await addTestWalletBalance();
  } else if (action === 'check') {
    await checkWalletBalances();
  } else {
    console.log('Usage:');
    console.log('  node addTestWalletBalance.js check  - Check current wallet balances');
    console.log('  node addTestWalletBalance.js add    - Add test money to wallets');
    process.exit(1);
  }
};

main().catch(console.error);