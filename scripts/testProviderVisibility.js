const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import User model
const User = require('../src/models/User.model');

async function testProviderVisibility() {
  try {
    console.log('🔍 Testing provider visibility in search...');
    
    // Get all service providers
    const allProviders = await User.find({ 
      isServiceProvider: true 
    }).select('fullName email providerVerificationStatus');
    
    console.log('\n📊 All Service Providers:');
    allProviders.forEach((provider, index) => {
      const status = provider.providerVerificationStatus || 'undefined';
      const emoji = status === 'verified' ? '✅' : status === 'pending' ? '🟡' : '❌';
      console.log(`${index + 1}. ${emoji} ${provider.fullName} (${provider.email}) - ${status}`);
    });
    
    // Test the search query that would be used by FindPerson page
    const searchQuery = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: "active",
      providerVerificationStatus: "verified", // Only verified providers
    };
    
    const visibleProviders = await User.find(searchQuery)
      .select('fullName email providerVerificationStatus');
    
    console.log('\n👁️ Providers Visible in Search (FindPerson page):');
    if (visibleProviders.length === 0) {
      console.log('   No providers visible (all are unverified)');
    } else {
      visibleProviders.forEach((provider, index) => {
        console.log(`${index + 1}. ✅ ${provider.fullName} (${provider.email}) - ${provider.providerVerificationStatus}`);
      });
    }
    
    // Test without verification filter (old behavior)
    const oldQuery = {
      isServiceProvider: true,
      isProfileHidden: false,
      status: "active",
      // No verification filter
    };
    
    const oldResults = await User.find(oldQuery)
      .select('fullName email providerVerificationStatus');
    
    console.log('\n🔓 Providers That Would Be Visible Without Verification Filter:');
    oldResults.forEach((provider, index) => {
      const status = provider.providerVerificationStatus || 'undefined';
      const emoji = status === 'verified' ? '✅' : status === 'pending' ? '🟡' : '❌';
      console.log(`${index + 1}. ${emoji} ${provider.fullName} (${provider.email}) - ${status}`);
    });
    
    console.log('\n📈 Summary:');
    console.log(`   Total Providers: ${allProviders.length}`);
    console.log(`   Verified Providers: ${allProviders.filter(p => p.providerVerificationStatus === 'verified').length}`);
    console.log(`   Pending Providers: ${allProviders.filter(p => p.providerVerificationStatus === 'pending').length}`);
    console.log(`   Visible in Search: ${visibleProviders.length}`);
    console.log(`   Hidden from Search: ${allProviders.length - visibleProviders.length}`);
    
    if (visibleProviders.length < allProviders.length) {
      console.log('\n✅ SUCCESS: Unverified providers are properly hidden from search!');
    } else {
      console.log('\n❌ ISSUE: All providers are still visible in search');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the script
testProviderVisibility();