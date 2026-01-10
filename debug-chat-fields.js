const mongoose = require("mongoose");
const { ChatMessage, User } = require("./src/models");

async function debugChatFields() {
  try {
    console.log("🔍 Debugging Chat Message Fields");
    console.log("================================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    // Check the latest chat messages
    console.log("\n📨 Checking latest chat messages...");

    // Check collection names first
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    console.log(
      "Available collections:",
      collections.map((c) => c.name)
    );

    const messages = await ChatMessage.find({})
      .sort({ timestamp: -1 })
      .limit(5);

    console.log(
      `Found ${messages.length} recent messages in ChatMessage collection:`
    );

    if (messages.length === 0) {
      // Try to find in other possible collections
      console.log("\n🔍 Checking other possible message collections...");

      try {
        const allMessages = await mongoose.connection.db
          .collection("chatmessages")
          .find({})
          .sort({ timestamp: -1 })
          .limit(5)
          .toArray();
        console.log(
          `Found ${allMessages.length} messages in 'chatmessages' collection:`
        );

        allMessages.forEach((msg, index) => {
          console.log(`\n📨 Message ${index + 1}:`);
          console.log(`   ID: ${msg._id}`);
          console.log(`   Sender ID: ${msg.sender}`);
          console.log(`   Sender Type: ${msg.senderType}`);
          console.log(`   Sender Name: ${msg.senderName || "MISSING ❌"}`);
          console.log(
            `   Sender Avatar: ${
              msg.senderAvatar !== undefined
                ? msg.senderAvatar || "null"
                : "MISSING ❌"
            }`
          );
          console.log(`   Message: ${msg.message}`);
          console.log(`   Status: ${msg.status}`);
          console.log(
            `   Timestamp: ${new Date(msg.timestamp).toLocaleString()}`
          );
        });

        return; // Exit early if we found messages in the raw collection
      } catch (error) {
        console.log("Error checking chatmessages collection:", error.message);
      }
    }

    messages.forEach((msg, index) => {
      console.log(`\n📨 Message ${index + 1}:`);
      console.log(`   ID: ${msg._id}`);
      console.log(`   Sender ID: ${msg.sender}`);
      console.log(`   Sender Type: ${msg.senderType}`);
      console.log(`   Sender Name: ${msg.senderName || "MISSING ❌"}`);
      console.log(
        `   Sender Avatar: ${
          msg.senderAvatar !== undefined
            ? msg.senderAvatar || "null"
            : "MISSING ❌"
        }`
      );
      console.log(`   Message: ${msg.message}`);
      console.log(`   Status: ${msg.status}`);
      console.log(`   Timestamp: ${new Date(msg.timestamp).toLocaleString()}`);
    });

    // Check users to verify profile photos
    console.log("\n👤 Checking user profile photos...");
    const users = await User.find({
      _id: { $in: ["69621e4b88b3545378c8542e", "6962027788b3545378c851c0"] },
    });

    users.forEach((user) => {
      console.log(`\n👤 User: ${user.fullName}`);
      console.log(`   ID: ${user._id}`);
      console.log(`   Profile Photo: ${user.profilePhoto || "None"}`);
    });

    console.log("\n🔧 Debugging Summary:");
    console.log("=====================");

    const hasStoredSenderNames = messages.some((msg) => msg.senderName);
    const hasStoredSenderAvatars = messages.some(
      (msg) => msg.senderAvatar !== undefined
    );

    console.log(
      `✅ Messages with senderName: ${
        hasStoredSenderNames ? "Found ✅" : "Missing ❌"
      }`
    );
    console.log(
      `✅ Messages with senderAvatar: ${
        hasStoredSenderAvatars ? "Found ✅" : "Missing ❌"
      }`
    );

    if (!hasStoredSenderNames || !hasStoredSenderAvatars) {
      console.log("\n⚠️ Issue: New fields not being saved to database");
      console.log("   Solution: Restart backend server to apply model changes");
    } else {
      console.log("\n✅ Fields are being saved correctly");
      console.log("   Issue might be in the API response formatting");
    }
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB connection closed");
  }
}

debugChatFields();
