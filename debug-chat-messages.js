const mongoose = require("mongoose");

async function debugChatMessages() {
  try {
    console.log("🔍 Debug Chat Messages");
    console.log("=======================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // Check chats collection
    const chats = await db.collection("chats").find({}).toArray();
    console.log(`\n💬 Chats: ${chats.length} documents`);
    if (chats.length > 0) {
      console.log(
        "📋 Latest chat:",
        JSON.stringify(chats[chats.length - 1], null, 2)
      );
    }

    // Check chatmessages collection
    const chatMessages = await db.collection("chatmessages").find({}).toArray();
    console.log(`\n📝 ChatMessages: ${chatMessages.length} documents`);
    if (chatMessages.length > 0) {
      console.log(
        "📋 Latest message:",
        JSON.stringify(chatMessages[chatMessages.length - 1], null, 2)
      );
    }

    // Check relationship between chats and messages
    if (chats.length > 0 && chatMessages.length > 0) {
      const chatId = chats[0]._id.toString();
      const messagesForChat = chatMessages.filter(
        (m) => m.chat && m.chat.toString() === chatId
      );
      console.log(
        `\n🔍 Messages for chat ${chatId}: ${messagesForChat.length}`
      );

      if (messagesForChat.length > 0) {
        console.log(
          "📋 Example message for this chat:",
          JSON.stringify(messagesForChat[0], null, 2)
        );
      }
    }

    // Check for messages without chat reference
    const orphanedMessages = chatMessages.filter((m) => !m.chat);
    if (orphanedMessages.length > 0) {
      console.log(
        `\n❌ Orphaned messages (no chat reference): ${orphanedMessages.length}`
      );
      console.log(
        "📋 Example orphaned message:",
        JSON.stringify(orphanedMessages[0], null, 2)
      );
    }

    await mongoose.connection.close();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

debugChatMessages();
