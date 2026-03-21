/**
 * Script to add securityQuestion and securityAnswer to an existing user
 * Usage: node scripts/add-security-question.js <email> "<question>" "<answer>"
 * Example: node scripts/add-security-question.js rairaviranjan1@gmail.com "What city were you born in?" "bihar"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const email = process.argv[2];
const question = process.argv[3];
const answer = process.argv[4];

if (!email || !question || !answer) {
  console.error('Usage: node scripts/add-security-question.js <email> "<question>" "<answer>"');
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const User = require('../src/models/User.model');

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }

  const salt = await bcrypt.genSalt(10);
  const hashedAnswer = await bcrypt.hash(answer.toLowerCase().trim(), salt);

  user.securityQuestion = question;
  user.securityAnswer = hashedAnswer;
  await user.save();

  console.log(`✅ Security question saved for ${email}`);
  console.log(`   Question: ${question}`);
  console.log(`   Answer:   ${answer} (stored hashed)`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
