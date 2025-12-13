const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ConsultationSchema = new mongoose.Schema(
  {
    consultationId: {
      type: String,
      unique: true,
      default: () => `CON-${uuidv4().substring(0, 8).toUpperCase()}`,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['chat', 'audio', 'video'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'ongoing', 'completed', 'cancelled'],
      default: 'pending',
    },
    startTime: Date,
    endTime: Date,
    duration: {
      type: Number,
      default: 0,
    },
    rate: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    messages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        message: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        type: {
          type: String,
          enum: ['text', 'image', 'file'],
          default: 'text',
        },
      },
    ],
    rating: {
      stars: {
        type: Number,
        min: 1,
        max: 5,
      },
      review: String,
      tags: [String],
    },
    invoice: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
ConsultationSchema.index({ consultationId: 1 });
ConsultationSchema.index({ user: 1, status: 1 });
ConsultationSchema.index({ provider: 1, status: 1 });
ConsultationSchema.index({ createdAt: -1 });

// Calculate total amount based on duration and rate
ConsultationSchema.pre('save', function (next) {
  if (this.duration && this.rate) {
    this.totalAmount = this.duration * this.rate;
  }
  next();
});

module.exports = mongoose.model('Consultation', ConsultationSchema);

