const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import User model
const User = require('../src/models/User.model');

async function checkUserData() {
  try {
    console.log('🔍 Checking user data for Choti Bahu...');
    
    // Find the user
    const user = await User.findOne({ 
      email: 'chotibahu123@gmail.com' 
    }).select('fullName email profilePhoto aadharDocuments portfolioMedia providerVerificationStatus');
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('👤 User found:', user.fullName);
    console.log('📧 Email:', user.email);
    console.log('🔒 Verification Status:', user.providerVerificationStatus);
    console.log('📸 Profile Photo:', user.profilePhoto || 'Not set');
    console.log('📄 Aadhar Documents:', JSON.stringify(user.aadharDocuments, null, 2));
    console.log('🎨 Portfolio Media:', JSON.stringify(user.portfolioMedia, null, 2));
    
    // Check if files exist
    if (user.profilePhoto) {
      console.log('✅ Profile photo URL exists');
    } else {
      console.log('❌ Profile photo URL missing');
    }
    
    if (user.aadharDocuments?.front) {
      console.log('✅ Aadhar front URL exists');
    } else {
      console.log('❌ Aadhar front URL missing');
    }
    
    if (user.portfolioMedia && user.portfolioMedia.length > 0) {
      console.log(`✅ Portfolio has ${user.portfolioMedia.length} items`);
    } else {
      console.log('❌ Portfolio is empty');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
checkUserData();