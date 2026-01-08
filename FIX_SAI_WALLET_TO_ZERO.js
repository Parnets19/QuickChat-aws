const mongoose = require("mongoose");
const { User } = require("./src/models");
require("dotenv").config();

/**
 * FIX: Set Sai's wallet balance to ₹0
 */

const connectDB = async () => {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

async function fixSaiWalletToZero() {
  console.log("💰 FIXING SAI'S WALLET TO ₹0");
  console.log("=".repeat(40));

  try {
    await connectDB();

    // Find Sai
    const sai = await User.findOne({ fullName: { $regex: /sai.*pavithra/i } });

    if (!sai) {
      console.log("❌ Sai not found");
      return;
    }

    console.log("👤 SAI BEFORE FIX:");
    console.log(`   Name: ${sai.fullName}`);
    console.log(`   Current Wallet: ₹${sai.wallet}`);
    console.log(`   Total Earnings: ₹${sai.earnings}`);

    // Set wallet to 0
    sai.wallet = 0;
    await sai.save();

    console.log("\n✅ SAI AFTER FIX:");
    console.log(`   Name: ${sai.fullName}`);
    console.log(`   New Wallet: ₹${sai.wallet}`);
    console.log(`   Total Earnings: ₹${sai.earnings} (unchanged)`);

    console.log("\n🎯 WALLET FIX COMPLETE!");
    console.log("   Sai's wallet is now set to ₹0");

    process.exit(0);
  } catch (error) {
    console.error("❌ Fix failed:", error);
    process.exit(1);
  }
}

fixSaiWalletToZero();
