/**
 * CLEANUP SCRIPT: Keep ONLY provider "DASAR NARASIMHAMURTHY"
 *
 * WARNING: THIS IS IRREVERSIBLE. Take a MongoDB Atlas backup before running.
 *
 * Usage:
 *   cd QuickChat-aws
 *   node scripts/cleanup_keep_narasimhamurthy.js
 *
 * Set DRY_RUN = true below to preview counts without deleting anything.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User         = require('../src/models/User.model');
const Guest        = require('../src/models/Guest.model');
const Consultation = require('../src/models/Consultation.model');
const Transaction  = require('../src/models/Transaction.model');
const Withdrawal   = require('../src/models/Withdrawal.model');
const Rating       = require('../src/models/Rating.model');
const Review       = require('../src/models/Review.model');
const Chat         = require('../src/models/Chat');
const ChatMessage  = require('../src/models/ChatMessage');
const Notification = require('../src/models/Notification.model');
const OTP          = require('../src/models/OTP.model');
const Report       = require('../src/models/Report.model');

const TARGET_NAME = 'DASAR NARASIMHAMURTHY';

// Set to true to preview without deleting
const DRY_RUN = false;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // ── STEP 1: Find the target provider ──────────────────────────────────────
  console.log('\n=== STEP 1: Finding provider "' + TARGET_NAME + '" ===');

  const target = await User.findOne({
    fullName: { $regex: new RegExp(TARGET_NAME, 'i') },
    isServiceProvider: true,
  });

  if (!target) {
    console.error('ERROR: Provider "' + TARGET_NAME + '" not found. Aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\nFound provider:');
  console.log('  _id     :', target._id.toString());
  console.log('  fullName:', target.fullName);
  console.log('  email   :', target.email);
  console.log('  mobile  :', target.mobile);
  console.log('  wallet  : Rs.' + target.wallet);
  console.log('  earnings: Rs.' + target.earnings);
  console.log('  status  :', target.status);
  console.log('  isServiceProvider:', target.isServiceProvider);
  console.log('  providerVerificationStatus:', target.providerVerificationStatus);
  console.log('  createdAt:', target.createdAt);
  console.log('\nFull document:');
  console.log(JSON.stringify(target.toObject(), null, 2));

  const keepId = target._id;

  // ── STEP 2: Gather IDs to delete ──────────────────────────────────────────
  console.log('\n=== STEP 2: Counting records to delete ===');

  const usersToDelete  = await User.find({ _id: { $ne: keepId } }).select('_id fullName email isServiceProvider');
  const guestsToDelete = await Guest.find({}).select('_id name mobile');

  const deleteUserIds  = usersToDelete.map(u => u._id);
  const deleteGuestIds = guestsToDelete.map(g => g._id);

  const consultationsToDelete = await Consultation.find({ provider: { $ne: keepId } }).select('_id');
  const deleteConsultationIds = consultationsToDelete.map(c => c._id);

  const transactionsToDelete = await Transaction.find({
    $or: [
      { user: { $in: [...deleteUserIds, ...deleteGuestIds] } },
      { userId: { $in: deleteUserIds } },
    ],
  }).select('_id');

  const withdrawalsToDelete = await Withdrawal.find({
    $or: [
      { user: { $in: deleteUserIds } },
      { userId: { $in: deleteUserIds } },
    ],
  }).select('_id');

  const ratingsToDelete = await Rating.find({ provider: { $ne: keepId } }).select('_id');
  const reviewsToDelete = await Review.find({ provider: { $ne: keepId } }).select('_id');

  const chatsToDelete = await Chat.find({ provider: { $ne: keepId } }).select('_id');
  const deleteChatIds = chatsToDelete.map(c => c._id);

  const chatMessagesToDelete = await ChatMessage.find({ chat: { $in: deleteChatIds } }).select('_id');
  const notificationsToDelete = await Notification.find({ user: { $in: deleteUserIds } }).select('_id');
  const otpsToDelete = await OTP.find({}).select('_id');
  const reportsToDelete = await Report.find({
    $or: [
      { reporter: { $in: deleteUserIds } },
      { reported: { $in: deleteUserIds } },
    ],
  }).select('_id');

  console.log('\nRecords that will be DELETED:');
  console.log('  Users (other than target)  :', usersToDelete.length);
  console.log('  Guests                     :', guestsToDelete.length);
  console.log('  Consultations              :', consultationsToDelete.length);
  console.log('  Transactions               :', transactionsToDelete.length);
  console.log('  Withdrawals                :', withdrawalsToDelete.length);
  console.log('  Ratings                    :', ratingsToDelete.length);
  console.log('  Reviews                    :', reviewsToDelete.length);
  console.log('  Chats                      :', chatsToDelete.length);
  console.log('  ChatMessages               :', chatMessagesToDelete.length);
  console.log('  Notifications              :', notificationsToDelete.length);
  console.log('  OTPs                       :', otpsToDelete.length);
  console.log('  Reports                    :', reportsToDelete.length);

  console.log('\nUsers that will be deleted:');
  usersToDelete.forEach((u, i) => {
    console.log('  ' + (i + 1) + '. ' + u.fullName + ' (' + u.email + ') provider=' + u.isServiceProvider);
  });

  console.log('\nGuests that will be deleted:');
  guestsToDelete.forEach((g, i) => {
    console.log('  ' + (i + 1) + '. ' + g.name + ' (' + g.mobile + ')');
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No data was deleted. Set DRY_RUN = false to execute.');
    await mongoose.disconnect();
    return;
  }

  // ── STEP 3: Delete everything ──────────────────────────────────────────────
  console.log('\n=== STEP 3: Deleting records ===');

  let r;

  r = await ChatMessage.deleteMany({ chat: { $in: deleteChatIds } });
  console.log('Deleted ChatMessages    :', r.deletedCount);

  r = await Chat.deleteMany({ provider: { $ne: keepId } });
  console.log('Deleted Chats           :', r.deletedCount);

  r = await Rating.deleteMany({ provider: { $ne: keepId } });
  console.log('Deleted Ratings         :', r.deletedCount);

  r = await Review.deleteMany({ provider: { $ne: keepId } });
  console.log('Deleted Reviews         :', r.deletedCount);

  r = await Report.deleteMany({
    $or: [
      { reporter: { $in: deleteUserIds } },
      { reported: { $in: deleteUserIds } },
    ],
  });
  console.log('Deleted Reports         :', r.deletedCount);

  r = await Notification.deleteMany({ user: { $in: deleteUserIds } });
  console.log('Deleted Notifications   :', r.deletedCount);

  r = await Transaction.deleteMany({
    $or: [
      { user: { $in: [...deleteUserIds, ...deleteGuestIds] } },
      { userId: { $in: deleteUserIds } },
    ],
  });
  console.log('Deleted Transactions    :', r.deletedCount);

  r = await Withdrawal.deleteMany({
    $or: [
      { user: { $in: deleteUserIds } },
      { userId: { $in: deleteUserIds } },
    ],
  });
  console.log('Deleted Withdrawals     :', r.deletedCount);

  r = await Consultation.deleteMany({ provider: { $ne: keepId } });
  console.log('Deleted Consultations   :', r.deletedCount);

  r = await OTP.deleteMany({});
  console.log('Deleted OTPs            :', r.deletedCount);

  r = await Guest.deleteMany({});
  console.log('Deleted Guests          :', r.deletedCount);

  r = await User.deleteMany({ _id: { $ne: keepId } });
  console.log('Deleted Users           :', r.deletedCount);

  // ── STEP 4: Verify ────────────────────────────────────────────────────────
  console.log('\n=== STEP 4: Verification ===');

  const remainingUsers  = await User.countDocuments({});
  const remainingGuests = await Guest.countDocuments({});
  const survivor        = await User.findById(keepId).select('fullName email mobile isServiceProvider');

  console.log('Remaining Users  :', remainingUsers);
  console.log('Remaining Guests :', remainingGuests);
  console.log('Survivor         :', survivor ? survivor.fullName + ' (' + survivor.email + ')' : 'NOT FOUND - ERROR!');

  if (remainingUsers === 1 && survivor && survivor.fullName.toUpperCase().includes('NARASIMHAMURTHY')) {
    console.log('\nSUCCESS: Only DASAR NARASIMHAMURTHY remains in the database.');
  } else {
    console.log('\nWARNING: Unexpected state after cleanup. Please verify manually.');
  }

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB. Done.');
}

run().catch(async (error) => {
  console.error('FATAL ERROR:', error);
  await mongoose.disconnect();
  process.exit(1);
});
