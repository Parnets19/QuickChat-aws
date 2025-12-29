const User = require('./User.model');
const Admin = require('./Admin.model');
const Guest = require('./Guest.model');
const Consultation = require('./Consultation.model');
const Transaction = require('./Transaction.model');
const Subscription = require('./Subscription.model');
const Category = require('./Category.model');
const Review = require('./Review.model');
const Rating = require('./Rating.model');
const Notification = require('./Notification.model');
const Withdrawal = require('./Withdrawal.model');
const OTP = require('./OTP.model');
const Settings = require('./Settings.model');
const Banner = require('./Banner.model');
const EarningsTransaction = require('./Transaction.model');
const WithdrawalRequest = require('./Withdrawal.model');
const Chat = require('./Chat');
const ChatMessage = require('./ChatMessage');

module.exports = {
  User,
  Admin,
  Guest,
  Consultation,
  Transaction,
  Subscription,
  Category,
  Review,
  Rating,
  Notification,
  Withdrawal,
  OTP,
  Settings,
  Banner,
  EarningsTransaction,
  WithdrawalRequest,
  Chat,
  ChatMessage,
};

