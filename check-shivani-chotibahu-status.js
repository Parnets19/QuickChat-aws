/**
 * Check Shivani and Chotibahu status for free minute issue
 */

const mongoose = require("mongoose");
require("dotenv").config();

// Import models
const { User, Guest, Consultation, Transaction } = require("./src/models");

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find the users
    const shivani = await User.findOne({ email: "shivani@gmail.com" });
    const chotibahu = await User.findOne({ email: "chotibahu123@gmail.com" });

    if (!shivani || !chotibahu) {
      console.log("❌ Users not found");
      console.log("Shivani found:", !!shivani);
      console.log("Chotibahu found:", !!chotibahu);
      return;
    }

    console.log("👤 USERS FOUND:");
    console.log(`Shivani: ${shivani.fullName} (${shivani._id})`);
    console.log(`Chotibahu: ${chotibahu.fullName} (${chotibahu._id})`);

    console.log("\n🆓 FREE MINUTE STATUS:");
    console.log("Shivani's freeMinutesUsed:", shivani.freeMinutesUsed || []);
    console.log(
      "Chotibahu's freeMinutesUsed:",
      chotibahu.freeMinutesUsed || []
    );

    // Check if Shivani has used free minute with Chotibahu
    const shivaniUsedFreeWithChotibahu = shivani.freeMinutesUsed?.some(
      (entry) => entry.providerId.toString() === chotibahu._id.toString()
    );

    console.log(
      `\nShivani used free minute with Chotibahu: ${shivaniUsedFreeWithChotibahu}`
    );

    // Find recent consultations
    const consultations = await Consultation.find({
      $or: [
        { user: shivani._id, provider: chotibahu._id },
        { user: chotibahu._id, provider: shivani._id },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(5);

    console.log(`\n📞 RECENT CONSULTATIONS (${consultations.length}):`);
    consultations.forEach((c, i) => {
      const isShivaniClient = c.user.toString() === shivani._id.toString();
      console.log(`${i + 1}. ${c._id}`);
      console.log(`   Client: ${isShivaniClient ? "Shivani" : "Chotibahu"}`);
      console.log(`   Provider: ${isShivaniClient ? "Chotibahu" : "Shivani"}`);
      console.log(`   Status: ${c.status}`);
      console.log(`   Amount: ₹${c.totalAmount || 0}`);
      console.log(`   Duration: ${c.duration || 0} min`);
      console.log(`   Free minute: ${c.isFirstMinuteFree || false}`);
      console.log(`   Created: ${c.createdAt}`);
    });

    // Find recent transactions
    const shivaniTransactions = await Transaction.find({ user: shivani._id })
      .sort({ createdAt: -1 })
      .limit(3);

    console.log(
      `\n💳 SHIVANI'S RECENT TRANSACTIONS (${shivaniTransactions.length}):`
    );
    shivaniTransactions.forEach((tx, i) => {
      console.log(
        `${i + 1}. ${tx.type}: ₹${tx.amount} - ${
          tx.description || "No description"
        }`
      );
      console.log(`   Date: ${tx.createdAt}`);
    });

    mongoose.connection.close();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error:", error);
    mongoose.connection.close();
  }
}

checkUsers();
