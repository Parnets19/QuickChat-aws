const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { sendVerificationNotification, sendStatusChangeNotification } = require('../src/utils/notifications');

// Load environment variables
dotenv.config();

const testNotifications = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find a test user (service provider)
    const User = require('../src/models/User.model');
    const testUser = await User.findOne({ isServiceProvider: true });

    if (!testUser) {
      console.log('No service provider found for testing');
      return;
    }

    console.log(`Testing notifications for user: ${testUser.fullName} (${testUser.email})`);

    // Test verification notification
    console.log('\n1. Testing verification notification (verified)...');
    await sendVerificationNotification(testUser._id, 'verified', '');
    console.log('✅ Verification notification sent');

    // Test status change notification
    console.log('\n2. Testing status change notification (active)...');
    await sendStatusChangeNotification(testUser._id, 'active');
    console.log('✅ Status change notification sent');

    // Test rejection notification
    console.log('\n3. Testing verification notification (rejected)...');
    await sendVerificationNotification(testUser._id, 'rejected', 'Documents are not clear');
    console.log('✅ Rejection notification sent');

    console.log('\n✅ All notifications sent successfully!');
    console.log('Check the notifications collection in your database.');

  } catch (error) {
    console.error('Error testing notifications:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

testNotifications();