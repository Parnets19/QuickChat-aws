const mongoose = require("mongoose");

async function debugDateIssue() {
  try {
    console.log("🔍 DEBUGGING DATE FILTERING ISSUE");
    console.log("==================================");

    // Connect to MongoDB Atlas
    const mongoUri =
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB Atlas");

    const User = mongoose.connection.collection("users");
    const Consultation = mongoose.connection.collection("consultations");

    // Find Nandu and Sai
    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });
    const sai = await User.findOne({ email: "saipavithra@gmail.com" });

    console.log(`\n👤 Users:`);
    console.log(`   Nandu ID: ${nandu._id}`);
    console.log(`   Sai ID: ${sai._id}`);

    // Check current date and time
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(`\n📅 DATE INFO:`);
    console.log(`   Current time: ${now.toISOString()}`);
    console.log(`   Today start: ${today.toISOString()}`);
    console.log(`   Local time: ${now.toLocaleString()}`);
    console.log(`   Local today: ${today.toLocaleString()}`);

    // Get ALL consultations between Nandu and Sai (no date filter)
    const allConsultations = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
    })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(
      `\n📋 ALL CONSULTATIONS BETWEEN NANDU & SAI: ${allConsultations.length}`
    );

    allConsultations.forEach((consultation, index) => {
      const createdAt = new Date(consultation.createdAt);
      const isToday = createdAt >= today;

      console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
      console.log(`      Created: ${createdAt.toISOString()}`);
      console.log(`      Local: ${createdAt.toLocaleString()}`);
      console.log(`      Is today? ${isToday}`);
      console.log(`      Rate: ₹${consultation.rate}/min`);
      console.log(`      Total Amount: ₹${consultation.totalAmount || 0}`);
      console.log(
        `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
      );
    });

    // Try different date filters
    console.log(`\n🔍 TESTING DIFFERENT DATE FILTERS:`);

    // Filter 1: Today (UTC)
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const todayConsultationsUTC = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
      createdAt: { $gte: todayUTC },
    }).toArray();

    console.log(
      `   Today UTC (${todayUTC.toISOString()}): ${
        todayConsultationsUTC.length
      } consultations`
    );

    // Filter 2: Last 24 hours
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const last24HoursConsultations = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
      createdAt: { $gte: last24Hours },
    }).toArray();

    console.log(
      `   Last 24 hours (${last24Hours.toISOString()}): ${
        last24HoursConsultations.length
      } consultations`
    );

    // Filter 3: January 6, 2026 specifically
    const jan6Start = new Date("2026-01-06T00:00:00.000Z");
    const jan6End = new Date("2026-01-07T00:00:00.000Z");

    const jan6Consultations = await Consultation.find({
      user: nandu._id,
      provider: sai._id,
      createdAt: {
        $gte: jan6Start,
        $lt: jan6End,
      },
    }).toArray();

    console.log(
      `   Jan 6, 2026 (${jan6Start.toISOString()} to ${jan6End.toISOString()}): ${
        jan6Consultations.length
      } consultations`
    );

    // Show the most recent consultations with detailed timestamps
    if (allConsultations.length > 0) {
      console.log(`\n📋 MOST RECENT CONSULTATIONS (with timezone info):`);

      allConsultations.slice(0, 5).forEach((consultation, index) => {
        const createdAt = new Date(consultation.createdAt);

        console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
        console.log(`      Created (ISO): ${createdAt.toISOString()}`);
        console.log(`      Created (Local): ${createdAt.toLocaleString()}`);
        console.log(`      Created (UTC): ${createdAt.toUTCString()}`);
        console.log(`      Timestamp: ${createdAt.getTime()}`);
        console.log(`      Rate: ₹${consultation.rate}/min`);
        console.log(`      Total Amount: ₹${consultation.totalAmount || 0}`);
        console.log(
          `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
        );
      });
    }
  } catch (error) {
    console.error("❌ Debug failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run debug
debugDateIssue();
