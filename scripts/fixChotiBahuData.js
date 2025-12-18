const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import User model
const User = require('../src/models/User.model');

async function fixChotiBahuData() {
  try {
    console.log('🔧 Fixing Choti Bahu user data...');
    
    // Find the user
    const user = await User.findOne({ 
      email: 'chotibahu123@gmail.com' 
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('👤 Found user:', user.fullName);
    
    // Based on the upload timestamps, set the correct URLs
    const baseUrl = 'http://localhost:5001/uploads';
    
    // Update the user with the correct file URLs
    const updateData = {
      profilePhoto: `${baseUrl}/photo-1766061213916-206612794.jpg`,
      aadharDocuments: {
        front: `${baseUrl}/front-1766061213958-872254635.jpg`,
        back: ''
      },
      // Portfolio is already correct, but let's ensure it's set
      portfolioMedia: user.portfolioMedia || [{
        type: 'image',
        url: `${baseUrl}/photo-1766061213993-769149564.png`
      }],
      // Also set verification status to pending (should already be set)
      providerVerificationStatus: 'pending'
    };
    
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: updateData },
      { new: true }
    ).select('fullName email profilePhoto aadharDocuments portfolioMedia providerVerificationStatus');
    
    console.log('✅ User updated successfully!');
    console.log('📸 Profile Photo:', updatedUser.profilePhoto);
    console.log('📄 Aadhar Front:', updatedUser.aadharDocuments.front);
    console.log('🎨 Portfolio:', updatedUser.portfolioMedia.length, 'items');
    console.log('🔒 Verification Status:', updatedUser.providerVerificationStatus);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
fixChotiBahuData();