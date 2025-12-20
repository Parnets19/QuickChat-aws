// Reset user password for testing
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const { User } = require('../src/models');

async function resetPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the user
    const user = await User.findOne({ email: 'amitparnets@gmail.com' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('👤 Found user:', user.fullName);

    // Hash new password
    const newPassword = 'test123';
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    user.password = hashedPassword;
    await user.save();

    console.log('✅ Password updated successfully');
    console.log('🔑 New password:', newPassword);
    console.log('📧 Email:', user.email);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetPassword();