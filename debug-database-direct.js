const mongoose = require("mongoose");

async function debugDatabaseDirect() {
  try {
    console.log("🔍 Direct Database Debug");
    console.log("=======================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    // Get all collection names
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    console.log(
      "\n� Available collections:",
      collections.map((c) => c.name)
    );

    // Check each possible message collection
    const possibleCollections = ["chatmessages", "messages", "chats"];

    for (const collectionName of possibleCollections) {
      try {
        const count = await mongoose.connection.db
          .collection(collectionName)
          .countDocuments();
        console.log(`\n📊 Collection '${collectionName}': ${count} documents`);

        if (count > 0) {
          const sample = await mongoose.connection.db
            .collection(collectionName)
            .find({})
            .sort({ timestamp: -1, _id: -1 })
            .limit(3)
            .toArray();

          console.log(`\n📨 Sample documents from '${collectionName}':`);
          sample.forEach((doc, index) => {
            console.log(`\n   Document ${index + 1}:`);
            console.log(`     ID: ${doc._id}`);
            console.log(`     Sender: ${doc.sender}`);
            console.log(`     SenderType: ${doc.senderType}`);
            console.log(`     SenderName: ${doc.senderName || "MISSING ❌"}`);
            console.log(
              `     SenderAvatar: ${
                doc.senderAvatar !== undefined
                  ? doc.senderAvatar || "null"
                  : "MISSING ❌"
              }`
            );
            console.log(`     Message: ${doc.message || doc.lastMessage}`);
            console.log(`     Timestamp: ${doc.timestamp || doc.createdAt}`);

            // Show all fields for debugging
            console.log(`     All fields:`, Object.keys(doc));
          });
        }
      } catch (error) {
        console.log(`   Error checking '${collectionName}':`, error.message);
      }
    }

    // Also check if there are any messages in the chats collection
    try {
      const chats = await mongoose.connection.db
        .collection("chats")
        .find({})
        .limit(3)
        .toArray();

      if (chats.length > 0) {
        console.log(`\n💬 Sample chats:`);
        chats.forEach((chat, index) => {
          console.log(`\n   Chat ${index + 1}:`);
          console.log(`     ID: ${chat._id}`);
          console.log(`     User: ${chat.user}`);
          console.log(`     Provider: ${chat.provider}`);
          console.log(`     Last Message: ${chat.lastMessage}`);
          console.log(`     Last Message Time: ${chat.lastMessageTime}`);
        });
      }
    } catch (error) {
      console.log("Error checking chats:", error.message);
    }
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 MongoDB connection closed");
  }
}

debugDatabaseDirect();
