const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
    },
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    dateOfBirth: Date,
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    place: {
      village: String,
      town: String,
      city: String,
      state: String,
      country: String,
    },
    profession: String,
    education: String,
    hobbies: [String],
    skills: [String],
    languagesKnown: [String],
    bio: {
      type: String,
      maxlength: 2000,
    },
    aadharNumber: {
      type: String,
      sparse: true,
    },
    aadharDocuments: {
      front: String,
      back: String,
    },
    profilePhoto: String,
    portfolioMedia: [
      {
        type: {
          type: String,
          enum: ['image', 'video'],
        },
        url: String,
      },
    ],
    serviceCategories: [
      {
        type: mongoose.Schema.Types.Mixed, // Accepts both ObjectId and String
        // Can be ObjectId reference or plain string (for fallback categories)
      },
    ],
    consultationModes: {
      chat: {
        type: Boolean,
        default: true,
      },
      audio: {
        type: Boolean,
        default: true,
      },
      video: {
        type: Boolean,
        default: true,
      },
    },
    availability: [
      {
        day: {
          type: String,
          enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        },
        slots: [
          {
            start: String, // HH:MM format
            end: String,
          },
        ],
      },
    ],
    rates: {
      chat: {
        type: Number,
        default: 0,
      },
      audio: {
        type: Number,
        default: 0,
      },
      video: {
        type: Number,
        default: 0,
      },
      chargeType: {
        type: String,
        enum: ['per-minute', 'per-hour'],
        default: 'per-minute',
      },
    },
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolderName: String,
      bankName: String,
    },
    wallet: {
      type: Number,
      default: 0,
    },
    earnings: {
      type: Number,
      default: 0,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    isAadharVerified: {
      type: Boolean,
      default: false,
    },
    isServiceProvider: {
      type: Boolean,
      default: false,
    },
    isProfileHidden: {
      type: Boolean,
      default: false,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
    subscription: {
      plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
      },
      startDate: Date,
      endDate: Date,
      isActive: {
        type: Boolean,
        default: false,
      },
    },
    rating: {
      average: {
        type: Number,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    socialLogins: {
      google: String,
      facebook: String,
      apple: String,
    },
    fcmTokens: [String],
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
UserSchema.index({ mobile: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ 'place.city': 1 });
UserSchema.index({ skills: 1 });
UserSchema.index({ isServiceProvider: 1 });
UserSchema.index({ 'rating.average': -1 });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }

  if (this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate auth token
UserSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    { id: this._id, mobile: this.mobile },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

// Generate refresh token
UserSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { id: this._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '90d' }
  );
};

module.exports = mongoose.model('User', UserSchema);

