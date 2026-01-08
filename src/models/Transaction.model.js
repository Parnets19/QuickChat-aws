const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // Support both regular users and guest users
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "userType",
    },
    userType: {
      type: String,
      required: true,
      enum: ["User", "Guest"],
      default: "User",
    },
    // Legacy field for backward compatibility
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
    },
    type: {
      type: String,
      enum: [
        "credit",
        "debit",
        "earning",
        "withdrawal",
        "refund",
        "bonus",
        "penalty",
        "wallet_credit",
        "consultation_payment",
        "consultation_payment_failed",
        "wallet_debit",
        "deposit",
        "payout",
      ],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "consultation",
        "deposit",
        "withdrawal",
        "refund",
        "bonus",
        "penalty",
        "commission",
        "fee",
        "adjustment",
        "transfer",
      ],
      required: true,
    },
    balance: {
      type: Number,
      required: true, // Balance after this transaction
    },
    amount: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled"],
      default: "completed",
    },
    // Transaction ID for external payment gateways
    transactionId: {
      type: String,
      sparse: true, // This allows multiple null values
      default: function () {
        // Generate unique transaction ID if not provided
        return `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      },
    },
    // Payment method used
    paymentMethod: {
      type: String,
      enum: ["wallet", "upi", "card", "netbanking", "bank_transfer", "demo"],
      default: "wallet",
    },
    // Withdrawal reference
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Withdrawal",
    },

    // Payment gateway details
    paymentGateway: {
      type: String,
      enum: [
        "razorpay",
        "stripe",
        "paytm",
        "phonepe",
        "gpay",
        "manual",
        "demo",
      ],
    },
    gatewayTransactionId: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,

    // Admin processing
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Admin user
    },
    processedAt: Date,

    metadata: {
      clientName: String,
      consultationType: String,
      duration: Number, // in minutes
      rate: Number,
      providerId: mongoose.Schema.Types.ObjectId,
      previousBalance: Number,
      newBalance: Number,
      bankDetails: mongoose.Schema.Types.Mixed,
      // Additional metadata for different transaction types
      withdrawalDetails: mongoose.Schema.Types.Mixed,
      depositDetails: mongoose.Schema.Types.Mixed,
      consultationDetails: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, createdAt: -1 }); // Legacy support
TransactionSchema.index({ userType: 1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ category: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ consultationId: 1 });
TransactionSchema.index({ withdrawalId: 1 });
// transactionId sparse index handled by schema
TransactionSchema.index({ processedBy: 1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
