const mongoose = require("mongoose");
require("dotenv").config();

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

// User schema (simplified)
const userSchema = new mongoose.Schema(
  {
    fullName: String,
    email: String,
    mobile: String,
    password: String,
    role: String,
    isProvider: Boolean,
    profilePhoto: String,
    status: String,
    isOnline: Boolean,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

async function checkUsers() {
  console.log("🔍 Checking existing users...");

  const users = await User.find(
    {},
    {
      fullName: 1,
      email: 1,
      mobile: 1,
      role: 1,
      isProvider: 1,
      profilePhoto: 1,
      status: 1,
      isOnline: 1,
      createdAt: 1,
    }
  ).sort({ createdAt: -1 });

  console.log(`📊 Found ${users.length} users:`);

  users.forEach((user, index) => {
    console.log(`\n👤 User ${index + 1}:`);
    console.log(`  Name: ${user.fullName || "No name"}`);
    console.log(`  Email: ${user.email || "No email"}`);
    console.log(`  Mobile: ${user.mobile || "No mobile"}`);
    console.log(`  Role: ${user.role || "No role"}`);
    console.log(`  Is Provider: ${user.isProvider || false}`);
    console.log(`  Profile Photo: ${user.profilePhoto || "None"}`);
    console.log(`  Status: ${user.status || "No status"}`);
    console.log(`  Created: ${user.createdAt}`);
  });

  return users;
}

async function findShubhamUsers() {
  console.log("\n🔍 Looking for Shubham users...");

  const shubhamUsers = await User.find({
    $or: [
      { fullName: /shubham/i },
      { email: /shubham/i },
      { mobile: /987654321/i },
    ],
  });

  console.log(`📊 Found ${shubhamUsers.length} Shubham-related users:`);

  shubhamUsers.forEach((user, index) => {
    console.log(`\n👤 Shubham User ${index + 1}:`);
    console.log(`  ID: ${user._id}`);
    console.log(`  Name: ${user.fullName || "No name"}`);
    console.log(`  Email: ${user.email || "No email"}`);
    console.log(`  Mobile: ${user.mobile || "No mobile"}`);
    console.log(`  Has Password: ${!!user.password}`);
    console.log(`  Role: ${user.role || "No role"}`);
    console.log(`  Status: ${user.status || "No status"}`);
  });

  return shubhamUsers;
}

async function createShubhamUser() {
  console.log("\n🏗️ Creating Shubham user...");

  const bcrypt = require("bcrypt");
  const hashedPassword = await bcrypt.hash("Shubham123@", 12);

  const shubhamData = {
    fullName: "Shubham Sharma",
    email: "shubham123@gmail.com",
    mobile: "9876543211",
    password: hashedPassword,
    role: "user",
    isProvider: false,
    status: "active",
    isOnline: true,
    emailVerified: true,
    mobileVerified: true,
  };

  try {
    const existingUser = await User.findOne({ email: shubhamData.email });
    if (existingUser) {
      console.log("✅ Shubham user already exists, updating password...");
      existingUser.password = hashedPassword;
      existingUser.status = "active";
      await existingUser.save();
      console.log("✅ Shubham user password updated");
      return existingUser;
    } else {
      const newUser = new User(shubhamData);
      await newUser.save();
      console.log("✅ Shubham user created successfully");
      return newUser;
    }
  } catch (error) {
    console.error("❌ Error creating/updating Shubham user:", error);
    return null;
  }
}

async function main() {
  await connectDB();

  console.log("🧪 Checking Users and Fixing Shubham Login");
  console.log("=".repeat(50));

  // Check all users
  await checkUsers();

  // Look for Shubham specifically
  const shubhamUsers = await findShubhamUsers();

  // Create or fix Shubham user if needed
  if (shubhamUsers.length === 0) {
    console.log("\n❌ No Shubham user found, creating one...");
    await createShubhamUser();
  } else {
    console.log("\n✅ Shubham user exists, ensuring password is correct...");
    await createShubhamUser(); // This will update the password
  }

  // Check users again
  console.log("\n🔄 Final user check...");
  await checkUsers();

  console.log("\n✅ User check completed!");
  console.log("\n💡 Now you can test login with:");
  console.log("- Ravi: ravi123@gmail.com / Ravi123@");
  console.log("- Shubham: shubham123@gmail.com / Shubham123@");

  mongoose.connection.close();
}

main().catch(console.error);
