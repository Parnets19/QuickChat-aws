const mongoose = require("mongoose");

async function verifyChatInDatabase() {
  try {
    console.log("🔍 Verify Chat in Database");
    console.log("===========================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // Look for the specific chat ID we know exists
    const targetChatId = "69622dfa88b3545378c86237";

    console.log(`\n🎯 Looking for chat: ${targetChatId}`);

    // Check chats collection with ObjectId
    const { ObjectId } = require("mongodb");
    const chat = await db
      .collection("chats")
      .findOne({ _id: new ObjectId(targetChatId) });

    if (chat) {
      console.log("✅ Chat found in database!");
      console.log("📋 Chat details:", JSON.stringify(chat, null, 2));
    } else {
      console.log("❌ Chat not found in chats collection");
    }

    // Check messages for this chat
    const messages = await db
      .collection("chatmessages")
      .find({ chat: new ObjectId(targetChatId) })
      .toArray();
    console.log(`\n📝 Messages for this chat: ${messages.length}`);

    if (messages.length > 0) {
      console.log(
        "📋 Latest message:",
        JSON.stringify(messages[messages.length - 1], null, 2)
      );
    }

    // Check total counts
    const totalChats = await db.collection("chats").countDocuments();
    const totalMessages = await db.collection("chatmessages").countDocuments();

    console.log(`\n📊 Total chats in database: ${totalChats}`);
    console.log(`📊 Total messages in database: ${totalMessages}`);

    await mongoose.connection.close();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

verifyChatInDatabase();
