/**
 * RESET NANDU AND SAI FOR FRESH TESTING
 *
 * This script will:
 * 1. Delete all consultations between Nandu and Sai
 * 2. Delete all transactions for both users
 * 3. Reset wallet balances to ₹10 each
 * 4. Reset totalSpent and earnings to 0
 * 5. Prepare for fresh testing
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
  },
  { timestamps: true }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

async function resetUsersForTesting() {
  await connectDB();

  console.log("🧹 RESETTING NANDU AND SAI FOR FRESH TESTING");
  console.log("=".repeat(60));

  // Find Nandu and Sai
  const nanduUser = await User.findOne({ email: "nandubhide@gmail.com" });
  const saiUser = await User.findOne({ email: "saipavithra@gmail.com" });

  if (!nanduUser || !saiUser) {
    console.log("❌ Could not find Nandu or Sai users");
    console.log("Nandu found:", !!nanduUser);
    console.log("Sai found:", !!saiUser);
    process.exit(1);
  }

  console.log("👤 Found users:");
  console.log(`   Nandu: ${nanduUser.fullName} (${nanduUser._id})`);
  console.log(`   Sai: ${saiUser.fullName} (${saiUser._id})`);

  // Step 1: Delete all consultations between them
  console.log("\n🗑️ STEP 1: Deleting consultations...");

  const consultationsToDelete = await Consultation.find({
    $or: [
      { user: nanduUser._id, provider: saiUser._id },
      { user: saiUser._id, provider: nanduUser._id },
    ],
  });

  console.log(
    `   Found ${consultationsToDelete.length} consultations to delete`
  );

  if (consultationsToDelete.length > 0) {
    const consultationIds = consultationsToDelete.map((c) => c._id);

    // Delete consultations
    const deletedConsultations = await Consultation.deleteMany({
      _id: { $in: consultationIds },
    });

    console.log(
      `   ✅ Deleted ${deletedConsultations.deletedCount} consultations`
    );

    // Step 2: Delete related transactions
    console.log("\n🗑️ STEP 2: Deleting related transactions...");

    const deletedTransactions = await Transaction.deleteMany({
      consultationId: { $in: consultationIds },
    });

    console.log(
      `   ✅ Deleted ${deletedTransactions.deletedCount} consultation transactions`
    );
  }

  // Step 3: Delete all other transactions for both users
  console.log("\n🗑️ STEP 3: Deleting all user transactions...");

  const nanduTransactions = await Transaction.deleteMany({
    user: nanduUser._id,
  });

  const saiTransactions = await Transaction.deleteMany({
    user: saiUser._id,
  });

  console.log(
    `   ✅ Deleted ${nanduTransactions.deletedCount} Nandu transactions`
  );
  console.log(`   ✅ Deleted ${saiTransactions.deletedCount} Sai transactions`);

  // Step 4: Reset wallet balances and stats
  console.log("\n💰 STEP 4: Resetting wallet balances...");

  // Reset Nandu
  const nanduBefore = {
    wallet: nanduUser.wallet,
    totalSpent: nanduUser.totalSpent,
    earnings: nanduUser.earnings,
  };

  nanduUser.wallet = 10;
  nanduUser.totalSpent = 0;
  nanduUser.earnings = 0;
  await nanduUser.save();

  // Reset Sai
  const saiBefore = {
    wallet: saiUser.wallet,
    totalSpent: saiUser.totalSpent,
    earnings: saiUser.earnings,
  };

  saiUser.wallet = 10;
  saiUser.totalSpent = 0;
  saiUser.earnings = 0;
  await saiUser.save();

  console.log("\n📊 BEFORE RESET:");
  console.log(
    `   Nandu: Wallet ₹${nanduBefore.wallet}, Spent ₹${nanduBefore.totalSpent}, Earned ₹${nanduBefore.earnings}`
  );
  console.log(
    `   Sai: Wallet ₹${saiBefore.wallet}, Spent ₹${saiBefore.totalSpent}, Earned ₹${saiBefore.earnings}`
  );

  console.log("\n📊 AFTER RESET:");
  console.log(
    `   Nandu: Wallet ₹${nanduUser.wallet}, Spent ₹${nanduUser.totalSpent}, Earned ₹${nanduUser.earnings}`
  );
  console.log(
    `   Sai: Wallet ₹${saiUser.wallet}, Spent ₹${saiUser.totalSpent}, Earned ₹${saiUser.earnings}`
  );

  // Step 5: Verify clean state
  console.log("\n🔍 STEP 5: Verifying clean state...");

  const remainingConsultations = await Consultation.countDocuments({
    $or: [
      { user: nanduUser._id, provider: saiUser._id },
      { user: saiUser._id, provider: nanduUser._id },
    ],
  });

  const remainingNanduTransactions = await Transaction.countDocuments({
    user: nanduUser._id,
  });

  const remainingSaiTransactions = await Transaction.countDocuments({
    user: saiUser._id,
  });

  console.log(`   Remaining consultations: ${remainingConsultations}`);
  console.log(`   Remaining Nandu transactions: ${remainingNanduTransactions}`);
  console.log(`   Remaining Sai transactions: ${remainingSaiTransactions}`);

  if (
    remainingConsultations === 0 &&
    remainingNanduTransactions === 0 &&
    remainingSaiTransactions === 0
  ) {
    console.log("   ✅ Clean state verified!");
  } else {
    console.log("   ⚠️ Some data may still remain");
  }

  console.log("\n🎯 FRESH TESTING SETUP COMPLETE!");
  console.log("─".repeat(50));
  console.log("✅ Both users have ₹10 wallet balance");
  console.log("✅ All previous call history deleted");
  console.log("✅ All transaction history cleared");
  console.log("✅ Ready for fresh round-up billing tests");

  console.log("\n📋 TESTING SCENARIOS NOW POSSIBLE:");
  console.log("─".repeat(40));
  console.log("• Nandu (₹10) calls Sai (₹1/min) → Can talk 10 minutes");
  console.log("• Test 10-second call → Should charge ₹1");
  console.log("• Test 1:30 call → Should charge ₹2");
  console.log("• Test insufficient funds modal → Only Nandu sees it");
  console.log("• Test rating modal → Only Nandu sees it");

  console.log("\n🚀 READY FOR TESTING!");
  console.log("Login credentials:");
  console.log("  Nandu: nandubhide@gmail.com / Nandu@123");
  console.log("  Sai: saipavithra@gmail.com / Master@1");

  mongoose.connection.close();
  console.log("\n✅ Database connection closed");
}

resetUsersForTesting().catch(console.error);
