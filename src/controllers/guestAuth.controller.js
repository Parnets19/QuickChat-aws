const { Guest } = require('../models');
const { AppError } = require('../middlewares/errorHandler');
const { sendOTP, verifyOTP } = require('../utils/otp');

// @desc    Send OTP for guest registration/login
// @route   POST /api/guest-auth/send-otp
// @access  Public
const sendGuestOTP = async (req, res, next) => {
  try {
    const { mobile, purpose = 'login' } = req.body;

    if (!mobile || mobile.length !== 10) {
      return next(new AppError('Please provide a valid 10-digit mobile number', 400));
    }

    // Check if guest exists
    let guest = await Guest.findOne({ mobile });
    
    if (purpose === 'registration' && guest) {
      return next(new AppError('This mobile number is already registered. Please use the "Guest Login" option to access your account.', 400));
    }

    // Rate limiting: Check if OTP was sent recently
    if (guest && guest.lastOtpSent) {
      const timeSinceLastOtp = Date.now() - new Date(guest.lastOtpSent).getTime();
      if (timeSinceLastOtp < 60000) { // 1 minute
        return next(new AppError('Please wait before requesting another OTP', 429));
      }
    }

    // Generate and send OTP
    const otpResult = await sendOTP(mobile, purpose);
    
    if (!otpResult.success) {
      return next(new AppError('Failed to send OTP. Please try again.', 500));
    }

    // Update or create guest record with OTP timestamp
    if (guest) {
      guest.lastOtpSent = new Date();
      guest.otpAttempts = 0;
      await guest.save();
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        mobile,
        otpSent: true,
        // Always show OTP for development - remove in production
        otp: otpResult.otp,
        dummyOtp: otpResult.otp
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Register new guest with OTP verification
// @route   POST /api/guest-auth/register
// @access  Public
const registerGuest = async (req, res, next) => {
  try {
    const { name, mobile, description, otp } = req.body;
    
    console.log(`🔍 Guest registration attempt:`, {
      name,
      mobile,
      description: description?.substring(0, 50) + '...',
      otp,
      hasOtp: !!otp
    });

    // Validate required fields
    if (!name || !mobile || !otp) {
      return next(new AppError('Name, mobile number, and OTP are required', 400));
    }

    if (mobile.length !== 10) {
      return next(new AppError('Please provide a valid 10-digit mobile number', 400));
    }

    // Check if guest already exists
    const existingGuest = await Guest.findOne({ mobile });
    if (existingGuest) {
      return next(new AppError('This mobile number is already registered. Please use the "Guest Login" option to access your account.', 400));
    }

    // Verify OTP
    const otpVerification = await verifyOTP(mobile, otp, 'registration');
    if (!otpVerification.success) {
      return next(new AppError('Invalid or expired OTP', 400));
    }

    // Create new guest
    const guest = new Guest({
      name: name.trim(),
      mobile,
      description: description?.trim() || '',
      isMobileVerified: true,
      lastActive: new Date()
    });

    await guest.save();

    // Generate auth token
    const token = guest.generateAuthToken();

    res.status(201).json({
      success: true,
      message: 'Guest registration successful',
      data: {
        guest: {
          id: guest._id,
          name: guest.name,
          mobile: guest.mobile,
          description: guest.description,
          wallet: guest.wallet,
          isGuest: true
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login existing guest with OTP
// @route   POST /api/guest-auth/login
// @access  Public
const loginGuest = async (req, res, next) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return next(new AppError('Mobile number and OTP are required', 400));
    }

    // Find guest
    const guest = await Guest.findOne({ mobile });
    if (!guest) {
      return next(new AppError('No guest account found with this mobile number. Please register first.', 404));
    }

    // Check if account is active
    if (guest.status !== 'active') {
      return next(new AppError('Your account has been suspended. Please contact support.', 403));
    }

    // Verify OTP
    const otpVerification = await verifyOTP(mobile, otp, 'login');
    if (!otpVerification.success) {
      // Increment failed attempts
      guest.otpAttempts += 1;
      await guest.save();
      
      if (guest.otpAttempts >= 5) {
        return next(new AppError('Too many failed attempts. Please try again later.', 429));
      }
      
      return next(new AppError('Invalid or expired OTP', 400));
    }

    // Reset OTP attempts and update last active
    guest.otpAttempts = 0;
    guest.lastActive = new Date();
    guest.isOnline = true;
    await guest.save();

    // Generate auth token
    const token = guest.generateAuthToken();

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        guest: {
          id: guest._id,
          name: guest.name,
          mobile: guest.mobile,
          description: guest.description,
          wallet: guest.wallet,
          totalSpent: guest.totalSpent,
          isGuest: true
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get guest profile
// @route   GET /api/guest-auth/profile
// @access  Private (Guest)
const getGuestProfile = async (req, res, next) => {
  try {
    const guest = await Guest.findById(req.user.id)
      .populate('consultations')
      .populate('transactions');

    if (!guest) {
      return next(new AppError('Guest not found', 404));
    }

    res.status(200).json({
      success: true,
      data: {
        guest: {
          id: guest._id,
          name: guest.name,
          mobile: guest.mobile,
          description: guest.description,
          wallet: guest.wallet,
          totalSpent: guest.totalSpent,
          consultations: guest.consultations,
          transactions: guest.transactions,
          isGuest: true,
          createdAt: guest.createdAt,
          lastActive: guest.lastActive
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update guest profile
// @route   PUT /api/guest-auth/profile
// @access  Private (Guest)
const updateGuestProfile = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    
    const guest = await Guest.findById(req.user.id);
    if (!guest) {
      return next(new AppError('Guest not found', 404));
    }

    // Update allowed fields
    if (name) guest.name = name.trim();
    if (description !== undefined) guest.description = description.trim();
    
    guest.lastActive = new Date();
    await guest.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        guest: {
          id: guest._id,
          name: guest.name,
          mobile: guest.mobile,
          description: guest.description,
          wallet: guest.wallet,
          isGuest: true
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout guest
// @route   POST /api/guest-auth/logout
// @access  Private (Guest)
const logoutGuest = async (req, res, next) => {
  try {
    const guest = await Guest.findById(req.user.id);
    if (guest) {
      guest.isOnline = false;
      guest.lastActive = new Date();
      await guest.save();
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendGuestOTP,
  registerGuest,
  loginGuest,
  getGuestProfile,
  updateGuestProfile,
  logoutGuest
};