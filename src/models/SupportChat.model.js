const mongoose = require('mongoose');

const SupportMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'bot', 'admin'], required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
});

const SupportChatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guestName: { type: String },
    guestEmail: { type: String },
    guestPhone: { type: String }, // optional phone number
    subject: { type: String, default: 'General Support' },
    messages: [SupportMessageSchema],
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
    },
    type: {
      type: String,
      enum: ['live_chat', 'contact_form'],
      default: 'live_chat',
    },
    adminUnread: { type: Number, default: 0 },
    lastMessage: { type: String },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

SupportChatSchema.index({ status: 1, createdAt: -1 });
SupportChatSchema.index({ user: 1 });

module.exports = mongoose.model('SupportChat', SupportChatSchema);
