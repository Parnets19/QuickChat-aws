const mongoose = require('mongoose');

const ProfileEditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: String,
    userMobile: String,
    changes: [
      {
        field: { type: String, required: true },
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
      },
    ],
    ip: String,
    userAgent: String,
  },
  {
    timestamps: true,
  }
);

ProfileEditLogSchema.index({ user: 1, createdAt: -1 });
ProfileEditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ProfileEditLog', ProfileEditLogSchema);
