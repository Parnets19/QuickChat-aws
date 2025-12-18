const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    // Support both regular users and guest users
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType'
    },
    userType: {
      type: String,
      required: true,
      enum: ['User', 'Guest'],
      default: 'User'
    },
    // Legacy field for backward compatibility
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation',
    },
    type: {
      type: String,
      enum: [
        'earning', 'withdrawal', 'refund', 'bonus', 'penalty',
        'wallet_credit', 'consultation_payment', 'wallet_debit'
      ],
      required: true,
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
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'completed',
    },
    // Transaction ID for external payment gateways
    transactionId: {
      type: String,
      unique: true,
      sparse: true
    },
    // Payment method used
    paymentMethod: {
      type: String,
      enum: ['wallet', 'upi', 'card', 'netbanking', 'bank_transfer', 'demo'],
      default: 'wallet'
    },
    metadata: {
      clientName: String,
      consultationType: String,
      duration: Number, // in minutes
      rate: Number,
      providerId: mongoose.Schema.Types.ObjectId,
      previousBalance: Number,
      newBalance: Number,
      bankDetails: mongoose.Schema.Types.Mixed
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);