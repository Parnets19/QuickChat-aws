const mongoose = require("mongoose");

async function debugMissingConsultations() {
  try {
    console.log("🔍 DEBUGGING MISSING CONSULTATIONS");
    console.log("===================================");

    // Connect to MongoDB Atlas
    const mongoUri =
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB Atlas");

    const User = mongoose.connection.collection("users");
    const Consultation = mongoose.connection.collection("consultations");
    const Transaction = mongoose.connection.collection("transactions");

    // Find Nandu and Sai
    const nandu = await User.findOne({ email: "nandubhide@gmail.com" });
    const sai = await User.findOne({ email: "saipavithra@gmail.com" });

    console.log(`\n👤 Users:`);
    console.log(`   Nandu ID: ${nandu._id}`);
    console.log(`   Sai ID: ${sai._id}`);
    console.log(`   Nandu wallet: ₹${nandu.wallet}`);
    console.log(`   Sai wallet: ₹${sai.wallet}`);

    // Check if the consultation IDs from the earlier debug still exist
    const consultationIds = [
      "695cdb27831bb3e548ef6b9d",
      "695cdaf6831bb3e548ef608b",
      "695cd4b7831bb3e548ef04bb",
      "695cd046831bb3e548eec5ec",
      "695cbe18a91629237c859f58",
      "695cbd8d8f202a2ef4d7ed20",
      "695cb9be2d5c7d105e4fda98",
      "695cb7272d5c7d105e4fb007",
      "695cb5643a560ac3a8d115d0",
    ];

    console.log(`\n🔍 CHECKING SPECIFIC CONSULTATION IDs:`);

    for (const id of consultationIds) {
      try {
        const consultation = await Consultation.findOne({
          _id: new mongoose.Types.ObjectId(id),
        });
        if (consultation) {
          console.log(`   ✅ ${id}: EXISTS`);
          console.log(`      User: ${consultation.user}`);
          console.log(`      Provider: ${consultation.provider}`);
          console.log(`      Status: ${consultation.status}`);
          console.log(`      Amount: ₹${consultation.totalAmount || 0}`);
        } else {
          console.log(`   ❌ ${id}: NOT FOUND`);
        }
      } catch (error) {
        console.log(`   ❌ ${id}: ERROR - ${error.message}`);
      }
    }

    // Check recent transactions to see if there's evidence of the consultations
    console.log(`\n💰 RECENT TRANSACTIONS FOR NANDU & SAI:`);

    const recentTransactions = await Transaction.find({
      $or: [{ user: nandu._id }, { user: sai._id }],
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .toArray();

    recentTransactions.forEach((transaction, index) => {
      const isNandu = transaction.user.toString() === nandu._id.toString();
      const isSai = transaction.user.toString() === sai._id.toString();

      console.log(
        `\n   ${index + 1}. ${isNandu ? "NANDU" : isSai ? "SAI" : "OTHER"} - ${
          transaction._id
        }`
      );
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

    // Check if any consultations exist with those transaction consultation IDs
    console.log(`\n🔍 CHECKING CONSULTATIONS FROM TRANSACTION IDs:`);

    const transactionConsultationIds = recentTransactions
      .filter((t) => t.consultationId)
      .map((t) => t.consultationId);

    for (const id of transactionConsultationIds) {
      try {
        const consultation = await Consultation.findOne({
          _id: new mongoose.Types.ObjectId(id),
        });
        if (consultation) {
          const isNanduSai =
            consultation.user.toString() === nandu._id.toString() &&
            consultation.provider.toString() === sai._id.toString();
          console.log(
            `   ${isNanduSai ? "✅" : "⚠️"} ${id}: ${
              isNanduSai ? "NANDU->SAI" : "OTHER"
            }`
          );
          console.log(`      User: ${consultation.user}`);
          console.log(`      Provider: ${consultation.provider}`);
          console.log(`      Status: ${consultation.status}`);
          console.log(`      Amount: ₹${consultation.totalAmount || 0}`);
          console.log(
            `      Created: ${new Date(
              consultation.createdAt
            ).toLocaleString()}`
          );
        } else {
          console.log(`   ❌ ${id}: CONSULTATION NOT FOUND`);
        }
      } catch (error) {
        console.log(`   ❌ ${id}: ERROR - ${error.message}`);
      }
    }

    // Check all consultations with Sai as provider (regardless of user)
    console.log(`\n📋 ALL CONSULTATIONS WITH SAI AS PROVIDER:`);

    const saiProviderConsultations = await Consultation.find({
      provider: sai._id,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    saiProviderConsultations.forEach((consultation, index) => {
      const isFromNandu = consultation.user.toString() === nandu._id.toString();

      console.log(
        `\n   ${index + 1}. ${isFromNandu ? "FROM NANDU" : "FROM OTHER"} - ${
          consultation._id
        }`
      );
      console.log(`      User: ${consultation.user}`);
      console.log(`      Status: ${consultation.status}`);
      console.log(`      Rate: ₹${consultation.rate}/min`);
      console.log(`      Amount: ₹${consultation.totalAmount || 0}`);
      console.log(
        `      Is First Minute Free: ${consultation.isFirstMinuteFree}`
      );
      console.log(
        `      Created: ${new Date(consultation.createdAt).toLocaleString()}`
      );
    });

    // Summary
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Nandu's current wallet: ₹${nandu.wallet} (negative!)`);
    console.log(`   Sai's current wallet: ₹${sai.wallet} (has earnings)`);
    console.log(`   Direct consultations Nandu->Sai: 0 found`);
    console.log(`   Recent transactions: ${recentTransactions.length} found`);
    console.log(
      `   Consultations with Sai as provider: ${saiProviderConsultations.length} found`
    );

    const nanduToSaiConsultations = saiProviderConsultations.filter(
      (c) => c.user.toString() === nandu._id.toString()
    );
    console.log(
      `   Consultations from Nandu to Sai: ${nanduToSaiConsultations.length} found`
    );

    if (nanduToSaiConsultations.length > 0) {
      console.log(
        `\n🚨 FOUND CONSULTATIONS! They exist but the query was wrong.`
      );

      // Calculate total charged
      const totalCharged = nanduToSaiConsultations.reduce(
        (sum, c) => sum + (c.totalAmount || 0),
        0
      );
      console.log(`   Total amount charged: ₹${totalCharged}`);

      // Check how many were marked as first minute free
      const firstMinuteFreeCount = nanduToSaiConsultations.filter(
        (c) => c.isFirstMinuteFree
      ).length;
      console.log(
        `   Marked as first minute free: ${firstMinuteFreeCount} out of ${nanduToSaiConsultations.length}`
      );

      if (firstMinuteFreeCount > 1) {
        console.log(
          `   🚨 BUG CONFIRMED: Multiple consultations marked as first minute free!`
        );
      }
    }
  } catch (error) {
    console.error("❌ Debug failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Run debug
debugMissingConsultations();
