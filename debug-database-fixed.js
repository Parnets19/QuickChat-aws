const mongoose = require("mongoose");

async function debugDatabase() {
  try {
    console.log("🔍 DEBUGGING DATABASE CONNECTION");
    console.log("================================");

    // Connect to MongoDB
    await mongoose.connect("mongodb://localhost:27017/quickchat");
    console.log("✅ Connected to MongoDB");

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

      // Show free minutes used
      if (nandu.freeMinutesUsed && nandu.freeMinutesUsed.length > 0) {
        console.log("\n🆓 FREE MINUTES USED:");
        nandu.freeMinutesUsed.forEach((fm, index) => {
          console.log(`   ${index + 1}. Provider: ${fm.providerId}`);
          console.log(`      Used at: ${new Date(fm.usedAt).toLocaleString()}`);
          console.log(`      Consultation: ${fm.consultationId}`);
        });
      }
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

    if (nandu && sai) {
      // Find consultations between Nandu and Sai
      const saiConsultations = await Consultation.find({
        user: nandu._id,
        provider: sai._id,
      })
        .sort({ createdAt: -1 })
        .toArray();

      console.log(
        `\n🔍 CONSULTATIONS BETWEEN NANDU & SAI: ${saiConsultations.length}`
      );

      saiConsultations.forEach((consultation, index) => {
        console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
        console.log(`      Type: ${consultation.type}`);
        console.log(`      Status: ${consultation.status}`);
        console.log(`      Rate: ₹${consultation.rate}/min`);
        console.log(`      Total Amount: ₹${consultation.totalAmount || 0}`);
        console.log(
          `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
        );
        console.log(`      Free Minute Used: ${consultation.freeMinuteUsed}`);
        console.log(
          `      Created: ${new Date(consultation.createdAt).toLocaleString()}`
        );
        console.log(
          `      Started: ${
            consultation.startTime
              ? new Date(consultation.startTime).toLocaleString()
              : "Not started"
          }`
        );
        console.log(
          `      Ended: ${
            consultation.endTime
              ? new Date(consultation.endTime).toLocaleString()
              : "Not ended"
          }`
        );
      });

      // Check if Nandu has used free minute with Sai
      const hasUsedWithSai = nandu.freeMinutesUsed?.some(
        (fm) => fm.providerId.toString() === sai._id.toString()
      );

      console.log(`\n📊 ANALYSIS:`);
      console.log(`   Nandu ID: ${nandu._id}`);
      console.log(`   Sai ID: ${sai._id}`);
      console.log(`   Has used free minute with Sai: ${hasUsedWithSai}`);
      console.log(`   Should be free call: ${!hasUsedWithSai}`);
      console.log(`   Nandu's wallet: ₹${nandu.wallet}`);
      console.log(`   Sai's wallet: ₹${sai.wallet}`);

      // If there are consultations with Sai, analyze the most recent one
      if (saiConsultations.length > 0) {
        const mostRecent = saiConsultations[0];
        console.log(`\n🚨 MOST RECENT CONSULTATION WITH SAI:`);
        console.log(`   Should have been free: ${!hasUsedWithSai}`);
        console.log(
          `   Was marked as first minute free: ${mostRecent.isFirstMinuteFree}`
        );
        console.log(`   Was actually charged: ₹${mostRecent.totalAmount || 0}`);

        if (!hasUsedWithSai && mostRecent.totalAmount > 0) {
          console.log(`\n🚨 BUG CONFIRMED:`);
          console.log(
            `   - This should have been Nandu's FIRST free call with Sai`
          );
          console.log(`   - But he was charged ₹${mostRecent.totalAmount}`);
          console.log(`   - This is why his wallet went negative`);
          console.log(`   - The free minute system failed`);
        }
      }
    }

    // Show recent consultations for Nandu
    if (nandu) {
      const nanduConsultations = await Consultation.find({ user: nandu._id })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      console.log(
        `\n📋 NANDU'S RECENT CONSULTATIONS: ${nanduConsultations.length}`
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
