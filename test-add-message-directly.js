const mongoose = require("mongoose");
require("dotenv").config();

const CONSULTATION_ID = "69608d363afe20c2e460eb73";
const SHUBHAM_ID = "6943aa41a517365ff302e849";

async function testAddMessage() {
  try {
    console.log("🔍 Connecting to MongoDB...");
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat"
    );
    console.log("✅ Connected\n");

    const Consultation = require("./src/models/Consultation.model");

    console.log("🔍 Finding consultation...");
    const consultation = await Consultation.findById(CONSULTATION_ID);

    if (!consultation) {
      console.log("❌ Consultation not found!");
      process.exit(1);
    }

    console.log("✅ Consultation found");
    console.log(`   Current messages: ${consultation.messages.length}`);

    // Try to add a message
    console.log("\n📝 Adding test message...");
    const testMessage = {
      sender: SHUBHAM_ID,
      senderName: "Shubham Choudhary",
      senderAvatar: null,
      message: "Test message added directly to database",
      timestamp: new Date(),
      type: "text",
      status: "delivered",
      readBy: [],
    };

    consultation.messages.push(testMessage);
    consultation.lastMessageAt = new Date();

    console.log("💾 Saving consultation...");
    await consultation.save();

    console.log("✅ Message added successfully!");
    console.log(`   Total messages now: ${consultation.messages.length}`);
    console.log(
      `   Last message: ${
        consultation.messages[consultation.messages.length - 1].message
      }`
    );

    await mongoose.disconnect();
    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

testAddMessage();
