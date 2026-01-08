/**
 * DEBUG SPECIFIC CONSULTATION THAT WAS CHARGED ₹0.05
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

async function debugSpecificConsultation() {
  await connectDB();

  console.log("🔍 DEBUGGING CONSULTATION 695e031b8ddd16f1ae5abb0a");
  console.log("=".repeat(60));

  // Find the specific consultation
  const consultation = await Consultation.findById(
    "695e031b8ddd16f1ae5abb0a"
  ).populate("user provider");

  if (!consultation) {
    console.log("❌ Consultation not found");
    mongoose.connection.close();
    return;
  }

  console.log("📞 CONSULTATION DETAILS:");
  console.log("─".repeat(40));
  console.log(`ID: ${consultation._id}`);
  console.log(
    `Client: ${consultation.user.fullName || consultation.user.name} (${
      consultation.user.email
    })`
  );
  console.log(
    `Provider: ${
      consultation.provider.fullName || consultation.provider.name
    } (${consultation.provider.email})`
  );
  console.log(`Status: ${consultation.status}`);
  console.log(`Type: ${consultation.consultationType}`);
  console.log(`Duration: ${consultation.duration || 0} minutes`);
  console.log(`Total Amount: ₹${consultation.totalAmount || 0}`);
  console.log(`Free Minute Used: ${consultation.freeMinuteUsed || false}`);
  console.log(`Start Time: ${consultation.startTime || "Not set"}`);
  console.log(`End Time: ${consultation.endTime || "Not set"}`);
  console.log(`Created: ${consultation.createdAt}`);
  console.log(`Updated: ${consultation.updatedAt}`);

  // Calculate actual duration if start and end times exist
  if (consultation.startTime && consultation.endTime) {
    const actualDurationMs = consultation.endTime - consultation.startTime;
    const actualDurationSeconds = Math.floor(actualDurationMs / 1000);
    const actualDurationMinutes = actualDurationSeconds / 60;

    console.log(`\n⏱️ ACTUAL DURATION CALCULATION:`);
    console.log(`Start: ${consultation.startTime}`);
    console.log(`End: ${consultation.endTime}`);
    console.log(
      `Duration: ${actualDurationSeconds} seconds (${actualDurationMinutes.toFixed(
        2
      )} minutes)`
    );

    // Round-up calculation
    const roundedUpMinutes = Math.ceil(actualDurationSeconds / 60);
    console.log(`Round-up Minutes: ${roundedUpMinutes}`);
    console.log(`Expected Charge (₹1/min): ₹${roundedUpMinutes}`);
    console.log(`Actual Charge: ₹${consultation.totalAmount}`);
  }

  // Check if this should have been free
  console.log(`\n🆓 FREE MINUTE ANALYSIS:`);
  console.log(`Free Minute Used Flag: ${consultation.freeMinuteUsed}`);
  console.log(
    `Client Free Minutes Used: ${consultation.user.freeMinutesUsed || 0}`
  );
  console.log(
    `Client Free Minutes Available: ${
      consultation.user.freeMinutesAvailable || 1
    }`
  );

  if (
    !consultation.freeMinuteUsed &&
    (consultation.user.freeMinutesUsed || 0) === 0
  ) {
    console.log(
      `❌ ISSUE: This should have been FREE but was charged ₹${consultation.totalAmount}`
    );
  }

  mongoose.connection.close();
  console.log("\n✅ Database connection closed");
}

debugSpecificConsultation().catch(console.error);
