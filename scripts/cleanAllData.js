const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../src/models/User.model');
const Guest = require('../src/models/Guest.model');
const Consultation = require('../src/models/Consultation.model');
const Transaction = require('../src/models/Transaction.model');
const Withdrawal = require('../src/models/Withdrawal.model');

async function cleanAllData() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    console.log('🧹 Starting data cleanup...');

    // 1. Delete all consultations
    const consultationsDeleted = await Consultation.deleteMany({});
    console.log(`🗑️ Deleted ${consultationsDeleted.deletedCount} consultations`);

    // 2. Delete all transactions
    const transactionsDeleted = await Transaction.deleteMany({});
    console.log(`🗑️ Deleted ${transactionsDeleted.deletedCount} transactions`);

    // 3. Delete all withdrawals
    const withdrawalsDeleted = await Withdrawal.deleteMany({});
    console.log(`🗑️ Deleted ${withdrawalsDeleted.deletedCount} withdrawals`);

    // 4. Note: EarningsTransaction model removed - using Transaction model only

    // 5. Reset all user wallets and earnings
    const usersUpdated = await User.updateMany(
      {},
      {
        $set: {
          wallet: 0,
          earnings: 0,
          totalSpent: 0
        }
      }
    );
    console.log(`🔄 Reset ${usersUpdated.modifiedCount} user wallets`);

    // 6. Reset all guest wallets
    const guestsUpdated = await Guest.updateMany(
      {},
      {
        $set: {
          wallet: 0,
          totalSpent: 0
        }
      }
    );
    console.log(`🔄 Reset ${guestsUpdated.modifiedCount} guest wallets`);

    console.log('✅ Data cleanup completed successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   - Consultations deleted: ${consultationsDeleted.deletedCount}`);
    console.log(`   - Transactions deleted: ${transactionsDeleted.deletedCount}`);
    console.log(`   - Withdrawals deleted: ${withdrawalsDeleted.deletedCount}`);
    console.log(`   - All transaction data cleared`);
    console.log(`   - Users reset: ${usersUpdated.modifiedCount}`);
    console.log(`   - Guests reset: ${guestsUpdated.modifiedCount}`);
    console.log('');
    console.log('🚀 Ready for new consultation system!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📦 Disconnected from MongoDB');
  }
}

// Run the cleanup
cleanAllData();