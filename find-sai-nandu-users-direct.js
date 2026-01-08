/**
 * Direct database check to find Sai and Nandu users with correct emails
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

// User schema (simplified)
const userSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    password: String,
    wallet: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    consultationRates: {
      video: Number,
      audio: Number,
      chat: Number,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

// Consultation schema (simplified)
const consultationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    mode: String,
    status: String,
    rate: Number,
    duration: Number,
    totalAmount: Number,
    startTime: Date,
    endTime: Date,
    endReason: String,
  },
  { timestamps: true }
);

const Consultation = mongoose.model("Consultation", consultationSchema);

// Transaction schema (simplified)
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

async function findUsers() {
  await connectDB();

  console.log("🔍 SEARCHING FOR SAI AND NANDU USERS");
  console.log("=".repeat(60));

  // Search for users with names containing "sai" or "nandu"
  const saiUsers = await User.find({
    $or: [{ name: { $regex: /sai/i } }, { email: { $regex: /sai/i } }],
  });

  const nanduUsers = await User.find({
    $or: [{ name: { $regex: /nandu/i } }, { email: { $regex: /nandu/i } }],
  });

  console.log('\n🔵 USERS MATCHING "SAI":');
  saiUsers.forEach((user, index) => {
    console.log(`${index + 1}. Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   ID: ${user._id}`);
    console.log(`   Wallet: ₹${user.wallet || 0}`);
    console.log(`   Earnings: ₹${user.earnings || 0}`);
    console.log(
      `   Video Rate: ₹${user.consultationRates?.video || "Not set"}/min`
    );
    console.log("   ---");
  });

  console.log('\n🟢 USERS MATCHING "NANDU":');
  nanduUsers.forEach((user, index) => {
    console.log(`${index + 1}. Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   ID: ${user._id}`);
    console.log(`   Wallet: ₹${user.wallet || 0}`);
    console.log(`   Total Spent: ₹${user.totalSpent || 0}`);
    console.log("   ---");
  });

  // If we found the users, check their recent consultations
  if (saiUsers.length > 0 && nanduUsers.length > 0) {
    const saiUser = saiUsers[0];
    const nanduUser = nanduUsers[0];

    console.log("\n📋 CHECKING RECENT CONSULTATIONS BETWEEN THEM:");
    console.log("─".repeat(50));

    const consultations = await Consultation.find({
      $or: [
        { user: nanduUser._id, provider: saiUser._id },
        { user: saiUser._id, provider: nanduUser._id },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (consultations.length === 0) {
      console.log("❌ No consultations found between Sai and Nandu");
    } else {
      console.log(`✅ Found ${consultations.length} consultation(s):`);

      for (const consultation of consultations) {
        console.log(`\n📞 CONSULTATION:`);
        console.log(`   ID: ${consultation._id}`);
        console.log(`   Status: ${consultation.status}`);
        console.log(`   Mode: ${consultation.mode}`);
        console.log(`   Rate: ₹${consultation.rate}/min`);
        console.log(`   Duration: ${consultation.duration || 0} minutes`);
        console.log(`   Total Amount: ₹${consultation.totalAmount || 0}`);
        console.log(
          `   Start: ${
            consultation.startTime
              ? new Date(consultation.startTime).toLocaleString()
              : "Not started"
          }`
        );
        console.log(
          `   End: ${
            consultation.endTime
              ? new Date(consultation.endTime).toLocaleString()
              : "Not ended"
          }`
        );
        console.log(`   End Reason: ${consultation.endReason || "N/A"}`);
        console.log(
          `   Created: ${new Date(consultation.createdAt).toLocaleString()}`
        );

        // Check transactions for this consultation
        const transactions = await Transaction.find({
          consultationId: consultation._id,
        });

        console.log(`   Transactions: ${transactions.length}`);
        transactions.forEach((t) => {
          console.log(
            `     - ${t.type}: ₹${t.amount} (${new Date(
              t.createdAt
            ).toLocaleString()})`
          );
        });
      }

      // Calculate billing analysis for most recent call
      const recentCall = consultations[0];
      const expectedAmount =
        (recentCall.duration || 0) * (recentCall.rate || 0);
      const actualAmount = recentCall.totalAmount || 0;

      console.log("\n📊 BILLING ANALYSIS (Most Recent Call):");
      console.log("─".repeat(40));
      console.log(`Duration: ${recentCall.duration || 0} minutes`);
      console.log(`Rate: ₹${recentCall.rate || 0}/min`);
      console.log(`Expected Charge: ₹${expectedAmount}`);
      console.log(`Actual Charge: ₹${actualAmount}`);
      console.log(
        `Billing Accuracy: ${
          expectedAmount === actualAmount ? "✅ CORRECT" : "❌ MISMATCH"
        }`
      );

      if (recentCall.endReason) {
        console.log(`End Reason: ${recentCall.endReason}`);
      }
    }

    console.log("\n🔑 CORRECT LOGIN CREDENTIALS:");
    console.log("─".repeat(30));
    console.log(`SAI: ${saiUser.email} / Master@1`);
    console.log(`NANDU: ${nanduUser.email} / Nandu@123`);
  }

  mongoose.connection.close();
  console.log("\n✅ Database connection closed");
}

findUsers().catch(console.error);
