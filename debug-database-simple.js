const mongoose = require("mongoose");

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/quickchat");

async function debugDatabase() {
  try {
    console.log("🔍 DEBUGGING DATABASE CONNECTION");
    console.log("================================");

    // List all collections
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    console.log("📋 Available collections:");
    collections.forEach((col) => {
      console.log(`   - ${col.name}`);
    });

    // Try to find users
    const User = mongoose.connection.collection("users");
    const userCount = await User.countDocuments();
    console.log(`\n👥 Total users: ${userCount}`);

    // Find users with specific emails
    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });
    const sai = await User.findOne({ email: "saipavithra@gmail.com" });

    console.log(`\n🔍 User search results:`);
    console.log(`   Nandu found: ${!!nandu}`);
    console.log(`   Sai found: ${!!sai}`);

    if (nandu) {
      console.log(`\n👤 NANDU BHIDE:`);
      console.log(`   ID: ${nandu._id}`);
      console.log(`   Email: ${nandu.email}`);
      console.log(`   Wallet: ₹${nandu.wallet}`);
      console.log(`   Total Spent: ₹${nandu.totalSpent}`);
      console.log(
        `   Free Minutes Used: ${nandu.freeMinutesUsed?.length || 0}`
      );
    }

    if (sai) {
      console.log(`\n👤 SAI PAVITHRA:`);
      console.log(`   ID: ${sai._id}`);
      console.log(`   Email: ${sai.email}`);
      console.log(`   Wallet: ₹${sai.wallet}`);
      console.log(`   Total Earnings: ₹${sai.totalEarnings || 0}`);
    }

    // Check consultations
    const Consultation = mongoose.connection.collection("consultations");
    const consultationCount = await Consultation.countDocuments();
    console.log(`\n📋 Total consultations: ${consultationCount}`);

    if (nandu) {
      const nanduConsultations = await Consultation.find({ user: nandu._id })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      console.log(
        `\n📋 Nandu's recent consultations: ${nanduConsultations.length}`
      );

      nanduConsultations.forEach((consultation, index) => {
        console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
        console.log(`      Provider: ${consultation.provider}`);
        console.log(`      Type: ${consultation.type}`);
        console.log(`      Status: ${consultation.status}`);
        console.log(`      Rate: ₹${consultation.rate}/min`);
        console.log(`      Total Amount: ₹${consultation.totalAmount || 0}`);
        console.log(
          `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
        );
        console.log(
          `      Created: ${new Date(consultation.createdAt).toLocaleString()}`
        );
      });
    }
  } catch (error) {
    console.error("❌ Database debug failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run debug
debugDatabase();
