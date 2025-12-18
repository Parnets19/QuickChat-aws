const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema(
  {
    mobile: String,
    email: String,
    otp: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['mobile', 'email'],
      required: true,
    },
    purpose: {
      type: String,
      enum: ['registration', 'login', 'forgot-password', 'guest'],
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  },
  {
    timestamps: true,
  }
);

// Index
OTPSchema.index({ mobile: 1, type: 1 });
OTPSchema.index({ email: 1, type: 1 });
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OTP', OTPSchema);

