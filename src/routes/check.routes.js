const express = require('express');
const { User } = require('../models');
const { AppError } = require('../middlewares/errorHandler');

const router = express.Router();

// @desc    Check if user exists by mobile or email
// @route   POST /api/check/user-exists
// @access  Public
const checkUserExists = async (req, res, next) => {
  try {
    const { mobile, email } = req.body;

    if (!mobile && !email) {
      return next(new AppError('Mobile number or email is required', 400));
    }

    const checks = [];

    if (mobile) {
      const userByMobile = await User.findOne({ mobile }).select('_id fullName mobile');
      if (userByMobile) {
        checks.push({
          type: 'mobile',
          value: mobile,
          exists: true,
          message: `This mobile number (${mobile}) is already registered. Please login instead.`
        });
      } else {
        checks.push({
          type: 'mobile',
          value: mobile,
          exists: false,
          message: 'Mobile number is available'
        });
      }
    }

    if (email) {
      const userByEmail = await User.findOne({ email }).select('_id fullName email');
      if (userByEmail) {
        checks.push({
          type: 'email',
          value: email,
          exists: true,
          message: `This email (${email}) is already registered. Please login instead.`
        });
      } else {
        checks.push({
          type: 'email',
          value: email,
          exists: false,
          message: 'Email is available'
        });
      }
    }

    const hasExistingUser = checks.some(check => check.exists);

    res.status(200).json({
      success: true,
      data: {
        canRegister: !hasExistingUser,
        checks
      }
    });

  } catch (error) {
    next(error);
  }
};

router.post('/user-exists', checkUserExists);

module.exports = router;