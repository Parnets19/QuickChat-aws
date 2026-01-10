// Script to delete all MongoDB data using backend connection
const mongoose = require("mongoose");
require("dotenv").config();

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

    // Get database instance
    const db = mongoose.connection.db;

    // List all collections
    console.log("📋 Listing all collections...");
    const collections = await db.listCollections().toArray();
    console.log(`Found ${collections.length} collections:`);

    let totalDocuments = 0;
    for (const collection of collections) {
      const count = await db.collection(collection.name).countDocuments();
      console.log(`  - ${collection.name}: ${count} documents`);
      totalDocuments += count;
    }
    console.log(`📊 Total documents in database: ${totalDocuments}`);
    console.log("");

    if (totalDocuments === 0) {
      console.log("ℹ️  Database is already empty!");
      return;
    }

    // Delete all collections
    console.log("🗑️  Deleting all collections...");
    let deletedCollections = 0;
    let deletedDocuments = 0;

    for (const collection of collections) {
      const collectionName = collection.name;

      try {
        // Get document count before deletion
        const docCount = await db.collection(collectionName).countDocuments();

        if (docCount > 0) {
          // Delete all documents in the collection
          const result = await db.collection(collectionName).deleteMany({});
          console.log(
            `✅ Deleted ${result.deletedCount} documents from ${collectionName}`
          );
          deletedDocuments += result.deletedCount;
        } else {
          console.log(`ℹ️  ${collectionName} was already empty`);
        }

        deletedCollections++;
      } catch (error) {
        console.log(
          `❌ Error deleting from collection ${collectionName}:`,
          error.message
        );
      }
    }

    console.log("");
    console.log(`🎯 DELETION SUMMARY:`);
    console.log(
      `✅ Collections processed: ${deletedCollections}/${collections.length}`
    );
    console.log(`✅ Total documents deleted: ${deletedDocuments}`);
    console.log("");

    // Verify database is empty
    console.log("🔍 Verifying database is empty...");
    const remainingCollections = await db.listCollections().toArray();
    let remainingDocuments = 0;

    for (const collection of remainingCollections) {
      const count = await db.collection(collection.name).countDocuments();
      remainingDocuments += count;
      if (count > 0) {
        console.log(`⚠️  ${collection.name} still has ${count} documents`);
      }
    }

    if (remainingDocuments === 0) {
      console.log("✅ All collections are empty - database is clean!");
    } else {
      console.log(
        `⚠️  ${remainingDocuments} documents still remain in database`
      );
    }
    console.log("");

    console.log("🎉 MONGODB DATA DELETION COMPLETE!");
    console.log("");
    console.log("🚀 NEXT STEPS:");
    console.log("1. Restart the backend server (npm run dev)");
    console.log("2. Register new users (they will be created fresh)");
    console.log("3. Test all functionality with clean data");
    console.log("4. Collections will be automatically recreated as needed");
    console.log("");
    console.log("💡 BENEFITS OF FRESH START:");
    console.log("✅ No corrupted data");
    console.log("✅ No inconsistent states");
    console.log("✅ Clean user accounts");
    console.log("✅ Fresh wallet balances");
    console.log("✅ No old messages/consultations");
    console.log("✅ Clean notification system");
    console.log("✅ No billing inconsistencies");
    console.log("✅ Fresh transaction history");
  } catch (error) {
    console.error("❌ Error during MongoDB data deletion:", error.message);
    console.error("");
    console.error("🔧 TROUBLESHOOTING:");
    console.error("1. Check if MongoDB is running");
    console.error("2. Verify .env file has correct MONGODB_URI");
    console.error("3. Ensure you have proper database permissions");
    console.error("4. Try connecting manually with MongoDB Compass");
    console.error("5. Check if database name is correct");
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
