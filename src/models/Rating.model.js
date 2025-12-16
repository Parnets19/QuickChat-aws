const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema(
  {
    consultation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation',
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.Mixed, // Support both ObjectId and string for guest users
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    stars: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    review: {
      type: String,
      maxlength: 1000,
    },
    tags: [String],
    isAnonymous: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
RatingSchema.index({ provider: 1, createdAt: -1 });
RatingSchema.index({ consultation: 1 });
RatingSchema.index({ user: 1 });

module.exports = mongoose.model('Rating', RatingSchema);