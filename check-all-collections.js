const mongoose = require("mongoose");

async function checkAllCollections() {
  try {
    console.log("🔍 Checking All Collections for Messages");
    console.log("=======================================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    // Get all collection names
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    console.log(
      "\n📁 Available collections:",
      collections.map((c) => c.name)
    );

    // Check each collection for any documents that might be messages
    for (const collection of collections) {
      try {
        const count = await mongoose.connection.db
          .collection(collection.name)
          .countDocuments();

        if (count > 0) {
          console.log(
            `\n📊 Collection '${collection.name}': ${count} documents`
          );

          // Get a sample document to see its structure
          const sample = await mongoose.connection.db
            .collection(collection.name)
            .findOne({});

          if (sample) {
            console.log(`   Sample document fields:`, Object.keys(sample));

            // Check if this looks like a message collection
            const messageFields = ["message", "sender", "text", "content"];
            const hasMessageFields = messageFields.some((field) =>
              sample.hasOwnProperty(field)
            );

            if (hasMessageFields) {
              console.log(`   🎯 POTENTIAL MESSAGE COLLECTION!`);

              // Get recent documents from this collection
              const recent = await mongoose.connection.db
                .collection(collection.name)
                .find({})
                .sort({ _id: -1 })
                .limit(3)
                .toArray();

              recent.forEach((doc, index) => {
                console.log(`\n   📨 Recent Document ${index + 1}:`);
                console.log(`     ID: ${doc._id}`);
                console.log(
                  `     Message: ${
                    doc.message || doc.text || doc.content || "N/A"
                  }`
                );
                console.log(`     Sender: ${doc.sender || "N/A"}`);
                console.log(`     SenderName: ${doc.senderName || "MISSING"}`);
                console.log(
                  `     SenderAvatar: ${doc.senderAvatar || "MISSING"}`
                );
                console.log(
                  `     Timestamp: ${
                    doc.timestamp || doc.createdAt || doc.updatedAt || "N/A"
                  }`
                );
              });
            }
          }
        }
      } catch (error) {
        console.log(`   Error checking '${collection.name}':`, error.message);
      }
    }
  } catch (error) {
    console.error("❌ Check failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 MongoDB connection closed");
  }
}

checkAllCollections();
