const mongoose = require("mongoose");

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/quickchat", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define schemas (simplified)
const consultationSchema = new mongoose.Schema({}, { strict: false });
const userSchema = new mongoose.Schema({}, { strict: false });

const Consultation = mongoose.model("Consultation", consultationSchema);
const User = mongoose.model("User", userSchema);

async function debugDatabase() {
  try {
    console.log("🔍 DEBUGGING DATABASE DIRECTLY");
    console.log("===============================");

    // Find Nandu Bhide
    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });
    if (!nandu) {
      console.log("❌ Nandu not found");
      return;
    }

    console.log("👤 NANDU BHIDE:");
    console.log(`   ID: ${nandu._id}`);
    console.log(`   Wallet: ₹${nandu.wallet}`);
    console.log(`   Total Spent: ₹${nandu.totalSpent}`);
    console.log(`   Free Minutes Used: ${nandu.freeMinutesUsed?.length || 0}`);

    // Show free minutes used
    if (nandu.freeMinutesUsed && nandu.freeMinutesUsed.length > 0) {
      console.log("\n🆓 FREE MINUTES USED:");
      nandu.freeMinutesUsed.forEach((fm, index) => {
        console.log(`   ${index + 1}. Provider: ${fm.providerId}`);
        console.log(`      Used at: ${new Date(fm.usedAt).toLocaleString()}`);
        console.log(`      Consultation: ${fm.consultationId}`);
      });
    }

    // Find Sai Pavithra
    const sai = await User.findOne({ email: "saipavithra@gmail.com" });
    if (!sai) {
      console.log("❌ Sai not found");
      return;
    }

    console.log(`\n👤 SAI PAVITHRA:`);
    console.log(`   ID: ${sai._id}`);
    console.log(`   Wallet: ₹${sai.wallet}`);
    console.log(`   Total Earnings: ₹${sai.totalEarnings || 0}`);

    // Find recent consultations for Nandu
    const consultations = await Consultation.find({ user: nandu._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("provider", "fullName");

    console.log(`\n📋 NANDU'S RECENT CONSULTATIONS (${consultations.length}):`);

    consultations.forEach((consultation, index) => {
      console.log(`\n${index + 1}. ID: ${consultation._id}`);
      console.log(
        `   Provider: ${consultation.provider?.fullName || "Unknown"}`
      );
      console.log(
        `   Provider ID: ${consultation.provider?._id || consultation.provider}`
      );
      console.log(`   Type: ${consultation.type}`);
      console.log(`   Status: ${consultation.status}`);
      console.log(`   Rate: ₹${consultation.rate}/min`);
      console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);
      console.log(`   Duration: ${consultation.duration || 0} minutes`);
      console.log(`   Is First Minute Free: ${consultation.isFirstMinuteFree}`);
      console.log(`   Free Minute Used: ${consultation.freeMinuteUsed}`);
      console.log(
        `   Created: ${new Date(consultation.createdAt).toLocaleString()}`
      );
      console.log(
        `   Started: ${
          consultation.startTime
            ? new Date(consultation.startTime).toLocaleString()
            : "Not started"
        }`
      );
      console.log(
        `   Ended: ${
          consultation.endTime
            ? new Date(consultation.endTime).toLocaleString()
            : "Not ended"
        }`
      );
    });

    // Check specifically for consultations with Sai Pavithra
    const saiConsultations = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
    }).sort({ createdAt: -1 });

    console.log(`\n🔍 CONSULTATIONS WITH SAI PAVITHRA:`);
    console.log(`   Found: ${saiConsultations.length} consultations`);

    saiConsultations.forEach((consultation, index) => {
      console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
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
  } catch (error) {
    console.error("❌ Database debug failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run debug
debugDatabase();
