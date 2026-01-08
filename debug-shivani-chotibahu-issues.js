/**
 * DEBUG SHIVANI AND CHOTIBAHU CALL ISSUES
 *
 * Issues to investigate:
 * 1. Free minute not working - charged ₹0.05 instead of free
 * 2. Call rejection modal not working - status showing completed
 * 3. Provider rejection not cutting call - both sides showing completed
 */

const mongoose = require("mongoose");
require("dotenv").config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

// User schema
const userSchema = new mongoose.Schema(
  {
    name: String,
    fullName: String,
    email: String,
    wallet: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    freeMinutesUsed: { type: Number, default: 0 },
    freeMinutesAvailable: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

// Consultation schema
const consultationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: String,
    totalAmount: Number,
    duration: Number,
    startTime: Date,
    endTime: Date,
    freeMinuteUsed: { type: Boolean, default: false },
    consultationType: String,
  },
  { timestamps: true }
);

const Consultation = mongoose.model("Consultation", consultationSchema);

// Transaction schema
const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: String,
    amount: Number,
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
    },
    description: String,
  },
  { timestamps: true }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

async function debugShivaniChotibahu() {
  await connectDB();

  console.log("🔍 DEBUGGING SHIVANI AND CHOTIBAHU ISSUES");
  console.log("=".repeat(60));

  // Find the users
  const shivaniUser = await User.findOne({ email: "shivani@gmail.com" });
  const chotibahu = await User.findOne({ email: "chotibahu123@gmail.com" });

  if (!shivaniUser || !chotibahu) {
    console.log("❌ Could not find users");
    console.log("Shivani found:", !!shivaniUser);
    console.log("Chotibahu found:", !!chotibahu);

    // Search for similar emails
    console.log("\n🔍 Searching for similar emails...");
    const allUsers = await User.find({
      $or: [
        { email: { $regex: "shivani", $options: "i" } },
        { email: { $regex: "chotibahu", $options: "i" } },
      ],
    });

    console.log("Found users with similar emails:");
    allUsers.forEach((user) => {
      console.log(`  - ${user.fullName || user.name} (${user.email})`);
    });

    mongoose.connection.close();
    return;
  }

  console.log("👤 Found users:");
  console.log(
    `   Shivani: ${shivaniUser.fullName || shivaniUser.name} (${
      shivaniUser._id
    })`
  );
  console.log(
    `   Chotibahu: ${chotibahu.fullName || chotibahu.name} (${chotibahu._id})`
  );

  // Check user details
  console.log("\n💰 USER WALLET STATUS:");
  console.log("─".repeat(40));
  console.log(`Shivani:`);
  console.log(`  Wallet: ₹${shivaniUser.wallet}`);
  console.log(`  Total Spent: ₹${shivaniUser.totalSpent}`);
  console.log(`  Earnings: ₹${shivaniUser.earnings}`);
  console.log(`  Free Minutes Used: ${shivaniUser.freeMinutesUsed || 0}`);
  console.log(
    `  Free Minutes Available: ${shivaniUser.freeMinutesAvailable || 1}`
  );

  console.log(`\nChotibahu:`);
  console.log(`  Wallet: ₹${chotibahu.wallet}`);
  console.log(`  Total Spent: ₹${chotibahu.totalSpent}`);
  console.log(`  Earnings: ₹${chotibahu.earnings}`);
  console.log(`  Free Minutes Used: ${chotibahu.freeMinutesUsed || 0}`);
  console.log(
    `  Free Minutes Available: ${chotibahu.freeMinutesAvailable || 1}`
  );

  // Find consultations between them
  console.log("\n📞 RECENT CONSULTATIONS:");
  console.log("─".repeat(40));

  const consultations = await Consultation.find({
    $or: [
      { user: shivaniUser._id, provider: chotibahu._id },
      { user: chotibahu._id, provider: shivaniUser._id },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(5);

  if (consultations.length === 0) {
    console.log("No consultations found between these users");
  } else {
    console.log(`Found ${consultations.length} recent consultations:`);

    for (let i = 0; i < consultations.length; i++) {
      const consultation = consultations[i];
      const isShivaniClient =
        consultation.user.toString() === shivaniUser._id.toString();

      console.log(`\n${i + 1}. Consultation ${consultation._id}:`);
      console.log(`   Client: ${isShivaniClient ? "Shivani" : "Chotibahu"}`);
      console.log(`   Provider: ${isShivaniClient ? "Chotibahu" : "Shivani"}`);
      console.log(`   Status: ${consultation.status}`);
      console.log(`   Duration: ${consultation.duration || 0} minutes`);
      console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);
      console.log(
        `   Free Minute Used: ${consultation.freeMinuteUsed || false}`
      );
      console.log(`   Start Time: ${consultation.startTime || "Not set"}`);
      console.log(`   End Time: ${consultation.endTime || "Not set"}`);
      console.log(`   Created: ${consultation.createdAt}`);
    }
  }

  // Find transactions
  console.log("\n💳 RECENT TRANSACTIONS:");
  console.log("─".repeat(40));

  const shivaniTransactions = await Transaction.find({
    user: shivaniUser._id,
  })
    .sort({ createdAt: -1 })
    .limit(5);

  const chotibahu123Transactions = await Transaction.find({
    user: chotibahu._id,
  })
    .sort({ createdAt: -1 })
    .limit(5);

  console.log(
    `\nShivani's recent transactions (${shivaniTransactions.length}):`
  );
  shivaniTransactions.forEach((tx, i) => {
    console.log(
      `  ${i + 1}. ${tx.type}: ₹${tx.amount} - ${
        tx.description || "No description"
      }`
    );
    console.log(`     Consultation: ${tx.consultationId || "None"}`);
    console.log(`     Date: ${tx.createdAt}`);
  });

  console.log(
    `\nChotibahu's recent transactions (${chotibahu123Transactions.length}):`
  );
  chotibahu123Transactions.forEach((tx, i) => {
    console.log(
      `  ${i + 1}. ${tx.type}: ₹${tx.amount} - ${
        tx.description || "No description"
      }`
    );
    console.log(`     Consultation: ${tx.consultationId || "None"}`);
    console.log(`     Date: ${tx.createdAt}`);
  });

  // Analyze the issues
  console.log("\n🚨 ISSUE ANALYSIS:");
  console.log("─".repeat(30));

  // Issue 1: Free minute not working
  console.log("1. FREE MINUTE ISSUE:");
  const hasUsedFreeMinute =
    shivaniUser.freeMinutesUsed > 0 || chotibahu.freeMinutesUsed > 0;
  const freeMinuteConsultation = consultations.find(
    (c) => c.freeMinuteUsed === true
  );

  if (hasUsedFreeMinute) {
    console.log("   ❌ Free minute already used by one of the users");
  } else if (freeMinuteConsultation) {
    console.log(
      "   ❌ Free minute marked as used in consultation but not in user profile"
    );
  } else {
    console.log("   ⚠️ Free minute should be available but was charged ₹0.05");
  }

  // Issue 2: Call rejection status
  console.log("\n2. CALL REJECTION STATUS:");
  const completedConsultations = consultations.filter(
    (c) => c.status === "completed"
  );
  if (completedConsultations.length > 0) {
    console.log(
      `   ❌ Found ${completedConsultations.length} consultations with 'completed' status`
    );
    console.log("   ⚠️ Should be 'rejected' or 'cancelled' for rejected calls");
  }

  // Issue 3: Provider rejection not cutting call
  console.log("\n3. PROVIDER REJECTION ISSUE:");
  console.log(
    "   ⚠️ Both sides showing completed instead of proper rejection handling"
  );

  console.log("\n🔧 RECOMMENDED FIXES:");
  console.log("─".repeat(30));
  console.log("1. Fix free minute logic in billing controller");
  console.log("2. Fix call rejection status handling");
  console.log("3. Fix provider rejection to properly terminate call");
  console.log(
    "4. Update consultation status to 'rejected' instead of 'completed'"
  );

  mongoose.connection.close();
  console.log("\n✅ Database connection closed");
}

debugShivaniChotibahu().catch(console.error);
