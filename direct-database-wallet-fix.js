const mongoose = require("mongoose");
require("dotenv").config();

// Connect to MongoDB
async function fixWalletDirectly() {
  try {
    console.log("🔧 DIRECT DATABASE WALLET FIX");
    console.log("==============================");

    // Connect to MongoDB
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat";
    console.log("Connecting to MongoDB...");
    console.log("URI:", mongoUri.replace(/\/\/.*@/, "//***:***@")); // Hide credentials

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Find Nandu's user record
    const User = mongoose.model(
      "User",
      new mongoose.Schema({}, { strict: false })
    );

    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });

    if (!nandu) {
      console.log("❌ Nandu not found in database");
      return;
    }

    console.log(`Found Nandu: ${nandu.fullName}`);
    console.log(`Current wallet: ₹${nandu.wallet}`);

    // Fix the wallet balance
    const newBalance = 5.0;

    const result = await User.updateOne(
      { _id: nandu._id },
      {
        $set: {
          wallet: newBalance,
          updatedAt: new Date(),
        },
      }
    );

    console.log(`✅ Wallet update result:`, result);

    // Verify the update
    const updatedNandu = await User.findById(nandu._id);
    console.log(`✅ Updated wallet: ₹${updatedNandu.wallet}`);

    // Also ensure no other users have negative balances
    console.log("\n🔍 Checking for other negative balances...");

    const negativeBalanceUsers = await User.find({ wallet: { $lt: 0 } });
    console.log(
      `Found ${negativeBalanceUsers.length} users with negative balances`
    );

    if (negativeBalanceUsers.length > 0) {
      console.log("Fixing all negative balances...");

      for (const user of negativeBalanceUsers) {
        console.log(`Fixing ${user.fullName}: ₹${user.wallet} -> ₹0`);
        await User.updateOne({ _id: user._id }, { $set: { wallet: 0 } });
      }

      console.log("✅ All negative balances fixed");
    }

    await mongoose.disconnect();
    console.log("✅ Database connection closed");

    console.log("\n📋 DATABASE FIX COMPLETE:");
    console.log("=========================");
    console.log(`✅ Nandu's wallet: ₹${newBalance}`);
    console.log("✅ All negative balances fixed");
    console.log("✅ Database updated successfully");
  } catch (error) {
    console.error("❌ Database fix failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run the fix
fixWalletDirectly();
