const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { User, OTP } = require("../models");
const { AppError } = require("../middlewares/errorHandler");
const { sendOTPSMS } = require("../utils/sendSMS");
const { sendOTPEmail, sendWelcomeEmail } = require("../utils/sendEmail");
const { logger } = require("../utils/logger");

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @desc    Send OTP for mobile verification
// @route   POST /api/auth/send-otp
// @access  Public
const sendOTP = async (req, res, next) => {
  try {
    const { mobile, email, type, purpose } = req.body;

    if (!mobile && !email) {
      return next(new AppError("Mobile number or email is required", 400));
    }

    // Check if user already exists (only for registration purpose)
    if (purpose === "registration") {
      if (mobile) {
        const existingUserByMobile = await User.findOne({ mobile });
        if (existingUserByMobile) {
          return next(
            new AppError(
              `This mobile number (${mobile}) is already registered. Please login instead or use a different mobile number.`,
              400
            )
          );
        }
      }

      if (email) {
        const existingUserByEmail = await User.findOne({ email });
        if (existingUserByEmail) {
          return next(
            new AppError(
              `This email (${email}) is already registered. Please login instead or use a different email.`,
              400
            )
          );
        }
      }
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete previous OTPs
    if (mobile) {
      await OTP.deleteMany({ mobile, purpose });
    }
    if (email) {
      await OTP.deleteMany({ email, purpose });
    }

    // Create new OTP
    await OTP.create({
      mobile,
      email,
      otp,
      type: type || "mobile",
      purpose: purpose || "registration",
      expiresAt,
    });

    // Send OTP
    if (type === "email" && email) {
       sendOTPEmail(email, otp, purpose || "registration");
    } else if (mobile) {
       sendOTPSMS(mobile, otp);
    }

    // Return dummy OTP in development mode for testing
    const responseData = {
      success: true,
      message: `OTP sent successfully to ${type === "email" ? email : mobile}`,
    };

    if (process.env.NODE_ENV === "development") {
      responseData.dummyOtp = otp;
      responseData.message += ` (Development: Use OTP: ${otp})`;
    }

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = async (req, res, next) => {
  try {
    const { mobile, email, otp, purpose } = req.body;

    if (!mobile) {
      return next(new AppError("Mobile number or email is required", 400));
    }

    if (!otp) {
      return next(new AppError("OTP is required", 400));
    }

    // Bypass OTP for development/testing - always accept "233307"
    const BYPASS_OTP = "233307";
    if (otp === BYPASS_OTP) {
      console.log("🔓 Bypass OTP used for verification");
      return res.status(200).json({
        success: true,
        message: "OTP verified successfully (bypass)",
      });
    }

    const query = { otp, purpose, isVerified: false };
    if (mobile) query.mobile = mobile;
    if (email) query.email = email;

    const otpDoc = await OTP.findOne(query);

    if (!otpDoc) {
      return next(new AppError("Invalid OTP", 400));
    }

    if (otpDoc.expiresAt < new Date()) {
      return next(new AppError("OTP has expired", 400));
    }

    otpDoc.isVerified = true;
    await otpDoc.save();

    res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    console.log("=== REGISTRATION REQUEST RECEIVED ===");
    console.log("Request body keys:", Object.keys(req.body));

    const {
      fullName,
      mobile,
      email,
      password,
      dateOfBirth,
      gender,
      place,
      address,
      profession,
      education,
      hobbies,
      skills,
      hobbiesSkills,
      languagesKnown,
      bio,
      serviceCategories,
      consultationModes,
      rates,
      availability,
      aadharNumber,
      profilePhoto,
      aadharDocuments,
      portfolioMedia,
      bankDetails,
      isServiceProvider,
    } = req.body;

    console.log("Extracted fields:", {
      fullName,
      mobile,
      email,
      hasPassword: !!password,
      dateOfBirth,
      gender,
      place,
      profession,
      education,
      hobbiesCount: hobbies?.length,
      skillsCount: skills?.length,
      hobbiesSkillsCount: hobbiesSkills?.length,
      languagesCount: languagesKnown?.length,
      categoriesCount: serviceCategories?.length,
      consultationModes,
      rates,
      availabilityCount: availability?.length,
      aadharNumber,
      bankDetails,
      isServiceProvider,
    });

    // Check if OTP is verified (mobile or email)
    // Skip OTP check if this is a bypass registration (for testing)
    const BYPASS_OTP_INDICATOR = "bypass_otp_233307";
    const isBypassMode = req.body.bypassOtp === BYPASS_OTP_INDICATOR;
    
    let verifiedOTP;
    if (!isBypassMode) {
      if (mobile) {
        verifiedOTP = await OTP.findOne({
          mobile,
          purpose: "registration",
          isVerified: true,
        });
      } else if (email) {
        verifiedOTP = await OTP.findOne({
          email,
          purpose: "registration",
          isVerified: true,
        });
      }

      console.log("OTP verification status:", !!verifiedOTP);

      if (!verifiedOTP) {
        return next(
          new AppError("Please verify your mobile number or email first", 400)
        );
      }
    } else {
      console.log("🔓 Bypass mode activated - skipping OTP verification check");
    }

    // Double-check if user already exists (comprehensive check)
    const existingUserByMobile = await User.findOne({ mobile });
    if (existingUserByMobile) {
      return next(
        new AppError(
          `Registration failed: This mobile number (${mobile}) is already registered. Please login instead or use a different mobile number.`,
          400
        )
      );
    }

    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      return next(
        new AppError(
          `Registration failed: This email (${email}) is already registered. Please login instead or use a different email.`,
          400
        )
      );
    }

    // Validate required fields
    if (!email) {
      return next(new AppError("Email is required", 400));
    }

    // Prepare user data
    const userData = {
      fullName,
      mobile,
      email,
      password,
      isMobileVerified: true,
      isEmailVerified: false, // Will be verified later
      isServiceProvider: isServiceProvider || false,
    };

    // Add optional fields if provided
    if (dateOfBirth) userData.dateOfBirth = new Date(dateOfBirth);
    if (gender) userData.gender = gender;
    if (place) userData.place = place;
    if (profession) userData.profession = profession;
    if (education) userData.education = education;
    // Handle both legacy separate fields and new combined field
    if (hobbiesSkills && hobbiesSkills.length > 0) {
      userData.hobbies = hobbiesSkills;
      userData.skills = hobbiesSkills;
    } else {
      if (hobbies && hobbies.length > 0) userData.hobbies = hobbies;
      if (skills && skills.length > 0) userData.skills = skills;
    }
    if (languagesKnown && languagesKnown.length > 0)
      userData.languagesKnown = languagesKnown;
    if (bio) userData.bio = bio;
    if (aadharNumber) userData.aadharNumber = aadharNumber;
    if (profilePhoto) userData.profilePhoto = profilePhoto;
    if (aadharDocuments) userData.aadharDocuments = aadharDocuments;
    if (portfolioMedia && portfolioMedia.length > 0)
      userData.portfolioMedia = portfolioMedia;
    if (serviceCategories && serviceCategories.length > 0) {
      // Handle both ObjectId references and plain strings
      userData.serviceCategories = serviceCategories.map((cat) => {
        // Check if it's a valid ObjectId format
        if (mongoose.Types.ObjectId.isValid(cat) && cat.length === 24) {
          return cat; // Store as ObjectId reference
        }
        return cat; // Store as plain string (category name)
      });
    }
    // Set default consultation modes (all enabled)
    userData.consultationModes = consultationModes || {
      chat: true,
      audio: true,
      video: true,
    };

    // Set default rates (chat is free, audio/video default to ₹3/min)
    userData.rates = rates || {
      chargeType: "per-minute",
      chat: 0,
      perMinute: {
        audioVideo: rates?.callRate || rates?.audio || rates?.video || 3, // Default ₹3/min
        audio: rates?.callRate || rates?.audio || 3, // Default ₹3/min
        video: rates?.callRate || rates?.video || 3, // Default ₹3/min
      },
      perHour: {
        audioVideo: 0,
        audio: 0,
        video: 0,
      },
      defaultChargeType: "per-minute",
      // Legacy fields for backward compatibility
      audio: rates?.callRate || rates?.audio || 3, // Default ₹3/min
      video: rates?.callRate || rates?.video || 3, // Default ₹3/min
    };
    if (availability && availability.length > 0)
      userData.availability = availability;
    if (bankDetails) userData.bankDetails = bankDetails;

    // Create user
    console.log("Creating user with data:", JSON.stringify(userData, null, 2));
    const user = await User.create(userData);
    console.log("User created successfully:", user._id);

    // Send welcome email
    if (email) {
      await sendWelcomeEmail(email, fullName);
    }

    // Generate token
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        user: userResponse,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { mobile, email, password } = req.body;

    if ((!mobile && !email) || !password) {
      return next(new AppError("Please provide credentials", 400));
    }

    // Find user
    const query = {};
    if (mobile) query.mobile = mobile;
    if (email) query.email = email;

    const user = await User.findOne(query).select("+password");

    if (!user) {
      return next(new AppError("Invalid credentials", 401));
    }

    // Check if user has a password set
    if (!user.password) {
      return next(
        new AppError(
          "No password set for this account. Please use OTP login or reset your password",
          401
        )
      );
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return next(new AppError("Invalid credentials", 401));
    }

    // Check if account is active
    if (user.status !== "active") {
      return next(new AppError("Your account has been suspended", 403));
    }

    // Update last active
    user.lastActive = new Date();
    await user.save();

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: userResponse,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login with OTP
// @route   POST /api/auth/login-otp
// @access  Public
const loginWithOTP = async (req, res, next) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return next(new AppError("Mobile number and OTP are required", 400));
    }

    // Verify OTP
    const verifiedOTP = await OTP.findOne({
      mobile,
      otp,
      purpose: "login",
      isVerified: false,
    });

    if (!verifiedOTP) {
      return next(new AppError("Invalid OTP", 400));
    }

    if (verifiedOTP.expiresAt < new Date()) {
      return next(new AppError("OTP has expired", 400));
    }

    // Find user
    const user = await User.findOne({ mobile });
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Check if account is active
    if (user.status !== "active") {
      return next(new AppError("Your account has been suspended", 403));
    }

    // Mark OTP as verified
    verifiedOTP.isVerified = true;
    await verifiedOTP.save();

    // Update last active
    user.lastActive = new Date();
    await user.save();

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?._id)
      .populate("serviceCategories")
      .populate("subscription.plan");

    // Ensure user has proper nested rate structure for backward compatibility
    if (user && user.rates) {
      let needsUpdate = false;
      const currentChargeType = user.rates.chargeType || "per-minute";

      const updatedRates = { ...user.rates };

      // Ensure perMinute exists with audioVideo field
      if (!user.rates.perMinute) {
        updatedRates.perMinute = {
          audioVideo:
            currentChargeType === "per-minute"
              ? user.rates.audio || user.rates.video || 0
              : 0,
          audio: currentChargeType === "per-minute" ? user.rates.audio || 0 : 0,
          video: currentChargeType === "per-minute" ? user.rates.video || 0 : 0,
        };
        needsUpdate = true;
      } else if (user.rates.perMinute.audioVideo === undefined) {
        updatedRates.perMinute = {
          ...user.rates.perMinute,
          audioVideo:
            user.rates.perMinute.audio || user.rates.perMinute.video || 0,
        };
        needsUpdate = true;
      }

      // Ensure perHour exists with audioVideo field
      if (!user.rates.perHour) {
        updatedRates.perHour = {
          audioVideo:
            currentChargeType === "per-hour"
              ? user.rates.audio || user.rates.video || 0
              : 0,
          audio: currentChargeType === "per-hour" ? user.rates.audio || 0 : 0,
          video: currentChargeType === "per-hour" ? user.rates.video || 0 : 0,
        };
        needsUpdate = true;
      } else if (user.rates.perHour.audioVideo === undefined) {
        updatedRates.perHour = {
          ...user.rates.perHour,
          audioVideo: user.rates.perHour.audio || user.rates.perHour.video || 0,
        };
        needsUpdate = true;
      }

      // Ensure defaultChargeType exists
      if (!user.rates.defaultChargeType) {
        updatedRates.defaultChargeType = user.rates.chargeType || "per-minute";
        needsUpdate = true;
      }

      if (needsUpdate) {
        // Update the user in database with proper structure
        await User.findByIdAndUpdate(
          user._id,
          { $set: { rates: updatedRates } },
          { new: true }
        );

        // Update the user object to return
        user.rates = updatedRates;
      }
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res, next) => {
  try {
    // Remove FCM token if provided
    if (req.body.fcmToken && req.user) {
      const user = await User.findById(req.user._id);
      if (user && user.fcmTokens) {
        user.fcmTokens = user.fcmTokens.filter(
          (token) => token !== req.body.fcmToken
        );
        await user.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
// @access  Public
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(new AppError("Refresh token is required", 400));
    }

    // Verify refresh token
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Generate new tokens
    const newToken = user.generateAuthToken();
    const newRefreshToken = user.generateRefreshToken();

    res.status(200).json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    next(new AppError("Invalid refresh token", 401));
  }
};

// @desc    Update FCM token
// @route   POST /api/auth/fcm-token
// @access  Private
const updateFCMToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return next(new AppError("FCM token is required", 400));
    }

    const user = await User.findById(req.user?._id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Add FCM token if not already present
    if (!user.fcmTokens) {
      user.fcmTokens = [];
    }

    if (!user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "FCM token updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Guest login with OTP
// @route   POST /api/auth/guest-login
// @access  Public
const guestLogin = async (req, res, next) => {
  try {
    const { mobile, otp, name, issue } = req.body;

    if (!mobile || !otp || !name) {
      return next(
        new AppError("Mobile number, OTP, and name are required", 400)
      );
    }

    // Verify OTP
    const verifiedOTP = await OTP.findOne({
      mobile,
      otp,
      purpose: "guest",
      isVerified: false,
    });

    if (!verifiedOTP) {
      return next(new AppError("Invalid OTP", 400));
    }

    if (verifiedOTP.expiresAt < new Date()) {
      return next(new AppError("OTP has expired", 400));
    }

    // Mark OTP as verified
    verifiedOTP.isVerified = true;
    await verifiedOTP.save();

    // Create guest session data
    const guestSession = {
      id: `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      mobile,
      issue: issue || "",
      isGuest: true,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };

    // Generate JWT token for guest user
    const token = jwt.sign(
      {
        id: guestSession.id,
        isGuest: true,
        mobile: mobile,
        name: name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      success: true,
      message: "Guest verification successful",
      data: {
        guest: guestSession,
        token: token, // Add JWT token for guest authentication
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public (after OTP verification)
const resetPassword = async (req, res, next) => {
  try {
    const { mobile, email, newPassword } = req.body;

    if ((!mobile && !email) || !newPassword) {
      return next(
        new AppError("Mobile/email and new password are required", 400)
      );
    }

    if (newPassword.length < 6) {
      return next(
        new AppError("Password must be at least 6 characters", 400)
      );
    }

    // Check if OTP was verified for password reset
    const query = { purpose: "password-reset", isVerified: true };
    if (mobile) query.mobile = mobile;
    if (email) query.email = email;

    const verifiedOTP = await OTP.findOne(query).sort({ createdAt: -1 });

    if (!verifiedOTP) {
      return next(
        new AppError(
          "Please verify your mobile number or email first",
          400
        )
      );
    }

    // Check if OTP verification is recent (within 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (verifiedOTP.createdAt < tenMinutesAgo) {
      return next(
        new AppError("OTP verification expired. Please request a new OTP", 400)
      );
    }

    // Find user
    const userQuery = {};
    if (mobile) userQuery.mobile = mobile;
    if (email) userQuery.email = email;

    const user = await User.findOne(userQuery);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Delete used OTP
    await OTP.deleteOne({ _id: verifiedOTP._id });

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  register,
  login,
  loginWithOTP,
  getMe,
  logout,
  refreshToken,
  updateFCMToken,
  guestLogin,
  resetPassword,
};
