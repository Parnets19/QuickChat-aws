const Admin = require('../models/Admin.model');
const { AppError } = require('../middlewares/errorHandler');

// @desc    Admin login
// @route   POST /api/admin-auth/login
// @access  Public
const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }

    // Find admin by email and include password
    const admin = await Admin.findOne({ email }).select('+password');

    if (!admin) {
      return next(new AppError('Invalid credentials', 401));
    }

    // Check if account is locked
    if (admin.isLocked()) {
      return next(new AppError('Account is temporarily locked. Please try again later.', 423));
    }

    // Check if admin is active
    if (!admin.isActive) {
      return next(new AppError('Admin account is deactivated', 403));
    }

    // Check password
    const isPasswordCorrect = await admin.comparePassword(password);

    if (!isPasswordCorrect) {
      // Increment login attempts
      admin.loginAttempts += 1;
      
      // Lock account after 5 failed attempts for 30 minutes
      if (admin.loginAttempts >= 5) {
        admin.lockUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
      }
      
      await admin.save();
      return next(new AppError('Invalid credentials', 401));
    }

    // Reset login attempts on successful login
    admin.loginAttempts = 0;
    admin.lockUntil = undefined;
    admin.lastLogin = new Date();
    await admin.save();

    // Generate tokens
    const token = admin.generateAuthToken();
    const refreshToken = admin.generateRefreshToken();

    // Remove password from response
    admin.password = undefined;

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: {
        admin,
        token,
        refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin logout
// @route   POST /api/admin-auth/logout
// @access  Private (Admin)
const adminLogout = async (req, res, next) => {
  try {
    // In a production app, you might want to blacklist the token
    // For now, we'll just send a success response
    res.status(200).json({
      success: true,
      message: 'Admin logout successful'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Refresh admin token
// @route   POST /api/admin-auth/refresh-token
// @access  Public
const refreshAdminToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(new AppError('Refresh token is required', 400));
    }

    // Verify refresh token
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find admin
    const admin = await Admin.findById(decoded.id);

    if (!admin || !admin.isActive) {
      return next(new AppError('Invalid refresh token', 401));
    }

    // Generate new tokens
    const newToken = admin.generateAuthToken();
    const newRefreshToken = admin.generateRefreshToken();

    res.status(200).json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    return next(new AppError('Invalid refresh token', 401));
  }
};

// @desc    Get admin profile
// @route   GET /api/admin-auth/me
// @access  Private (Admin)
const getAdminProfile = async (req, res, next) => {
  try {
    // req.user should be set by the protect middleware
    if (!req.user.isAdmin) {
      return next(new AppError('Access denied', 403));
    }

    const admin = await Admin.findById(req.user.id);

    if (!admin) {
      return next(new AppError('Admin not found', 404));
    }

    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Setup initial admin account
// @route   POST /api/admin-auth/setup
// @access  Public (only if no admin exists)
const setupAdmin = async (req, res, next) => {
  try {
    // Check if any admin already exists
    const existingAdmin = await Admin.findOne();

    if (existingAdmin) {
      return next(new AppError('Admin account already exists', 400));
    }

    const { fullName, email, password } = req.body;

    // Use environment variables as defaults
    const adminData = {
      fullName: fullName || 'System Administrator',
      email: email || process.env.ADMIN_EMAIL,
      password: password || process.env.ADMIN_PASSWORD,
      role: 'super-admin'
    };

    // Validate required fields
    if (!adminData.email || !adminData.password) {
      return next(new AppError('Email and password are required', 400));
    }

    // Create admin
    const admin = await Admin.create(adminData);

    // Generate tokens
    const token = admin.generateAuthToken();
    const refreshToken = admin.generateRefreshToken();

    // Remove password from response
    admin.password = undefined;

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      data: {
        admin,
        token,
        refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if admin setup is required
// @route   GET /api/admin-auth/check-setup
// @access  Public
const checkAdminSetup = async (req, res, next) => {
  try {
    const adminCount = await Admin.countDocuments();

    res.status(200).json({
      success: true,
      data: {
        setupRequired: adminCount === 0,
        adminExists: adminCount > 0
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  adminLogin,
  adminLogout,
  refreshAdminToken,
  getAdminProfile,
  setupAdmin,
  checkAdminSetup
};