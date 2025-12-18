const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import User model
const User = require('../src/models/User.model');

async function verifyExistingProviders() {
  try {
    console.log('🔍 Finding existing service providers...');
    
    // Find all service providers
    const providers = await User.find({ 
      isServiceProvider: true 
    }).select('fullName email mobile providerVerificationStatus');
    
    console.log(`📊 Found ${providers.length} service providers:`);
    providers.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.fullName} (${provider.email}) - Status: ${provider.providerVerificationStatus || 'undefined'}`);
    });
    
    // Update all existing providers to verified status
    const updateResult = await User.updateMany(
      { 
        isServiceProvider: true,
        $or: [
          { providerVerificationStatus: { $exists: false } },
          { providerVerificationStatus: 'pending' }
        ]
      },
      {
        $set: {
          providerVerificationStatus: 'verified',
          verificationNotes: 'Bulk verified - existing provider before verification system',
          verifiedAt: new Date(),
          isAadharVerified: true
        }
      }
    );
    
    console.log(`✅ Successfully verified ${updateResult.modifiedCount} existing providers`);
    
    // Show updated status
    const updatedProviders = await User.find({ 
      isServiceProvider: true 
    }).select('fullName email providerVerificationStatus verifiedAt');
    
    console.log('\n📋 Updated provider statuses:');
    updatedProviders.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.fullName} - Status: ${provider.providerVerificationStatus} (${provider.verifiedAt ? 'Verified on: ' + provider.verifiedAt.toLocaleDateString() : 'Not verified'})`);
    });
    
    console.log('\n🎉 All existing providers have been verified!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
verifyExistingProviders();