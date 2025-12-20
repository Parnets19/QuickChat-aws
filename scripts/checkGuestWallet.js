const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import models
const Guest = require('../src/models/Guest.model');
const Transaction = require('../src/models/Transaction.model');

async function checkGuestWallet() {
  try {
    console.log('🔍 Checking guest wallet data...');
    
    // Find all guests
    const guests = await Guest.find({}).select('name mobile wallet totalSpent createdAt');
    
    console.log(`\n👥 Found ${guests.length} guests:`);
    
    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i];
      console.log(`\n${i + 1}. 👤 ${guest.name} (${guest.mobile})`);
      console.log(`   💰 Wallet Balance: ₹${guest.wallet}`);
      console.log(`   💸 Total Spent: ₹${guest.totalSpent}`);
      console.log(`   📅 Created: ${guest.createdAt.toLocaleDateString()}`);
      
      // Get transactions for this guest
      const transactions = await Transaction.find({ 
        user: guest._id,
        userType: 'Guest'
      }).sort({ createdAt: -1 });
      
      console.log(`   📊 Transactions: ${transactions.length}`);
      
      if (transactions.length > 0) {
        console.log(`   📝 Recent transactions:`);
        transactions.slice(0, 3).forEach((txn, index) => {
          const sign = txn.type.includes('credit') || txn.type.includes('add') ? '+' : '-';
          console.log(`      ${index + 1}. ${sign}₹${txn.amount} - ${txn.description} (${txn.status})`);
        });
      }
    }
    
    // Check for any wallet credit transactions
    const walletCredits = await Transaction.find({ 
      type: 'wallet_credit',
      userType: 'Guest'
    }).populate('user', 'name mobile');
    
    console.log(`\n💳 Wallet Credit Transactions: ${walletCredits.length}`);
    walletCredits.forEach((txn, index) => {
      console.log(`${index + 1}. ₹${txn.amount} to ${txn.user?.name} (${txn.user?.mobile}) - ${txn.status}`);
      console.log(`   📅 ${txn.createdAt.toLocaleString()}`);
      console.log(`   📝 ${txn.description}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the script
checkGuestWallet();