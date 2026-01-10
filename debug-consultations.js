const mongoose = require("mongoose");

async function debugConsultations() {
  try {
    console.log("🔍 Debug Consultations Collection");
    console.log("==================================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // Check consultations collection
    const consultations = await db
      .collection("consultations")
      .find({})
      .toArray();
    console.log(`\n📋 Consultations: ${consultations.length} documents`);

    if (consultations.length > 0) {
      console.log("📋 All consultations:");
      consultations.forEach((consultation, index) => {
        console.log(`\n📋 Consultation ${index + 1}:`);
        console.log(`   ID: ${consultation._id}`);
        console.log(`   Type: ${consultation.type}`);
        console.log(`   Status: ${consultation.status}`);
        console.log(`   Provider: ${consultation.providerId}`);
        console.log(`   Client: ${consultation.clientId}`);
        console.log(`   Created: ${consultation.createdAt}`);
        if (consultation.messages && consultation.messages.length > 0) {
          console.log(`   Messages: ${consultation.messages.length}`);
          console.log(
            `   Latest message: ${
              consultation.messages[consultation.messages.length - 1].message
            }`
          );
        } else {
          console.log(`   Messages: 0`);
        }
      });

      // Look for the specific chat ID we saw
      const targetChatId = "69622dfa88b3545378c86237";
      const targetConsultation = consultations.find(
        (c) => c._id.toString() === targetChatId
      );

      if (targetConsultation) {
        console.log(`\n🎯 Found target consultation ${targetChatId}:`);
        console.log(JSON.stringify(targetConsultation, null, 2));
      } else {
        console.log(
          `\n❌ Target consultation ${targetChatId} not found in consultations`
        );
      }
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

debugConsultations();
