// Script to fix the existing admin account
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function fixAdminAccount() {
  console.log("🔧 FIXING EXISTING ADMIN ACCOUNT");
  console.log("");

  try {
    // Connect to MongoDB
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat";
    console.log("📡 Connecting to MongoDB...");

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
    console.log("");

    // Get database instance for direct operations
    const db = mongoose.connection.db;

    // Find existing admin
    console.log("🔍 Looking for existing admin account...");
    const existingAdmin = await db.collection("admins").findOne({});

    if (!existingAdmin) {
      console.log("❌ No admin account found. Creating new one...");

      // Create new admin account
      const newAdminData = {
        email: "admin@quickchat.com",
        password: await bcrypt.hash("admin123", 10),
        name: "QuickChat Admin",
        role: "admin",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection("admins").insertOne(newAdminData);
      console.log("✅ New admin account created with ID:", result.insertedId);
    } else {
      console.log("📋 Found existing admin account:");
      console.log(`   ID: ${existingAdmin._id}`);
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Name: ${existingAdmin.name || "undefined"}`);
      console.log(`   Role: ${existingAdmin.role || "undefined"}`);
      console.log("");

      // Update the admin account with proper data
      console.log("🔄 Updating admin account with complete data...");

      const updateData = {
        name: "QuickChat Admin",
        role: "admin",
        isActive: true,
        updatedAt: new Date(),
      };

      // If email needs to be updated
      if (existingAdmin.email !== "admin@quickchat.com") {
        updateData.email = "admin@quickchat.com";
      }

      // Update password to a known value
      updateData.password = await bcrypt.hash("admin123", 10);

      const updateResult = await db
        .collection("admins")
        .updateOne({ _id: existingAdmin._id }, { $set: updateData });

      console.log(
        `✅ Admin account updated. Modified ${updateResult.modifiedCount} document(s)`
      );
    }

    // Verify the final admin account
    console.log("");
    console.log("🔍 Verifying final admin account...");
    const finalAdmin = await db.collection("admins").findOne({});

    if (finalAdmin) {
      console.log("✅ Admin account verified:");
      console.log(`   ID: ${finalAdmin._id}`);
      console.log(`   Email: ${finalAdmin.email}`);
      console.log(`   Name: ${finalAdmin.name}`);
      console.log(`   Role: ${finalAdmin.role}`);
      console.log(`   Active: ${finalAdmin.isActive}`);
      console.log(`   Created: ${finalAdmin.createdAt}`);
      console.log(`   Updated: ${finalAdmin.updatedAt}`);
    }

    console.log("");
    console.log("🎉 ADMIN ACCOUNT FIX COMPLETE!");
    console.log("");
    console.log("🔑 LOGIN CREDENTIALS:");
    console.log("   Email: admin@quickchat.com");
    console.log("   Password: admin123");
    console.log("");
    console.log("🚀 NEXT STEPS:");
    console.log("1. Go to admin login page");
    console.log("2. Use the credentials above to login");
    console.log("3. You should now have full admin access");
    console.log("4. Change password after first login (recommended)");
  } catch (error) {
    console.error("❌ Error fixing admin account:", error.message);
    console.error("");
    console.error("🔧 TROUBLESHOOTING:");
    console.error("1. Make sure MongoDB is running");
    console.error("2. Check .env file for correct MONGODB_URI");
    console.error("3. Verify bcryptjs is installed");
  } finally {
    // Close connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("📡 MongoDB connection closed");
    }
  }
}

// Run the admin fix
if (require.main === module) {
  fixAdminAccount()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

module.exports = fixAdminAccount;
