const mongoose = require('mongoose');

const ReelSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['video', 'image'],
      default: 'video',
    },
    videoUrl: {
      type: String,
      required: function() {
        return this.type === 'video';
      },
    },
    imageUrl: {
      type: String,
      required: function() {
        return this.type === 'image';
      },
    },
    thumbnailUrl: String,
    caption: {
      type: String,
      maxlength: 2200,
    },
    tags: [String],
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    views: {
      type: Number,
      default: 0,
    },
    shares: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
ReelSchema.index({ user: 1 });
ReelSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Reel', ReelSchema);
