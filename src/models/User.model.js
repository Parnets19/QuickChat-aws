const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
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
      enum: ["male", "female", "other"],
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
          enum: ["image", "video"],
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
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
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
          default: 3, // Default ₹3 per minute for new providers
        },
        // Legacy fields for backward compatibility
        audio: {
          type: Number,
          default: 3, // Default ₹3 per minute
        },
        video: {
          type: Number,
          default: 3, // Default ₹3 per minute
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
          default: 3, // Default ₹3 per minute
        },
        video: {
          type: Number,
          default: 3, // Default ₹3 per minute
        },
      },
      // Default charge type for display
      defaultChargeType: {
        type: String,
        enum: ["per-minute", "per-hour"],
        default: "per-minute",
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
        enum: ["per-minute", "per-hour"],
        default: "per-minute",
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
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
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
    // User role field for analytics and filtering
    role: {
      type: String,
      enum: ["user", "provider"],
      default: function () {
        return this.isServiceProvider ? "provider" : "user";
      },
    },
    // Provider verification status
    providerVerificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verificationNotes: {
      type: String,
      default: "",
    },
    verifiedAt: {
      type: Date,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    isAdmin: {
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
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    consultationStatus: {
      type: String,
      enum: ["available", "busy", "offline"],
      default: "available",
    },
    subscription: {
      plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subscription",
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
      reviews: [
        {
          consultationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Consultation",
          },
          userId: {
            type: mongoose.Schema.Types.Mixed, // Support both ObjectId and string for guest users
          },
          userName: String,
          stars: {
            type: Number,
            min: 1,
            max: 5,
            required: true,
          },
          review: String,
          tags: [String],
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },

    // Provider status tracking
    isInCall: {
      type: Boolean,
      default: false,
    },
    currentConsultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
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
    consultationRoles: [
      {
        consultationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Consultation",
        },
        role: {
          type: String,
          enum: ["client", "provider"],
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Track provider-to-provider consultations
    providerToProviderConsultations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Consultation",
      },
    ],

    // Track free minutes used with each provider (First Minute Free Trial system)
    freeMinutesUsed: [
      {
        providerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        usedAt: {
          type: Date,
          default: Date.now,
        },
        consultationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Consultation",
        },
      },
    ],

    // NEW: First Time Free Trial System (one-time free call for new users)
    hasUsedFreeTrialCall: {
      type: Boolean,
      default: false,
    },
    freeTrialUsedAt: {
      type: Date,
      default: null,
    },
    freeTrialConsultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      default: null,
    },

    // Block and Report functionality
    blockedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        blockedAt: {
          type: Date,
          default: Date.now,
        },
        reason: String,
      },
    ],
    
    reportedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        reportedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          required: true,
        },
        description: String,
        status: {
          type: String,
          enum: ["pending", "reviewed", "resolved"],
          default: "pending",
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for better query performance (unique indexes handled by schema)
UserSchema.index({ "place.city": 1 });
UserSchema.index({ skills: 1 });
UserSchema.index({ isServiceProvider: 1 });
UserSchema.index({ "rating.average": -1 });

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
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
    {
      id: this._id,
      mobile: this.mobile,
      isAdmin: this.isAdmin || false, // Include isAdmin in JWT payload
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "30d" }
  );
};

// Generate refresh token
UserSchema.methods.generateRefreshToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || "90d",
  });
};

module.exports = mongoose.model("User", UserSchema);
