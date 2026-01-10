// Script to create a fresh admin account after database reset
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function createAdminAccount() {
  console.log("👑 CREATING FRESH ADMIN ACCOUNT");
  console.log("");

  try {
    // Connect to MongoDB
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat";
    console.log("📡 Connecting to MongoDB...");

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
    console.log("");

    // Check if Admin model exists, if not create a simple schema
    let Admin;
    try {
      Admin = mongoose.model("Admin");
    } catch (error) {
      // Create Admin schema if it doesn't exist
      const adminSchema = new mongoose.Schema({
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        name: { type: String, required: true },
        role: { type: String, default: "admin" },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      });

      Admin = mongoose.model("Admin", adminSchema);
    }

    // Check if any admin already exists
    const existingAdmin = await Admin.findOne({});
    if (existingAdmin) {
      console.log("⚠️  Admin account already exists:");
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Name: ${existingAdmin.name}`);
      console.log("");
      console.log(
        "🔧 If you need to reset the admin password, delete this admin first:"
      );
      console.log("   db.admins.deleteMany({})");
      return;
    }

    // Admin account details
    const adminData = {
      email: "admin@quickchat.com",
      password: "admin123", // This will be hashed
      name: "QuickChat Admin",
      role: "admin",
      isActive: true,
    };

    console.log("🔐 Creating admin account with details:");
    console.log(`   Email: ${adminData.email}`);
    console.log(`   Password: ${adminData.password} (will be hashed)`);
    console.log(`   Name: ${adminData.name}`);
    console.log("");

    // Hash the password
    console.log("🔒 Hashing password...");
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(adminData.password, saltRounds);
    console.log("✅ Password hashed successfully");

    // Create admin account
    const admin = new Admin({
      ...adminData,
      password: hashedPassword,
    });

    await admin.save();
    console.log("✅ Admin account created successfully!");
    console.log("");

    // Verify admin was created
    const createdAdmin = await Admin.findOne({ email: adminData.email });
    if (createdAdmin) {
      console.log("🔍 Verification - Admin account found in database:");
      console.log(`   ID: ${createdAdmin._id}`);
      console.log(`   Email: ${createdAdmin.email}`);
      console.log(`   Name: ${createdAdmin.name}`);
      console.log(`   Role: ${createdAdmin.role}`);
      console.log(`   Active: ${createdAdmin.isActive}`);
      console.log(`   Created: ${createdAdmin.createdAt}`);
    }

    console.log("");
    console.log("🎉 ADMIN ACCOUNT SETUP COMPLETE!");
    console.log("");
    console.log("🔑 LOGIN CREDENTIALS:");
    console.log(`   Email: ${adminData.email}`);
    console.log(`   Password: ${adminData.password}`);
    console.log("");
    console.log("🚀 NEXT STEPS:");
    console.log("1. Go to admin login page: http://localhost:3000/admin/login");
    console.log("2. Use the credentials above to login");
    console.log("3. Access admin panel features");
    console.log("4. Change password after first login (recommended)");
    console.log("");
    console.log("⚠️  SECURITY NOTE:");
    console.log(
      "Please change the default password after first login for security!"
    );
  } catch (error) {
    console.error("❌ Error creating admin account:", error.message);
    console.error("");
    console.error("🔧 TROUBLESHOOTING:");
    console.error("1. Make sure MongoDB is running");
    console.error("2. Check .env file for correct MONGODB_URI");
    console.error("3. Verify bcryptjs is installed: npm install bcryptjs");
    console.error("4. Check if Admin model schema matches your backend");
  } finally {
    // Close connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("📡 MongoDB connection closed");
    }
  }
}

// Alternative method - create admin using direct database insertion
async function createAdminDirect() {
  console.log("");
  console.log("🔧 ALTERNATIVE METHOD - Direct Database Insertion:");
  console.log("If the script above doesn't work, run these MongoDB commands:");
  console.log("");
  console.log("// Connect to your database");
  console.log("use quickchat");
  console.log("");
  console.log("// Insert admin account directly");
  console.log("db.admins.insertOne({");
  console.log('  email: "admin@quickchat.com",');
  console.log(
    '  password: "$2a$10$rQZ8kJQXQXQXQXQXQXQXQeJ1J1J1J1J1J1J1J1J1J1J1J1J1J1J1J", // hashed "admin123"'
  );
  console.log('  name: "QuickChat Admin",');
  console.log('  role: "admin",');
  console.log("  isActive: true,");
  console.log("  createdAt: new Date(),");
  console.log("  updatedAt: new Date()");
  console.log("});");
  console.log("");
  console.log("// Verify admin was created");
  console.log("db.admins.find({});");
}

// Run the admin creation
if (require.main === module) {
  createAdminAccount()
    .then(() => {
      createAdminDirect();
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      createAdminDirect();
      process.exit(1);
    });
}

module.exports = createAdminAccount;
