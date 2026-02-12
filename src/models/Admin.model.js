const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const AdminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      default: 'System Administrator'
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['super-admin', 'admin', 'moderator'],
      default: 'admin'
    },
    permissions: {
      manageUsers: {
        type: Boolean,
        default: true
      },
      manageProviders: {
        type: Boolean,
        default: true
      },
      manageConsultations: {
        type: Boolean,
        default: true
      },
      managePayments: {
        type: Boolean,
        default: true
      },
      viewAnalytics: {
        type: Boolean,
        default: true
      }
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date
    },
    fcmTokens: [String],
    lastActive: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
AdminSchema.index({ email: 1 });

// Hash password before saving
AdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
AdminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate auth token
AdminSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    { 
      id: this._id, 
      email: this.email,
      isAdmin: true,
      role: this.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );
};

// Generate refresh token
AdminSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { 
      id: this._id,
      isAdmin: true
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

// Check if account is locked
AdminSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

module.exports = mongoose.model('Admin', AdminSchema);
