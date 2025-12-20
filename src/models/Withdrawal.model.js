const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema(
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
    amount: {
      type: Number,
      required: true,
      min: 500, // Minimum withdrawal amount
    },
    processingFee: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      required: true,
    },
    bankDetails: {
      accountNumber: {
        type: String,
        required: true,
      },
      ifscCode: {
        type: String,
        required: true,
      },
      accountHolderName: {
        type: String,
        required: true,
      },
      bankName: {
        type: String,
        required: true,
      },
      upiId: {
        type: String,
      },
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'processing', 'processed', 'failed', 'cancelled'],
      default: 'pending',
    },
    // Admin review tracking
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Admin user
    },
    reviewedAt: Date,
    adminNotes: String,
    rejectionReason: String,
    
    // Processing tracking
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Admin user
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    processedAt: Date,
    failureReason: String,
    notes: String,
    
    // Payment method for processing
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'upi', 'cheque'],
      default: 'bank_transfer',
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
WithdrawalSchema.index({ user: 1, createdAt: -1 });
WithdrawalSchema.index({ userId: 1, createdAt: -1 }); // Legacy support
WithdrawalSchema.index({ status: 1 });
WithdrawalSchema.index({ userType: 1 });
WithdrawalSchema.index({ transactionId: 1 });
WithdrawalSchema.index({ reviewedBy: 1 });
WithdrawalSchema.index({ processedBy: 1 });

// Generate unique transaction ID
WithdrawalSchema.pre('save', function (next) {
  if (!this.transactionId && this.status === 'processing') {
    this.transactionId = `WD${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);