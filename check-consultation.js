const mongoose = require("mongoose");
require("dotenv").config();

const SHUBHAM_ID = "6943aa41a517365ff302e849";
const CHOTIBAHU_ID = "6943f49e9dca7b2a6e56e1ae";
const CONSULTATION_ID = "69608d363afe20c2e460eb73";

async function main() {
  try {
    console.log("🔍 Connecting to MongoDB...");
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/quickchat"
    );
    console.log("✅ Connected\n");

    const Consultation = mongoose.model(
      "Consultation",
      new mongoose.Schema({}, { strict: false })
    );

    // Check specific consultation
    console.log(`🔍 Checking consultation: ${CONSULTATION_ID}`);
    let consultation = await Consultation.findById(CONSULTATION_ID);

    if (!consultation) {
      console.log("❌ Consultation NOT FOUND!");
      console.log("\n🔍 Searching for any consultation between these users...");

      consultation = await Consultation.findOne({
        $or: [
          { user: SHUBHAM_ID, provider: CHOTIBAHU_ID },
          { user: CHOTIBAHU_ID, provider: SHUBHAM_ID },
        ],
      }).sort({ createdAt: -1 });

      if (consultation) {
        console.log(`✅ Found consultation: ${consultation._id}`);
      } else {
        console.log("❌ No consultation found between these users");
        console.log("\n📝 Creating new consultation...");

        consultation = new Consultation({
          user: SHUBHAM_ID,
          provider: CHOTIBAHU_ID,
          type: "chat",
          status: "ongoing",
          paymentCompleted: true,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await consultation.save();
        console.log(`✅ Created: ${consultation._id}`);
      }
    } else {
      console.log("✅ Consultation EXISTS!");
    }

    console.log("\n📋 Consultation Details:");
    console.log(`   ID: ${consultation._id}`);
    console.log(`   User: ${consultation.user}`);
    console.log(`   Provider: ${consultation.provider}`);
    console.log(`   Type: ${consultation.type}`);
    console.log(`   Status: ${consultation.status}`);
    console.log(`   Messages: ${consultation.messages?.length || 0}`);

    // Verify user IDs match
    const userStr = consultation.user.toString();
    const providerStr = consultation.provider.toString();

    console.log("\n🔍 Verification:");
    console.log(`   User matches Shubham: ${userStr === SHUBHAM_ID}`);
    console.log(`   User matches Chotibahu: ${userStr === CHOTIBAHU_ID}`);
    console.log(`   Provider matches Shubham: ${providerStr === SHUBHAM_ID}`);
    console.log(
      `   Provider matches Chotibahu: ${providerStr === CHOTIBAHU_ID}`
    );

    const isValid =
      (userStr === SHUBHAM_ID && providerStr === CHOTIBAHU_ID) ||
      (userStr === CHOTIBAHU_ID && providerStr === SHUBHAM_ID);

    if (isValid) {
      console.log("\n✅ CONSULTATION IS VALID FOR MESSAGING!");
      console.log(
        `\n💡 Use this consultation ID in your tests: ${consultation._id}`
      );
    } else {
      console.log("\n❌ CONSULTATION HAS WRONG PARTICIPANTS!");
      console.log("   Fixing...");
      consultation.user = SHUBHAM_ID;
      consultation.provider = CHOTIBAHU_ID;
      await consultation.save();
      console.log("✅ Fixed!");
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
