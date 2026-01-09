const mongoose = require("mongoose");
require("dotenv").config();

async function clearAllMessages() {
  try {
    console.log("🔍 Connecting to MongoDB...");
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat"
    );
    console.log("✅ Connected to MongoDB\n");

    const Consultation = require("./src/models/Consultation.model");

    // Get all consultations
    console.log("📊 Fetching all consultations...");
    const consultations = await Consultation.find({});
    console.log(`Found ${consultations.length} consultations\n`);

    let totalMessagesCleared = 0;

    // Clear messages from each consultation
    for (const consultation of consultations) {
      const messageCount = consultation.messages?.length || 0;
      if (messageCount > 0) {
        console.log(
          `🗑️  Clearing ${messageCount} messages from consultation ${consultation._id}`
        );
        consultation.messages = [];
        consultation.lastMessageAt = null;
        await consultation.save();
        totalMessagesCleared += messageCount;
      }
    }

    console.log("\n✅ All messages cleared!");
    console.log(`   Total consultations: ${consultations.length}`);
    console.log(`   Total messages cleared: ${totalMessagesCleared}`);

    // Also clear Chat and ChatMessage collections if they exist
    try {
      const Chat = mongoose.model(
        "Chat",
        new mongoose.Schema({}, { strict: false })
      );
      const ChatMessage = mongoose.model(
        "ChatMessage",
        new mongoose.Schema({}, { strict: false })
      );

      const chatCount = await Chat.countDocuments();
      const chatMessageCount = await ChatMessage.countDocuments();

      if (chatCount > 0) {
        console.log(`\n🗑️  Deleting ${chatCount} chat records...`);
        await Chat.deleteMany({});
        console.log("✅ Chat records deleted");
      }

      if (chatMessageCount > 0) {
        console.log(`🗑️  Deleting ${chatMessageCount} chat messages...`);
        await ChatMessage.deleteMany({});
        console.log("✅ Chat messages deleted");
      }
    } catch (error) {
      console.log(
        "\nℹ️  Chat/ChatMessage collections not found or already empty"
      );
    }

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
    console.log("\n🎉 Database is now clean and ready for fresh testing!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

clearAllMessages();
