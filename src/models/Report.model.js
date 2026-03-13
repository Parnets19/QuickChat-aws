const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reported: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    consultation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      enum: [
        'inappropriate_behavior',
        'harassment',
        'spam',
        'fraud',
        'offensive_content',
        'other'
      ],
    },
    description: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
      default: 'pending',
    },
    adminNotes: String,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    reviewedAt: Date,
    warningsSent: {
      type: Number,
      default: 0,
    },
    actionTaken: {
      type: String,
      enum: ['none', 'warning', 'suspended', 'banned'],
      default: 'none',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ReportSchema.index({ reported: 1, status: 1 });
ReportSchema.index({ reporter: 1 });
ReportSchema.index({ consultation: 1 });
ReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
