const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import User model
const User = require('../src/models/User.model');

async function testKycData() {
  try {
    console.log('🔍 Testing KYC data structure...');
    
    // Find a provider to test with
    const provider = await User.findOne({ 
      email: 'chotibahu123@gmail.com' 
    })
    .select('-password -fcmTokens -socialLogins')
    .populate('serviceCategories')
    .lean();
    
    if (!provider) {
      console.log('❌ Test provider not found');
      return;
    }
    
    console.log('\n📊 Provider Data Structure:');
    console.log('👤 Basic Info:');
    console.log(`   Name: ${provider.fullName}`);
    console.log(`   Email: ${provider.email}`);
    console.log(`   Mobile: ${provider.mobile}`);
    console.log(`   DOB: ${provider.dateOfBirth ? new Date(provider.dateOfBirth).toLocaleDateString() : 'Not set'}`);
    console.log(`   Gender: ${provider.gender || 'Not set'}`);
    
    console.log('\n🏠 Location:');
    if (provider.place) {
      console.log(`   Village: ${provider.place.village || 'Not set'}`);
      console.log(`   City: ${provider.place.city || 'Not set'}`);
      console.log(`   State: ${provider.place.state || 'Not set'}`);
      console.log(`   Country: ${provider.place.country || 'Not set'}`);
    }
    
    console.log('\n💼 Professional:');
    console.log(`   Profession: ${provider.profession || 'Not set'}`);
    console.log(`   Education: ${provider.education || 'Not set'}`);
    console.log(`   Skills: ${provider.skills ? provider.skills.join(', ') : 'Not set'}`);
    console.log(`   Languages: ${provider.languagesKnown ? provider.languagesKnown.join(', ') : 'Not set'}`);
    console.log(`   Bio: ${provider.bio || 'Not set'}`);
    
    console.log('\n🛠️ Services:');
    console.log(`   Categories: ${provider.serviceCategories ? provider.serviceCategories.length : 0}`);
    if (provider.consultationModes) {
      console.log(`   Chat: ${provider.consultationModes.chat ? '✅' : '❌'}`);
      console.log(`   Audio: ${provider.consultationModes.audio ? '✅' : '❌'}`);
      console.log(`   Video: ${provider.consultationModes.video ? '✅' : '❌'}`);
    }
    
    console.log('\n💰 Rates:');
    if (provider.rates) {
      console.log(`   Chat: ₹${provider.rates.chat || 0}`);
      console.log(`   Audio: ₹${provider.rates.audio || 0}`);
      console.log(`   Video: ₹${provider.rates.video || 0}`);
      console.log(`   Charge Type: ${provider.rates.chargeType || 'Not set'}`);
    }
    
    console.log('\n🏦 Bank Details:');
    if (provider.bankDetails) {
      console.log(`   Account Holder: ${provider.bankDetails.accountHolderName || 'Not set'}`);
      console.log(`   Account Number: ****${provider.bankDetails.accountNumber?.slice(-4) || 'Not set'}`);
      console.log(`   IFSC: ${provider.bankDetails.ifscCode || 'Not set'}`);
      console.log(`   Bank: ${provider.bankDetails.bankName || 'Not set'}`);
    }
    
    console.log('\n📄 Documents:');
    console.log(`   Profile Photo: ${provider.profilePhoto ? '✅' : '❌'}`);
    console.log(`   Aadhar Front: ${provider.aadharDocuments?.front ? '✅' : '❌'}`);
    console.log(`   Portfolio Items: ${provider.portfolioMedia ? provider.portfolioMedia.length : 0}`);
    
    console.log('\n🔒 Verification:');
    console.log(`   Status: ${provider.providerVerificationStatus || 'Not set'}`);
    console.log(`   Notes: ${provider.verificationNotes || 'None'}`);
    console.log(`   Verified At: ${provider.verifiedAt ? new Date(provider.verifiedAt).toLocaleString() : 'Not verified'}`);
    
    console.log('\n✅ All data is available for admin review!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the script
testKycData();