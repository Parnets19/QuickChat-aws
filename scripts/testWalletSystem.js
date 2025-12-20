const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { User, Guest, Transaction, Withdrawal } = require('../src/models');

// Load environment variables
dotenv.config();

const testWalletSystem = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Test 1: Create sample transactions for providers
    console.log('\n1. Creating sample provider transactions...');
    const providers = await User.find({ isServiceProvider: true }).limit(3);
    
    for (const provider of providers) {
      // Create earning transaction
      const earningTransaction = new Transaction({
        user: provider._id,
        userType: 'User',
        type: 'earning',
        category: 'consultation',
        amount: 500,
        balance: provider.wallet + 500,
        description: 'Earning from consultation',
        status: 'completed',
        transactionId: `TXN${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
        metadata: {
          consultationType: 'video',
          duration: 30,
          rate: 500
        }
      });
      await earningTransaction.save();

      // Update provider wallet
      provider.wallet += 500;
      provider.earnings += 500;
      await provider.save();

      console.log(`✅ Created earning transaction for ${provider.fullName}: ₹500`);
    }

    // Test 2: Create sample transactions for guests
    console.log('\n2. Creating sample guest transactions...');
    const guests = await Guest.find().limit(3);
    
    for (const guest of guests) {
      // Create wallet credit transaction
      const creditTransaction = new Transaction({
        user: guest._id,
        userType: 'Guest',
        type: 'credit',
        category: 'deposit',
        amount: 1000,
        balance: guest.wallet + 1000,
        description: 'Money added to wallet',
        status: 'completed',
        paymentMethod: 'upi',
        transactionId: `UPI${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
        metadata: {
          depositDetails: {
            paymentMethod: 'upi',
            gatewayTransactionId: `UPI${Date.now()}`
          }
        }
      });
      await creditTransaction.save();

      // Update guest wallet
      guest.wallet += 1000;
      await guest.save();

      console.log(`✅ Created credit transaction for ${guest.name}: ₹1000`);
    }

    // Test 3: Create sample withdrawal requests
    console.log('\n3. Creating sample withdrawal requests...');
    
    // Provider withdrawal
    const testProvider = providers[0];
    if (testProvider.wallet >= 500) {
      const providerWithdrawal = new Withdrawal({
        user: testProvider._id,
        userType: 'User',
        amount: 500,
        netAmount: 500,
        bankDetails: {
          accountNumber: '1234567890',
          ifscCode: 'HDFC0001234',
          accountHolderName: testProvider.fullName,
          bankName: 'HDFC Bank'
        },
        status: 'pending'
      });
      await providerWithdrawal.save();
      console.log(`✅ Created withdrawal request for provider ${testProvider.fullName}: ₹500`);
    }

    // Guest withdrawal
    const testGuest = guests[0];
    if (testGuest.wallet >= 500) {
      const guestWithdrawal = new Withdrawal({
        user: testGuest._id,
        userType: 'Guest',
        amount: 500,
        netAmount: 500,
        bankDetails: {
          accountNumber: '9876543210',
          ifscCode: 'SBI0001234',
          accountHolderName: testGuest.name,
          bankName: 'State Bank of India'
        },
        status: 'pending'
      });
      await guestWithdrawal.save();
      console.log(`✅ Created withdrawal request for guest ${testGuest.name}: ₹500`);
    }

    // Test 4: Display wallet statistics
    console.log('\n4. Wallet Statistics:');
    
    const providerStats = await User.aggregate([
      { $match: { isServiceProvider: true } },
      {
        $group: {
          _id: null,
          totalProviders: { $sum: 1 },
          totalWalletBalance: { $sum: '$wallet' },
          totalEarnings: { $sum: '$earnings' },
          averageBalance: { $avg: '$wallet' }
        }
      }
    ]);

    const guestStats = await Guest.aggregate([
      {
        $group: {
          _id: null,
          totalGuests: { $sum: 1 },
          totalWalletBalance: { $sum: '$wallet' },
          totalSpent: { $sum: '$totalSpent' },
          averageBalance: { $avg: '$wallet' }
        }
      }
    ]);

    const transactionStats = await Transaction.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    const withdrawalStats = await Withdrawal.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    console.log('\nProvider Statistics:', providerStats[0] || 'No data');
    console.log('Guest Statistics:', guestStats[0] || 'No data');
    console.log('Transaction Statistics:', transactionStats);
    console.log('Withdrawal Statistics:', withdrawalStats);

    console.log('\n✅ Wallet system test completed successfully!');
    console.log('\nYou can now:');
    console.log('1. Access admin panel at /admin/wallet/overview');
    console.log('2. View transactions at /admin/wallet/transactions');
    console.log('3. Manage withdrawals at /admin/wallet/withdrawals');

  } catch (error) {
    console.error('Error testing wallet system:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

testWalletSystem();