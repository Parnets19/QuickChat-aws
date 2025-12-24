const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const { User } = require('../src/models');

async function fixUserRoles() {
  try {
    console.log('🔧 Fixing User Roles...\n');

    // Get all users with null roles
    const usersWithNullRoles = await User.find({ 
      $or: [
        { role: null },
        { role: { $exists: false } },
        { role: '' }
      ]
    }).lean();

    console.log(`Found ${usersWithNullRoles.length} users with null/missing roles:`);
    
    for (const user of usersWithNullRoles) {
      console.log(`- ${user.fullName || 'No Name'} (${user.email})`);
      
      // Determine role based on user data
      let newRole = 'user'; // default role
      
      // Check if user has provider-like fields
      if (user.profession || user.experience || user.callRate || user.isServiceProvider) {
        newRole = 'provider';
        console.log(`  → Should be PROVIDER (has profession: ${user.profession})`);
      } else {
        console.log(`  → Should be USER (no provider fields)`);
      }
      
      // Update the user's role
      await User.findByIdAndUpdate(user._id, { role: newRole });
      console.log(`  ✅ Updated role to: ${newRole}`);
    }

    // Verify the fix
    console.log('\n📊 Updated Role Distribution:');
    const newRoleDistribution = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    newRoleDistribution.forEach(role => {
      console.log(`- ${role._id || 'null'}: ${role.count} users`);
    });

    // Count providers specifically
    const totalProviders = await User.countDocuments({ role: 'provider' });
    const totalUsers = await User.countDocuments({ role: 'user' });
    
    console.log('\n✅ Final Counts:');
    console.log(`- Total Providers: ${totalProviders}`);
    console.log(`- Total Regular Users: ${totalUsers}`);
    console.log(`- Total: ${totalProviders + totalUsers}`);

    console.log('\n🎉 User roles have been fixed!');
    console.log('Now refresh the Reports & Analytics page to see the correct provider count.');

  } catch (error) {
    console.error('❌ Error fixing user roles:', error);
  } finally {
    mongoose.connection.close();
  }
}

fixUserRoles();