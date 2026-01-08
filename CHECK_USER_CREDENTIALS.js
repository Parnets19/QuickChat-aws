const mongoose = require("mongoose");
const { User } = require("./src/models");
require("dotenv").config();

/**
 * CHECK: What users exist and their credentials
 */

const connectDB = async () => {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://skillhub:OEJRW8zaAfOLft5M@jainimpexcrm.grb5bho.mongodb.net/skillhub";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

async function checkUserCredentials() {
  console.log("🔍 CHECKING USER CREDENTIALS");
  console.log("=".repeat(40));

  try {
    await connectDB();

    // Find Nandu and Sai
    const users = await User.find({
      $or: [
        { fullName: { $regex: /nandu/i } },
        { fullName: { $regex: /sai/i } },
      ],
    }).select("fullName email mobile password isServiceProvider");

    console.log("👤 USERS FOUND:");
    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.fullName}`);
      console.log(`   Email: ${user.email || "Not set"}`);
      console.log(`   Mobile: ${user.mobile || "Not set"}`);
      console.log(
        `   Password: ${user.password ? "Set (encrypted)" : "Not set"}`
      );
      console.log(`   Is Provider: ${user.isServiceProvider || false}`);
      console.log(`   ID: ${user._id}`);
    });

    // Check if there are any users with simple credentials
    const simpleUsers = await User.find({
      $or: [
        { email: "nandu@example.com" },
        { email: "sai@example.com" },
        { email: "test@example.com" },
        { mobile: "1234567890" },
        { mobile: "9876543210" },
      ],
    }).select("fullName email mobile password");

    if (simpleUsers.length > 0) {
      console.log("\n🔑 USERS WITH SIMPLE CREDENTIALS:");
      simpleUsers.forEach((user, index) => {
        console.log(`\n${index + 1}. ${user.fullName}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Mobile: ${user.mobile}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Check failed:", error);
    process.exit(1);
  }
}

checkUserCredentials();
