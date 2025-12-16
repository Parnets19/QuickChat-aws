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
      // Unified audio/video rates (no difference between audio and video)
      perMinute: {
        audioVideo: {
          type: Number,
          default: 0,
        },
        // Legacy fields for backward compatibility
        audio: {
          type: Number,
          default: 0,
        },
        video: {
          type: Number,
          default: 0,
        },
      },
      perHour: {
        audioVideo: {
          type: Number,
          default: 0,
        },
        // Legacy fields for backward compatibility
        audio: {
          type: Number,
          default: 0,
        },
        video: {
          type: Number,
          default: 0,
        },
      },
      // Default charge type for display
      defaultChargeType: {
        type: String,
        enum: ['per-minute', 'per-hour'],
        default: 'per-minute',
      },
      // Legacy fields for backward compatibility
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
      totalStars: {
        type: Number,
        default: 0,
      },
      reviews: [{
        consultationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Consultation'
        },
        userId: {
          type: mongoose.Schema.Types.Mixed, // Support both ObjectId and string for guest users
        },
        userName: String,
        stars: {
          type: Number,
          min: 1,
          max: 5,
          required: true
        },
        review: String,
        tags: [String],
        createdAt: {
          type: Date,
          default: Date.now
        }
      }]
    },
    
    // Provider status tracking
    isInCall: {
      type: Boolean,
      default: false,
    },
    currentConsultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation',
      default: null,
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
    
    // Consultation role tracking for provider-to-provider consultations
    consultationRoles: [{
      consultationId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Consultation' 
      },
      role: { 
        type: String, 
        enum: ['client', 'provider'], 
        required: true 
      },
      createdAt: { 
        type: Date, 
        default: Date.now 
      }
    }],
    
    // Track provider-to-provider consultations
    providerToProviderConsultations: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation'
    }],
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

