const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const GuestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
      match: [/^[0-9]{10}$/, "Please enter a valid 10-digit mobile number"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Guest-specific fields
    isGuest: {
      type: Boolean,
      default: true,
    },
    // Wallet and financial data
    wallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    // Verification status
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    // Status tracking
    isOnline: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    // Last activity tracking
    lastActive: {
      type: Date,
      default: Date.now,
    },
    // OTP tracking for login
    lastOtpSent: {
      type: Date,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    // FCM tokens for notifications
    fcmTokens: [String],
    // Consultation history (references)
    consultations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Consultation",
      },
    ],
    // Transaction history (references)
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],

    // Track free minutes used with each provider (First Minute Free Trial system)
    freeMinutesUsed: [
      {
        providerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        usedAt: {
          type: Date,
          default: Date.now,
        },
        consultationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Consultation",
        },
      },
    ],

    // NEW: First Time Free Trial System (one-time free call for new users)
    hasUsedFreeTrialCall: {
      type: Boolean,
      default: false,
    },
    freeTrialUsedAt: {
      type: Date,
      default: null,
    },
    freeTrialConsultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
GuestSchema.index({ mobile: 1 });
GuestSchema.index({ status: 1 });
GuestSchema.index({ createdAt: -1 });

// Generate auth token for guest
GuestSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    {
      id: this._id,
      mobile: this.mobile,
      isGuest: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "30d" }
  );
};

// Update last active timestamp
GuestSchema.methods.updateLastActive = function () {
  this.lastActive = new Date();
  return this.save();
};

// Add money to wallet
GuestSchema.methods.addToWallet = function (amount) {
  this.wallet += amount;
  return this.save();
};

// Deduct money from wallet
GuestSchema.methods.deductFromWallet = function (amount) {
  if (this.wallet < amount) {
    throw new Error("Insufficient wallet balance");
  }
  this.wallet -= amount;
  this.totalSpent += amount;
  return this.save();
};

// Check if guest can make a payment
GuestSchema.methods.canMakePayment = function (amount) {
  return this.wallet >= amount && this.status === "active";
};

module.exports = mongoose.model("Guest", GuestSchema);
