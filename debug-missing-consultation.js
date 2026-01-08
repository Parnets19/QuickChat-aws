const mongoose = require("mongoose");

async function debugMissingConsultation() {
  try {
    console.log("🔍 DEBUGGING MISSING CONSULTATION");
    console.log("=================================");

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

    // Check for ANY consultations involving Sai as provider (regardless of user)
    const allSaiConsultations = await Consultation.find({
      provider: sai._id,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    console.log(
      `\n📋 ALL CONSULTATIONS WITH SAI AS PROVIDER: ${allSaiConsultations.length}`
    );

    allSaiConsultations.forEach((consultation, index) => {
      console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
      console.log(`      User: ${consultation.user}`);
      console.log(
        `      Is Nandu? ${
          consultation.user.toString() === nandu._id.toString()
        }`
      );
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

    // Check for consultations created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayConsultations = await Consultation.find({
      createdAt: { $gte: today },
    })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(
      `\n📅 CONSULTATIONS CREATED TODAY: ${todayConsultations.length}`
    );

    todayConsultations.forEach((consultation, index) => {
      console.log(`\n   ${index + 1}. ID: ${consultation._id}`);
      console.log(`      User: ${consultation.user}`);
      console.log(`      Provider: ${consultation.provider}`);
      console.log(
        `      Is Nandu->Sai? ${
          consultation.user.toString() === nandu._id.toString() &&
          consultation.provider.toString() === sai._id.toString()
        }`
      );
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

    // Check transactions to see what happened
    const Transaction = mongoose.connection.collection("transactions");
    const recentTransactions = await Transaction.find({
      $or: [{ user: nandu._id }, { user: sai._id }],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    console.log(`\n💰 RECENT TRANSACTIONS: ${recentTransactions.length}`);

    recentTransactions.forEach((transaction, index) => {
      console.log(`\n   ${index + 1}. ID: ${transaction._id}`);
      console.log(`      User: ${transaction.user}`);
      console.log(`      Type: ${transaction.type}`);
      console.log(`      Amount: ₹${transaction.amount}`);
      console.log(`      Balance: ₹${transaction.balance}`);
      console.log(`      Description: ${transaction.description}`);
      console.log(
        `      Consultation ID: ${transaction.consultationId || "None"}`
      );
      console.log(
        `      Created: ${new Date(transaction.createdAt).toLocaleString()}`
      );
    });

    // Look for any consultation that might have been created through real-time billing
    const possibleConsultation = await Consultation.findOne({
      user: nandu._id,
      provider: sai._id,
    });

    if (possibleConsultation) {
      console.log(`\n🚨 FOUND HIDDEN CONSULTATION:`);
      console.log(`   ID: ${possibleConsultation._id}`);
      console.log(`   Status: ${possibleConsultation.status}`);
      console.log(`   Rate: ₹${possibleConsultation.rate}/min`);
      console.log(`   Total Amount: ₹${possibleConsultation.totalAmount || 0}`);
      console.log(
        `   Is First Minute Free: ${possibleConsultation.isFirstMinuteFree}`
      );
      console.log(
        `   Free Minute Used: ${possibleConsultation.freeMinuteUsed}`
      );
      console.log(
        `   Created: ${new Date(
          possibleConsultation.createdAt
        ).toLocaleString()}`
      );
    } else {
      console.log(`\n❓ NO CONSULTATION FOUND BETWEEN NANDU & SAI`);
      console.log(
        `   This suggests the consultation was created through real-time billing`
      );
      console.log(`   But may have been deleted or not properly saved`);
    }
  } catch (error) {
    console.error("❌ Debug failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run debug
debugMissingConsultation();
