// Script to clean all wallet-related data
const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const { User, Guest, Transaction, EarningsTransaction, WithdrawalRequest, Consultation } = require('../src/models');

const cleanWalletData = async () => {
  try {
    console.log('🧹 Starting wallet data cleanup...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // 1. Reset all user wallets and earnings to 0
    console.log('\n1️⃣ Resetting user wallets and earnings...');
    const userUpdateResult = await User.updateMany(
      {},
      {
        $set: {
          wallet: 0,
          earnings: 0,
          totalSpent: 0
        }
      }
    );
    console.log(`✅ Updated ${userUpdateResult.modifiedCount} users`);

    // 2. Reset all guest wallets and totalSpent to 0
    console.log('\n2️⃣ Resetting guest wallets...');
    const guestUpdateResult = await Guest.updateMany(
      {},
      {
        $set: {
          wallet: 0,
          totalSpent: 0
        }
      }
    );
    console.log(`✅ Updated ${guestUpdateResult.modifiedCount} guests`);

    // 3. Delete all Transaction records
    console.log('\n3️⃣ Deleting all Transaction records...');
    const transactionDeleteResult = await Transaction.deleteMany({});
    console.log(`✅ Deleted ${transactionDeleteResult.deletedCount} Transaction records`);

    // 4. Delete all EarningsTransaction records
    console.log('\n4️⃣ Deleting all EarningsTransaction records...');
    const earningsTransactionDeleteResult = await EarningsTransaction.deleteMany({});
    console.log(`✅ Deleted ${earningsTransactionDeleteResult.deletedCount} EarningsTransaction records`);

    // 5. Delete all WithdrawalRequest records
    console.log('\n5️⃣ Deleting all WithdrawalRequest records...');
    const withdrawalDeleteResult = await WithdrawalRequest.deleteMany({});
    console.log(`✅ Deleted ${withdrawalDeleteResult.deletedCount} WithdrawalRequest records`);

    // 6. Delete all Consultation records
    console.log('\n6️⃣ Deleting all Consultation records...');
    const consultationDeleteResult = await Consultation.deleteMany({});
    console.log(`✅ Deleted ${consultationDeleteResult.deletedCount} Consultation records`);

    console.log('\n🎉 Wallet data cleanup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   Users reset: ${userUpdateResult.modifiedCount}`);
    console.log(`   Guests reset: ${guestUpdateResult.modifiedCount}`);
    console.log(`   Transactions deleted: ${transactionDeleteResult.deletedCount}`);
    console.log(`   Earnings transactions deleted: ${earningsTransactionDeleteResult.deletedCount}`);
    console.log(`   Withdrawals deleted: ${withdrawalDeleteResult.deletedCount}`);
    console.log(`   Consultations deleted: ${consultationDeleteResult.deletedCount}`);

    console.log('\n✅ All wallet data has been cleaned. You can now start fresh!');

  } catch (error) {
    console.error('❌ Error cleaning wallet data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('�  Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the cleanup
cleanWalletData();