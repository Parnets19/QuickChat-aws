// Script to delete all MongoDB data using backend connection
const mongoose = require("mongoose");
require("dotenv").config();

// Import all models to ensure they're registered
const User = require("./src/models/User");
const Consultation = require("./src/models/Consultation");
const Message = require("./src/models/Message");
const Transaction = require("./src/models/Transaction");
const Notification = require("./src/models/Notification");
const Review = require("./src/models/Review");
const Document = require("./src/models/Document");

async function deleteAllData() {
  console.log("🗑️  DELETING ALL QUICKCHAT DATA");
  console.log("⚠️  WARNING: This will permanently delete ALL data!");
  console.log("");

  try {
    // Connect to MongoDB using backend config
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat";
    console.log("📡 Connecting to MongoDB...");
    console.log(`   URI: ${mongoUri.replace(/\/\/.*@/, "//***:***@")}`); // Hide credentials

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
    console.log("");

    // Get all model names
    const modelNames = mongoose.modelNames();
    console.log(`📋 Found ${modelNames.length} registered models:`);
    modelNames.forEach((name) => console.log(`  - ${name}`));
    console.log("");

    // Delete data from each model
    console.log("🗑️  Deleting data from all collections...");
    const deletionResults = [];

    for (const modelName of modelNames) {
      try {
        const Model = mongoose.model(modelName);
        const count = await Model.countDocuments();

        if (count > 0) {
          await Model.deleteMany({});
          console.log(`✅ Deleted ${count} documents from ${modelName}`);
          deletionResults.push({
            model: modelName,
            deleted: count,
            success: true,
          });
        } else {
          console.log(`ℹ️  ${modelName} was already empty`);
          deletionResults.push({ model: modelName, deleted: 0, success: true });
        }
      } catch (error) {
        console.log(`❌ Error deleting from ${modelName}:`, error.message);
        deletionResults.push({
          model: modelName,
          deleted: 0,
          success: false,
          error: error.message,
        });
      }
    }

    console.log("");
    console.log("📊 DELETION SUMMARY:");
    let totalDeleted = 0;
    let successCount = 0;

    deletionResults.forEach((result) => {
      if (result.success) {
        totalDeleted += result.deleted;
        successCount++;
        if (result.deleted > 0) {
          console.log(
            `✅ ${result.model}: ${result.deleted} documents deleted`
          );
        }
      } else {
        console.log(`❌ ${result.model}: Failed - ${result.error}`);
      }
    });

    console.log("");
    console.log(`🎯 FINAL RESULTS:`);
    console.log(
      `✅ Models processed successfully: ${successCount}/${modelNames.length}`
    );
    console.log(`✅ Total documents deleted: ${totalDeleted}`);
    console.log("");

    // Verify collections are empty
    console.log("🔍 Verifying all collections are empty...");
    let allEmpty = true;

    for (const modelName of modelNames) {
      try {
        const Model = mongoose.model(modelName);
        const count = await Model.countDocuments();
        if (count > 0) {
          console.log(`⚠️  ${modelName} still has ${count} documents`);
          allEmpty = false;
        }
      } catch (error) {
        console.log(`❌ Error checking ${modelName}:`, error.message);
        allEmpty = false;
      }
    }

    if (allEmpty) {
      console.log("✅ All collections are empty - database is clean!");
    } else {
      console.log("⚠️  Some collections still contain data");
    }

    console.log("");
    console.log("🎉 DATABASE CLEANUP COMPLETE!");
    console.log("");
    console.log("🚀 NEXT STEPS:");
    console.log("1. Restart the backend server (npm run dev)");
    console.log("2. Test user registration (creates fresh user accounts)");
    console.log("3. Test all functionality with clean data");
    console.log("4. Collections will be recreated automatically as needed");
    console.log("");
    console.log("💡 BENEFITS:");
    console.log("✅ No corrupted user data");
    console.log("✅ Fresh wallet balances (0 for all new users)");
    console.log("✅ Clean message history");
    console.log("✅ No old consultations");
    console.log("✅ Fresh notification system");
    console.log("✅ Clean transaction history");
  } catch (error) {
    console.error("❌ Error during data deletion:", error.message);
    console.error("");
    console.error("🔧 TROUBLESHOOTING:");
    console.error("1. Make sure MongoDB is running");
    console.error("2. Check .env file for correct MONGODB_URI");
    console.error("3. Verify database permissions");
    console.error("4. Try restarting MongoDB service");
  } finally {
    // Close connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("📡 MongoDB connection closed");
    }
  }
}

// Run the deletion
if (require.main === module) {
  deleteAllData()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

module.exports = deleteAllData;
