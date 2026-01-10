const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chat",
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "senderType",
  },
  senderType: {
    type: String,
    required: true,
    enum: ["User", "Guest"],
  },
  senderName: {
    type: String,
    required: true,
    trim: true,
  },
  senderAvatar: {
    type: String,
    default: null,
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000,
  },
  messageType: {
    type: String,
    enum: ["text", "image", "file", "audio", "video"],
    default: "text",
  },
  attachments: [
    {
      type: {
        type: String,
        enum: ["image", "file", "audio", "video"],
      },
      url: String,
      filename: String,
      size: Number,
    },
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["sending", "sent", "delivered", "read", "failed"],
    default: "sent",
  },
  editedAt: {
    type: Date,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatMessage",
  },
});

// Index for efficient queries
chatMessageSchema.index({ chat: 1, timestamp: -1 });
chatMessageSchema.index({ sender: 1 });
chatMessageSchema.index({ status: 1 });

// Virtual for formatted timestamp
chatMessageSchema.virtual("formattedTime").get(function () {
  return this.timestamp.toLocaleString();
});

// Method to mark message as read
chatMessageSchema.methods.markAsRead = function () {
  this.status = "read";
  return this.save();
};

// Method to edit message
chatMessageSchema.methods.editMessage = function (newMessage) {
  this.message = newMessage;
  this.isEdited = true;
  this.editedAt = new Date();
  return this.save();
};

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
